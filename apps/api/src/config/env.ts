import { z } from "zod";

// One place that reads process.env. Fails fast at startup with a readable list of problems.
const schema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(1, "get a free key at https://aistudio.google.com/apikey"),
  GEMINI_GENERATION_MODEL: z.string().min(1),
  GEMINI_EMBEDDING_MODEL: z.string().min(1),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  // Free-tier quotas are per model, so each client gets its own limiter (see docs/PLAN.md).
  GEMINI_GENERATION_RPM: z.coerce.number().int().positive(),
  GEMINI_EMBEDDING_RPM: z.coerce.number().int().positive(),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).default(5),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QDRANT_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3001),
  // Signs the session cookie. At least 32 characters, random, never committed.
  JWT_SECRET: z.string().min(32, "generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""),
  SESSION_DAYS: z.coerce.number().int().positive().default(7),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Uploads: largest accepted file, and where files are kept (default: <project>/storage, git-ignored).
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(100).default(10),
  STORAGE_DIR: z.string().min(1).optional(),
  // Background processing (Milestone 4).
  QUEUE_PREFIX: z.string().min(1).default("akp"), // tests use their own so they never touch real jobs
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(300),
  PROCESSING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  // Chunking (Milestone 5). Sizes are in estimated tokens (characters / 4). Starting guesses: Milestone 6 measures them.
  CHUNK_STRATEGY: z.enum(["paragraph", "fixed"]).default("paragraph"),
  CHUNK_TARGET_TOKENS: z.coerce.number().int().min(50).max(2000).default(500),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).max(500).default(60),
}).refine((e) => e.CHUNK_OVERLAP_TOKENS * 2 <= e.CHUNK_TARGET_TOKENS, {
  path: ["CHUNK_OVERLAP_TOKENS"],
  message: "must be at most half of CHUNK_TARGET_TOKENS",
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(
      `Invalid environment. Check .env against .env.example:\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}
