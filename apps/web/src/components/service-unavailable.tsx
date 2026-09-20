import { RetryButton } from "@/components/retry-button";

// Shown by the layouts when the API cannot be reached. Server component, no client state.
// `inline` keeps it inside an existing layout (the sign-in column) instead of taking the whole page.
export function ServiceUnavailable({ inline = false }: { inline?: boolean }) {
  const isDev = process.env.NODE_ENV !== "production";
  const content = (
    <>
      <h1 className="text-xl font-semibold">Cannot reach the server</h1>
      <p className="mt-2 text-muted-foreground">
        The app could not get a response from its API. Your session and data are safe. Try again in a moment.
      </p>
      {isDev && (
        <p className="mt-4 text-sm text-muted-foreground">
          Running locally? Start the API with <code className="font-mono">bun run api</code>, and make sure Docker is
          up with <code className="font-mono">bun run infra:up</code>.
        </p>
      )}
      <RetryButton />
    </>
  );

  if (inline) return <div>{content}</div>;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {content}
    </main>
  );
}
