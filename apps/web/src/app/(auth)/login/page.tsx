import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold lg:mb-8">Sign in</h1>
      <p className="mb-8 mt-2 text-muted-foreground lg:hidden">
        Ask questions about your documents and get answers with sources.
      </p>
      <AuthForm mode="login" />
    </>
  );
}
