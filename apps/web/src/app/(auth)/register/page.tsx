import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mb-8 mt-2 text-muted-foreground">
        You get a workspace of your own. Add your team to it later.
      </p>
      <AuthForm mode="register" />
    </>
  );
}
