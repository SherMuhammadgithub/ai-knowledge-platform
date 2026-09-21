import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The question file for the evaluation harness (Milestone 6).
 *
 * A retrieved chunk counts as correct when it belongs to one of the expected documents and contains one of the
 * expected quotes. Chunk ids are not used, because they change every time a document is cut again, and the
 * whole point is to compare different ways of cutting. A quote stays the same.
 *
 * A question that the documents cannot answer has `answerable: false` and no answers. It is not scored as a
 * hit or a miss. The harness records how strongly search matched it anyway, because that is the raw material
 * for a later "I don't know" rule.
 */

const answerSchema = z.object({
  /** The document's file name as it was uploaded, for example "govuk-statutory-sick-pay.txt". */
  document: z.string().min(1),
  /** A short exact piece of the document that answers the question. Short, so a chunk boundary rarely cuts it. */
  quote: z.string().trim().min(12, "a quote needs at least 12 characters, or nearly every chunk would match"),
});

const questionSchema = z
  .object({
    id: z.string().min(1),
    /** candidate: proposed, not reviewed. keep: reviewed and used in runs. drop: rejected. */
    status: z.enum(["candidate", "keep", "drop"]),
    question: z.string().trim().min(8),
    answerable: z.boolean(),
    answers: z.array(answerSchema),
    /** What the question is meant to test, for reading the results. */
    kind: z.string().min(1),
    note: z.string().optional(),
  })
  .refine((q) => (q.answerable ? q.answers.length > 0 : q.answers.length === 0), {
    message: "an answerable question needs at least one answer, and an unanswerable one must have none",
  });

const fileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  questions: z.array(questionSchema).min(1),
});

export type EvalAnswer = z.infer<typeof answerSchema>;
export type EvalQuestion = z.infer<typeof questionSchema>;
export type QuestionFile = { name: string; description?: string; questions: EvalQuestion[]; sha256: string; path: string };

/** Reads and checks a question file. Throws with a readable list of problems. */
export function loadQuestionFile(path: string): QuestionFile {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(file)"}: ${i.message}`);
    throw new Error(`${path} has problems:\n${lines.join("\n")}`);
  }
  const ids = parsed.data.questions.map((q) => q.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) throw new Error(`${path}: these question ids are used twice: ${[...new Set(duplicates)].join(", ")}`);
  return { ...parsed.data, sha256: createHash("sha256").update(raw).digest("hex"), path };
}

/**
 * Text as it is compared: curly quotes and dashes made plain, invisible characters removed, white space
 * collapsed, lower case. A quote can then be typed with a normal apostrophe and still match text that has a
 * curly one, or a line break in the middle.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function containsQuote(text: string, quote: string): boolean {
  return normalizeText(text).includes(normalizeText(quote));
}

/** Is this retrieved chunk a correct answer to the question? */
export function isHit(question: Pick<EvalQuestion, "answers">, chunk: { documentName: string; text: string }): boolean {
  return question.answers.some((a) => a.document === chunk.documentName && containsQuote(chunk.text, a.quote));
}
