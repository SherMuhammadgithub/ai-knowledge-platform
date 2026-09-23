import type { GenerateRequest, GenerateResult, GenerateStreamChunk, LlmClient } from "../src/llm/types";

/**
 * A stand-in for the real generation provider. Tests use it everywhere, so no test ever calls a real service.
 * It records every call and can be told what to reply, or to fail.
 */
export class FakeLlmClient implements LlmClient {
  readonly model = "fake-llm";

  /** Every call, in order. */
  calls: GenerateRequest[] = [];
  /** What generate() returns, oldest first. The last entry repeats once the queue is down to one. */
  replies: string[] = ["This is a fake grounded answer."];
  /** Errors to throw on the next calls, one per call, oldest first. */
  failures: unknown[] = [];

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(request);
    const failure = this.failures.shift();
    if (failure) throw failure;
    const text = this.nextReply();
    return this.resultFor(request, text);
  }

  /** Yields the reply a few words at a time, so a test can see more than one piece arrive. */
  async *generateStream(request: GenerateRequest): AsyncGenerator<GenerateStreamChunk, GenerateResult> {
    this.calls.push(request);
    const failure = this.failures.shift();
    if (failure) throw failure; // thrown before anything is yielded, like a real failure to open the stream
    const text = this.nextReply();
    const words = text.split(" ");
    for (const [i, word] of words.entries()) yield { text: i === 0 ? word : ` ${word}` };
    return this.resultFor(request, text);
  }

  private nextReply(): string {
    return this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
  }

  private resultFor(request: GenerateRequest, text: string): GenerateResult {
    return {
      text,
      model: this.model,
      inputTokens: Math.ceil(((request.system?.length ?? 0) + request.prompt.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      thoughtTokens: 0,
    };
  }

  reset() {
    this.calls = [];
    this.replies = ["This is a fake grounded answer."];
    this.failures = [];
  }
}
