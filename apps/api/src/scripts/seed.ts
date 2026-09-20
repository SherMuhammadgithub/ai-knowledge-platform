// Creates fake demo accounts so every screen and rule can be tried by hand.
// Run: bun run seed   (from the project root)
//
// Safe to run repeatedly: it deletes and recreates ONLY the demo accounts and the workspaces they
// own, so it also undoes anything you changed while testing (removed members, extra workspaces).
// Other users in the database are left alone. It refuses to run in production or on a remote database.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PasswordService } from "../auth/password.service";
import { CHUNK_STRATEGIES, chunkPages, chunkSettingsFrom } from "../chunking";
import { PrismaClient, type WorkspaceRole } from "../generated/prisma/client";
import { PermanentProcessingError } from "../processing/errors";
import { type DocumentKind, type ExtractedDocument, extractDocument } from "../processing/extract-document";
import { LocalDiskStorage } from "../storage/local-disk.storage";
import { blankPdf, makeDocx, makePdf } from "./sample-files";

export const DEMO_PASSWORD = "demo-password-123";

// Same settings and defaults as the worker (config/env.ts), read here without needing the Gemini key.
const chunkStrategy = CHUNK_STRATEGIES.find((s) => s === process.env.CHUNK_STRATEGY) ?? "paragraph";
const chunkSettings = chunkSettingsFrom({
  CHUNK_TARGET_TOKENS: Number(process.env.CHUNK_TARGET_TOKENS ?? 500),
  CHUNK_OVERLAP_TOKENS: Number(process.env.CHUNK_OVERLAP_TOKENS ?? 60),
});

// Fixed ids (valid UUIDv7 shape) so the seed is repeatable and the guide can name exact workspaces.
const uid = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

const USERS = {
  alice: { id: uid(1), email: "alice@acme.test", name: "Alice Andersson" },
  bob: { id: uid(2), email: "bob@acme.test", name: "Bob Brown" },
  carol: { id: uid(3), email: "carol@acme.test", name: "Carol Chen" },
  dave: { id: uid(4), email: "dave@acme.test", name: "Dave Diaz" },
  erin: { id: uid(5), email: "erin@globex.test", name: "Erin Evans" },
  frank: { id: uid(6), email: "frank@globex.test", name: "Frank Fischer" },
  heidi: { id: uid(7), email: "heidi@acme.test", name: "Heidi Hall" },
} as const;

const WORKSPACES = {
  acme: { id: uid(101), name: "Acme Corp" },
  globex: { id: uid(102), name: "Globex" },
  carolOwn: { id: uid(103), name: "Carol's workspace" },
  heidiOwn: { id: uid(104), name: "Heidi's workspace" },
  // Registering always creates a personal workspace, so every demo user has one. This also means
  // removing someone from a company workspace never leaves them without a workspace.
  aliceOwn: { id: uid(105), name: "Alice's workspace" },
  bobOwn: { id: uid(106), name: "Bob's workspace" },
  daveOwn: { id: uid(107), name: "Dave's workspace" },
  erinOwn: { id: uid(108), name: "Erin's workspace" },
  frankOwn: { id: uid(109), name: "Frank's workspace" },
} as const;

type Key = keyof typeof USERS;
type WKey = keyof typeof WORKSPACES;

// At sign-in a user starts in their OLDEST membership. Company memberships are dated before the
// personal ones, so demo users land in their company workspace.
const MEMBERSHIPS: { user: Key; workspace: WKey; role: WorkspaceRole; joined: string }[] = [
  { user: "alice", workspace: "acme", role: "OWNER", joined: "2026-01-05" },
  { user: "bob", workspace: "acme", role: "ADMIN", joined: "2026-01-12" },
  { user: "carol", workspace: "acme", role: "MEMBER", joined: "2026-02-02" },
  { user: "dave", workspace: "acme", role: "MEMBER", joined: "2026-03-09" },
  { user: "erin", workspace: "globex", role: "OWNER", joined: "2026-01-20" },
  { user: "frank", workspace: "globex", role: "MEMBER", joined: "2026-02-16" },
  { user: "carol", workspace: "globex", role: "MEMBER", joined: "2026-04-01" },
  { user: "carol", workspace: "carolOwn", role: "OWNER", joined: "2026-05-11" },
  { user: "heidi", workspace: "heidiOwn", role: "OWNER", joined: "2026-06-01" },
  { user: "alice", workspace: "aliceOwn", role: "OWNER", joined: "2026-06-15" },
  { user: "bob", workspace: "bobOwn", role: "OWNER", joined: "2026-06-16" },
  { user: "dave", workspace: "daveOwn", role: "OWNER", joined: "2026-06-17" },
  { user: "erin", workspace: "erinOwn", role: "OWNER", joined: "2026-06-18" },
  { user: "frank", workspace: "frankOwn", role: "OWNER", joined: "2026-06-19" },
];

// Short FICTIONAL documents, written for this demo. They exist so isolation and deletion can be tried on
// real rows and files. They are not the evaluation corpus, which will be real public documents (Milestone 6).
const DOCUMENTS: { id: number; workspace: WKey; uploader: Key; name: string; created: string; text: string }[] = [
  {
    id: 201,
    workspace: "acme",
    uploader: "alice",
    name: "Employee handbook (sample).txt",
    created: "2026-02-10",
    text: `SAMPLE DOCUMENT. Fictional text written for demo data.

Acme Corp Employee Handbook

4.1 Working hours. The standard week is 40 hours, Monday to Friday. Core hours are 10:00 to 16:00.

4.2 Annual leave. Full-time employees are entitled to 25 days of paid annual leave per calendar year. Part-time staff receive leave in proportion to their hours. Unused days may be carried into the first quarter of the following year.

4.3 Sick leave. Employees receive up to 10 paid sick days a year. A doctor's note is required after three consecutive days.

4.4 Public holidays. Acme observes the public holidays of the country where the employee is based.
`,
  },
  {
    id: 202,
    workspace: "acme",
    uploader: "alice",
    name: "Expense policy (sample).txt",
    created: "2026-03-04",
    text: `SAMPLE DOCUMENT. Fictional text written for demo data.

Acme Corp Expense Policy

Travel must be booked through the company travel desk. Economy class is the default for flights under six hours.

Meals while travelling are reimbursed up to 60 dollars per day with receipts. Alcohol is not reimbursed.

Expenses over 500 dollars need approval from a manager before purchase. Submit all claims within 30 days.
`,
  },
  {
    id: 203,
    workspace: "acme",
    uploader: "carol",
    name: "Remote work guidelines (sample).txt",
    created: "2026-04-21",
    text: `SAMPLE DOCUMENT. Fictional text written for demo data.

Acme Corp Remote Work Guidelines

Employees may work remotely up to three days a week with their manager's agreement. Team meetings on Tuesdays are held in person.

Remote employees receive a one-time home office allowance of 400 dollars. Internet costs are not reimbursed.

Work from another country for more than 14 days needs written approval from HR for tax reasons.
`,
  },
  {
    id: 204,
    workspace: "globex",
    uploader: "erin",
    name: "Security handbook (sample).txt",
    created: "2026-02-25",
    text: `SAMPLE DOCUMENT. Fictional text written for demo data.

Globex Security Handbook

Use the company password manager. Passwords must be at least 14 characters and are never shared over chat or email.

Report a lost laptop or phone to the security desk within one hour. Devices are wiped remotely.

Visitors must sign in at reception and wear a badge at all times inside the building.
`,
  },
  {
    id: 205,
    workspace: "globex",
    uploader: "frank",
    name: "Onboarding checklist (sample).txt",
    created: "2026-05-18",
    text: `SAMPLE DOCUMENT. Fictional text written for demo data.

Globex Onboarding Checklist

Day 1: collect your laptop and badge, and meet your buddy.
Week 1: complete the security training and set up two-factor authentication.
Month 1: agree your first quarter goals with your manager.
`,
  },
];

type Sample = {
  id: number;
  workspace: WKey;
  uploader: Key;
  name: string;
  created: string;
  type: DocumentKind;
  bytes: Buffer;
  result?: ExtractedDocument;
  failure?: string;
};

const fieldManualPdf = () =>
  makePdf(
    [
      ["Field Operations Manual", "", "Technicians must log every visit within 24 hours of the appointment.", "Overdue logs are escalated to the regional man-", "ager for review."],
      ["Safety equipment must be inspected before every shift.", "Damaged equipment is tagged and returned to the depot.", "Inspection records are kept for three years.", "Contractors follow the same rules as staff.", "Questions go to the safety desk."],
      ["Vehicles are serviced every 10000 kilometres.", "Drivers report faults on the same day.", "Fuel receipts are filed weekly.", "Personal use of company vehicles is not allowed.", "Accidents are reported within one hour."],
    ],
    { header: "Globex Field Services Internal", footer: (n, t) => `Page ${n} of ${t}` },
  );

/**
 * Every sample runs through the real reading pipeline (the code the worker runs), so the demo shows real
 * outcomes: Ready with pages, or Failed with the actual reason. Nothing here is a made-up status.
 */
async function buildSamples(): Promise<Sample[]> {
  const texts: Sample[] = DOCUMENTS.map((d) => ({ id: d.id, workspace: d.workspace, uploader: d.uploader, name: d.name, created: d.created, type: "TXT", bytes: Buffer.from(d.text) }));
  const others: Sample[] = [
    {
      id: 206, workspace: "acme", uploader: "bob", name: "Benefits summary (sample).docx", created: "2026-05-02", type: "DOCX",
      bytes: makeDocx([
        "SAMPLE DOCUMENT. Fictional text written for demo data.",
        "Acme Corp Benefits Summary",
        "Acme provides health insurance for employees and their families from the first day of employment.",
        "The company matches pension contributions up to 5 percent of salary.",
        "Each employee has an annual learning budget of 800 dollars, to be used for courses and books.",
      ]),
    },
    { id: 207, workspace: "acme", uploader: "alice", name: "Scanned receipt (sample).pdf", created: "2026-06-10", type: "PDF", bytes: await blankPdf() },
    { id: 208, workspace: "globex", uploader: "erin", name: "Field operations manual (sample).pdf", created: "2026-04-07", type: "PDF", bytes: await fieldManualPdf() },
  ];
  const all = [...texts, ...others];
  for (const sample of all) {
    try {
      sample.result = await extractDocument(sample.type, sample.bytes);
    } catch (err) {
      if (!(err instanceof PermanentProcessingError)) throw err;
      sample.failure = err.reason;
    }
  }
  return all;
}

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed: NODE_ENV is production");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set (see .env.example)");
  const host = new URL(raw).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing to seed a non-local database (${host})`);
  }
  return raw;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: assertSafeTarget() }) });
  try {
    const passwordHash = await new PasswordService().hash(DEMO_PASSWORD);
    const emails = Object.values(USERS).map((u) => u.email);
    const storage = new LocalDiskStorage(process.env.STORAGE_DIR ?? resolve(process.cwd(), "../../storage"));

    // Which workspaces are about to be deleted? Their uploaded files must go too (the database cascade
    // removes the rows, not the files).
    const resetScope = {
      OR: [
        { id: { in: Object.values(WORKSPACES).map((w) => w.id) } },
        { memberships: { some: { role: "OWNER" as const, user: { email: { in: emails } } } } },
      ],
    };
    const staleWorkspaceIds = (await prisma.workspace.findMany({ where: resetScope, select: { id: true } })).map((w) => w.id);

    const samples = await buildSamples();

    await prisma.$transaction(async (tx) => {
      // Reset: remove the demo workspaces (and any workspace a demo user created while testing),
      // then the demo users. Memberships go with them (cascade).
      await tx.workspace.deleteMany({ where: resetScope });
      await tx.user.deleteMany({ where: { email: { in: emails } } });

      for (const u of Object.values(USERS)) {
        await tx.user.create({ data: { ...u, passwordHash, createdAt: new Date("2026-01-01") } });
      }
      for (const w of Object.values(WORKSPACES)) {
        await tx.workspace.create({ data: { ...w, createdAt: new Date("2026-01-01") } });
      }
      for (const m of MEMBERSHIPS) {
        await tx.membership.create({
          data: {
            userId: USERS[m.user].id,
            workspaceId: WORKSPACES[m.workspace].id,
            role: m.role,
            createdAt: new Date(`${m.joined}T09:00:00Z`),
          },
        });
      }
      // Plain client on purpose: the seed builds both tenants, so the workspace-scoped client does not apply.
      for (const d of samples) {
        const workspaceId = WORKSPACES[d.workspace].id;
        const finished = new Date(`${d.created}T10:01:00Z`);
        await tx.document.create({
          data: {
            id: uid(d.id),
            workspaceId,
            uploadedById: USERS[d.uploader].id,
            originalName: d.name,
            type: d.type,
            sizeBytes: d.bytes.length,
            contentHash: createHash("sha256").update(d.bytes).digest("hex"),
            storageKey: `${workspaceId}/${uid(d.id)}`,
            status: d.result ? "READY" : "FAILED",
            statusDetail: d.failure ?? null,
            pageCount: d.result?.pages.length ?? null,
            charCount: d.result?.charCount ?? null,
            processedAt: finished,
            createdAt: new Date(`${d.created}T10:00:00Z`),
            updatedAt: finished,
          },
        });
        if (d.result) {
          await tx.documentPage.createMany({
            data: d.result.pages.map((text, index) => ({ workspaceId, documentId: uid(d.id), pageNumber: index + 1, text, charCount: text.length })),
          });
          // The same chunker the worker uses, so seeded documents look exactly like uploaded ones.
          const chunks = chunkPages(
            d.result.pages.map((text, index) => ({ pageNumber: index + 1, text })),
            chunkStrategy,
            chunkSettings,
          );
          await tx.documentChunk.createMany({ data: chunks.map((c) => ({ ...c, workspaceId, documentId: uid(d.id) })) });
        }
      }
    });

    // Files: clear the old ones, then write the new ones. Keys match the rows above.
    for (const id of staleWorkspaceIds) await storage.deletePrefix(id);
    for (const d of samples) await storage.put(`${WORKSPACES[d.workspace].id}/${uid(d.id)}`, d.bytes);

    console.log(`Demo data ready. Password for every account: ${DEMO_PASSWORD}\n`);
    const count = (w: WKey, ok?: boolean) => samples.filter((d) => d.workspace === w && (ok === undefined || (ok ? d.result : !d.result))).length;
    console.log(`Documents (fictional samples, read by the real pipeline): Acme Corp ${count("acme")} (${count("acme", false)} failed), Globex ${count("globex")}\n`);
    for (const u of Object.values(USERS)) {
      const rows = MEMBERSHIPS.filter((m) => USERS[m.user].id === u.id)
        .map((m) => `${WORKSPACES[m.workspace].name} (${m.role.toLowerCase()})`)
        .join(", ");
      console.log(`${u.email.padEnd(20)} ${rows}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
