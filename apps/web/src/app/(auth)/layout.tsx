import { redirect } from "next/navigation";
import { AuthExample } from "@/components/auth-example";
import { Brand } from "@/components/brand";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { getSession } from "@/lib/server-api";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // Already signed in: go to the app instead of showing the form again.
  if (session.state === "signed-in") redirect("/");

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Left: what the product does, shown with its real mechanism. Large screens only. */}
      <aside className="hidden flex-col justify-between border-r bg-muted/60 px-12 py-10 lg:flex xl:px-20">
        <Brand href="/login" />
        <div>
          <p className="max-w-md text-3xl font-semibold tracking-tight">Answers you can check.</p>
          <p className="mt-3 max-w-md text-muted-foreground">
            Ask questions about your company&apos;s documents. Every answer points to the passage it came from.
          </p>
          <div className="mt-10">
            <AuthExample />
          </div>
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          Each workspace keeps its documents and members separate from every other workspace.
        </p>
      </aside>

      {/* Right: the form. */}
      <div className="flex min-h-screen flex-col">
        <header className="px-6 py-5 lg:hidden">
          <Brand href="/login" />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* The forms cannot work without the API, so say so instead of letting people fail to sign in. */}
            {session.state === "unavailable" ? <ServiceUnavailable inline /> : children}
          </div>
        </main>
      </div>
    </div>
  );
}
