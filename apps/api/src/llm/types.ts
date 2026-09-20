// The only AI abstraction in the project. Everything else calls these interfaces,
// so a provider or model change touches one folder (src/llm/gemini).

// How much hidden reasoning the model may do before answering. Thinking tokens cost quota and time,
// and they count against maxOutputTokens: a model that thinks too long can return an empty answer.
export type ThinkingSetting = "minimal" | "low" | "medium" | "high";

export type GenerateRequest = {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Defaults to "minimal". RAG answers rarely need more, and it keeps runs cheap and repeatable. */
  thinking?: ThinkingSetting;
};

export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
};

export interface LlmClient {
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

// Intent, not provider parameters. Some models take a task-type flag, others want the task
// written into the text. Each implementation decides how to express it.
export type EmbedPurpose = "document" | "query";

export interface EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]>;
}

// One record per provider call. In M1 it goes to the log. The AiUsage table (M2+) will store it.
export type UsageRecord = {
  operation: "generate" | "embed";
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  latencyMs: number;
  attempts: number;
  ok: boolean;
  error?: string;
};

export interface UsageSink {
  record(usage: UsageRecord): void;
}

export class ConsoleUsageSink implements UsageSink {
  record(u: UsageRecord): void {
    const tokens = `in=${u.inputTokens ?? "?"} out=${u.outputTokens ?? "?"} thoughts=${u.thoughtTokens ?? "?"}`;
    const status = u.ok ? "ok" : `FAILED (${u.error})`;
    console.log(
      `[ai-usage] ${u.operation} ${u.provider}/${u.model} ${tokens} ${u.latencyMs}ms attempts=${u.attempts} ${status}`,
    );
  }
}
