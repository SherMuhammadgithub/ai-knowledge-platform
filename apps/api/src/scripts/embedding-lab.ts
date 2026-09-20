// Milestone 5, Checkpoint A: see embeddings and tokens with real numbers before building the pipeline.
// Run: bun run lab:embeddings   (needs a filled-in .env; reads only the seeded "(sample)" documents from the dev database)
//
// Part 1 embeds a question and several candidate sentences, then ranks the candidates by cosine similarity.
// Part 2 compares our "characters / 4" token estimate with the provider's real token count.
import { GoogleGenAI } from "@google/genai";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";
import { createProviders } from "../llm/providers";

// Cosine similarity: dot product divided by the two lengths. 1 means the same direction.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const length = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));

type Case = { question: string; candidates: { label: string; text: string }[] };

// Case 1 is the exercise from docs/learning/QUIZ.md. Cases 2 and 3 show where meaning search and exact-word search differ.
const CASES: Case[] = [
  {
    question: "How many vacation days do I get?",
    candidates: [
      { label: "A", text: "Employees receive 25 days of annual leave." },
      {
        label: "B",
        text: "Vacation photos must not be posted on the company blog.",
      },
      { label: "C", text: "The office kitchen has a coffee machine." },
    ],
  },
  {
    question: "What does error ERR-4021 mean?",
    candidates: [
      { label: "D", text: "ERR-4021: the payment gateway timed out." },
      {
        label: "E",
        text: "Error codes that start with 4 are caused by the client, not the server.",
      },
      { label: "F", text: "Our refund policy allows returns within 30 days." },
    ],
  },
  {
    question: "Can I work from home on Fridays?",
    candidates: [
      {
        label: "G",
        text: "Remote work is allowed up to three days a week, agreed with your manager.",
      },
      {
        label: "H",
        text: "Fridays the office closes at 16:00 and the doors lock automatically.",
      },
      {
        label: "I",
        text: "Expense reports are due by the fifth of each month.",
      },
    ],
  },
];

async function meaningSearch(
  embeddings: ReturnType<typeof createProviders>["embeddings"],
) {
  console.log(
    `\n=== Part 1: meaning search (${embeddings.model}, ${embeddings.dimensions} dimensions) ===`,
  );

  let shown = false;
  for (const c of CASES) {
    // Documents and questions are embedded with different purposes: the client adds the instruction text this model expects.
    const docs = await embeddings.embed(
      c.candidates.map((x) => x.text),
      "document",
    );
    const [q] = await embeddings.embed([c.question], "query");

    if (!shown) {
      shown = true;
      console.log(
        `\nWhat one embedding looks like: ${q.length} numbers, first 6 = [${q
          .slice(0, 6)
          .map((n) => n.toFixed(4))
          .join(", ")}], vector length = ${length(q).toFixed(4)}`,
      );
    }

    console.log(`\nQuestion: "${c.question}"`);
    c.candidates
      .map((x, i) => ({ ...x, score: cosine(q, docs[i]) }))
      .sort((a, b) => b.score - a.score)
      .forEach((x, rank) =>
        console.log(
          `  ${rank + 1}. ${x.score.toFixed(4)}  [${x.label}] ${x.text}`,
        ),
      );
  }
}

type Sample = { label: string; text: string };

// Fictional text about a fictional company, about the size of one page.
const INVENTED_PAGE = [
  "4.2 Equipment loans. Staff at Hartwell Offices may borrow laptops, monitors and headsets for up to 30 days. Requests go through the facilities desk and need the approval of a line manager.",
  "Borrowed equipment must be returned in the condition it was lent. Damage caused by normal use is not charged. Damage caused by neglect is reported to the finance team, who decide whether a contribution is needed.",
  "Loans longer than 30 days are treated as extended loans. An extended loan needs a written reason, for example a long project at a client site, and is reviewed every quarter.",
  "4.3 Lost or stolen items. Report a lost or stolen item to the facilities desk within one working day. If the item held company data, also tell the security lead so that access can be removed.",
  "The facilities desk keeps a register of every loan with the item, the borrower, the date and the return date. The register is checked once a month and any item overdue by more than 14 days is chased by email.",
  "4.4 Personal devices. Staff may use their own phones for work email if the device has a screen lock and the company mail app installed. Personal laptops may not be used to store customer files.",
].join("\n\n");

async function tokenCheck(env: ReturnType<typeof loadEnv>) {
  console.log(
    "\n=== Part 2: token estimate (characters / 4) vs the real count ===",
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const samples: Sample[] = [];
  try {
    // Only the fictional documents written for this project (the seed names them "(sample)").
    // Never widen this: the dev database also holds whatever people upload by hand, and this text goes to
    // the provider's free tier, which may use it. Public or fictional text only.
    const pages = await prisma.documentPage.findMany({
      where: { document: { originalName: { contains: "(sample)" } } },
      orderBy: [{ charCount: "desc" }],
      take: 4,
      include: { document: { select: { originalName: true } } },
    });
    for (const p of pages)
      samples.push({
        label: `${p.document.originalName} p${p.pageNumber}`,
        text: p.text,
      });
  } finally {
    await prisma.$disconnect();
  }
  samples.push(
    // The sample documents are short, so add one longer, invented policy text of typical page size.
    { label: "invented policy page (English)", text: INVENTED_PAGE },
    {
      label: "codes and numbers",
      text: "SKU-88213-B, order 4471-A, ERR-4021, 2026-09-20T14:03:11Z, $1,249.99, 10.4.7.212:8443, 0x7F3A",
    },
    {
      label: "SQL code",
      text: "SELECT d.id, count(*) FROM documents d JOIN document_pages p ON p.document_id = d.id GROUP BY d.id HAVING count(*) > 3;",
    },
    {
      label: "Urdu sentence",
      text: "ملازمین کو سال میں پچیس دن کی تنخواہ کے ساتھ چھٹی ملتی ہے۔",
    },
  );

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const countWith = async (model: string, text: string) =>
    (await ai.models.countTokens({ model, contents: [{ parts: [{ text }] }] }))
      .totalTokens ?? null;

  // Try the embedding model first (the tokenizer that matters for us). If it refuses, fall back to the generation model.
  let model = env.GEMINI_EMBEDDING_MODEL;
  try {
    await countWith(model, "test");
  } catch (err) {
    console.log(
      `countTokens is not available for ${model} (${err instanceof Error ? err.message.slice(0, 90) : err}). Using ${env.GEMINI_GENERATION_MODEL} instead.`,
    );
    model = env.GEMINI_GENERATION_MODEL;
  }
  console.log(`token counts from: ${model}\n`);
  console.log(
    "label".padEnd(44) +
      "chars".padStart(7) +
      "  estimate".padStart(10) +
      "     real".padStart(9) +
      "   error",
  );

  for (const s of samples) {
    const estimate = Math.round(s.text.length / 4);
    const real = await countWith(model, s.text);
    const error = real
      ? `${(((estimate - real) / real) * 100).toFixed(0)}%`
      : "n/a";
    console.log(
      s.label.slice(0, 43).padEnd(44) +
        String(s.text.length).padStart(7) +
        String(estimate).padStart(10) +
        String(real ?? "?").padStart(9) +
        error.padStart(8),
    );
  }
  console.log(
    "\nerror = (estimate - real) / real. Negative means the estimate is too low, so real chunks would be bigger than we think.",
  );
}

async function main() {
  const env = loadEnv();
  const { embeddings } = createProviders(env);
  await meaningSearch(embeddings);
  await tokenCheck(env);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
