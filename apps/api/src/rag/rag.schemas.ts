import { z } from "zod";

export const askSchema = z.object({
  question: z.string().trim().min(3, "ask a real question").max(1000, "keep the question under 1000 characters"),
});
export type AskInput = z.infer<typeof askSchema>;
