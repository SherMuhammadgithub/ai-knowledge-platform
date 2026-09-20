import { z } from "zod";

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));

export const registerSchema = z.object({
  email,
  // Upper bound matters: argon2 cost grows with input, so unbounded passwords are a DoS vector.
  password: z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters"),
  name: z.string().trim().min(1, "Enter your name").max(80, "Use at most 80 characters").optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const switchWorkspaceSchema = z.object({ workspaceId: z.uuid("Invalid workspace") });
export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
