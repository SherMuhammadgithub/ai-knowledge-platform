import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env";
import { PrismaService } from "../src/prisma/prisma.service";
import { DocumentProcessorService } from "../src/processing/document-processor.service";
import { ProcessingModule } from "../src/processing/processing.module";
import { DocumentQueueService } from "../src/queue/document-queue.service";
import { setupApp } from "../src/setup-app";

export const TEST_JWT_SECRET = "test-secret-test-secret-test-secret-1234";

export type TestContext = {
  app: INestApplication;
  prisma: PrismaService;
  storageDir: string;
  processor: DocumentProcessorService;
  queue: DocumentQueueService;
};

// Tests use their own queue prefix, so they never touch the jobs of a real worker running on this machine.
export const TEST_QUEUE_PREFIX = "akp-test";

export async function createTestApp(): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL;
  // Hard stop: these tests delete every row. They must never point at the dev database.
  if (!url || !new URL(url).pathname.endsWith("/akp_test")) {
    throw new Error("Refusing to run: TEST_DATABASE_URL must point at the akp_test database");
  }
  // Each test app writes uploads to its own temporary folder, removed when the app closes.
  const storageDir = mkdtempSync(join(tmpdir(), "akp-test-storage-"));
  const env: Env = {
    GEMINI_API_KEY: "unused-in-auth-tests",
    GEMINI_GENERATION_MODEL: "unused",
    GEMINI_EMBEDDING_MODEL: "unused",
    EMBEDDING_DIMENSIONS: 768,
    GEMINI_GENERATION_RPM: 1,
    GEMINI_EMBEDDING_RPM: 1,
    GEMINI_MAX_RETRIES: 0,
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    QDRANT_URL: "http://unused",
    API_PORT: 0,
    JWT_SECRET: TEST_JWT_SECRET,
    SESSION_DAYS: 7,
    NODE_ENV: "test",
    MAX_UPLOAD_MB: 10,
    STORAGE_DIR: storageDir,
    QUEUE_PREFIX: TEST_QUEUE_PREFIX,
    WORKER_CONCURRENCY: 1,
    MAX_PDF_PAGES: 300,
    PROCESSING_TIMEOUT_SECONDS: 60,
    CHUNK_STRATEGY: "paragraph",
    CHUNK_TARGET_TOKENS: 500,
    CHUNK_OVERLAP_TOKENS: 60,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProcessingModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    rmSync(storageDir, { recursive: true, force: true });
  };
  return {
    app,
    prisma: app.get(PrismaService),
    storageDir,
    processor: app.get(DocumentProcessorService),
    queue: app.get(DocumentQueueService),
  };
}

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe("TRUNCATE TABLE document_chunks, document_pages, documents, memberships, workspaces, users RESTART IDENTITY CASCADE");
}

/** A supertest agent keeps cookies between calls, like a browser. */
export const agent = (app: INestApplication) => request.agent(app.getHttpServer());

export const PASSWORD = "correct horse battery";

export async function registerUser(app: INestApplication, email: string, name = "Test User") {
  const a = agent(app);
  const res = await a.post("/auth/register").send({ email, password: PASSWORD, name });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent: a, me: res.body as MeBody };
}

export type MeBody = {
  user: { id: string; email: string; name: string | null };
  workspaces: { id: string; name: string; role: string }[];
  activeWorkspaceId: string | null;
};

/** Signs a token with the real secret. Lets a test claim any (user, workspace) pair it likes. */
export const signSession = (app: INestApplication, sub: string, wid: string) =>
  app.get(JwtService).signAsync({ sub, wid });

/** Empties the temporary upload folder between tests. */
export function resetStorage(storageDir: string) {
  for (const entry of readdirSync(storageDir)) rmSync(join(storageDir, entry), { recursive: true, force: true });
}

// Small, valid-looking files. They pass the signature checks, which is all Milestone 3 checks.
export const fixtures = {
  txt: (text = "Full-time employees get 25 days of paid annual leave.") => Buffer.from(text),
  pdf: (extra = "") => Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog >>
endobj
${extra}
%%EOF`),
  docx: (extra = "") =>
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml word/document.xml ${extra}`)]),
  // "MZ" is the start of a Windows executable.
  exe: () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]),
};

export function upload(
  agent: ReturnType<typeof import("supertest").agent>,
  data: Buffer,
  filename: string,
  fields: Record<string, string> = {},
) {
  let req = agent.post("/documents");
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", data, { filename });
}

/** Polls until the check returns something truthy. Used to wait for the worker to finish a document. */
export async function waitFor<T>(check: () => Promise<T | false | null | undefined>, timeoutMs = 20_000, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
