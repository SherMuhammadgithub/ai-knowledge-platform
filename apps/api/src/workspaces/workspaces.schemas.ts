import { z } from "zod";
import { email } from "../auth/auth.schemas";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name").max(80, "Use at most 80 characters"),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

// OWNER cannot be granted. A workspace has the owner who created it.
export const addMemberSchema = z.object({
  email,
  role: z.enum(["ADMIN", "MEMBER"], "Choose a role: admin or member"),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;
