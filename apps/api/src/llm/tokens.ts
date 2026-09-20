// Token counts are estimates: the embedding call does not report them, and counting exactly costs a provider call.
// Milestone 5, Checkpoint A measured characters / 4 against real counts: English prose came out up to 19% too high,
// codes and numbers 72% too low. So chunk SIZES use characters / 4 (src/chunking), while the RATE LIMITER
// assumes characters / 3 to stay on the cautious side. It is still only a guess: the retry with backoff is the
// real safety net for text that has more tokens than we think.
export const LIMITER_CHARS_PER_TOKEN = 3;

export const estimateTokensForLimiter = (text: string) => Math.ceil(text.length / LIMITER_CHARS_PER_TOKEN);
