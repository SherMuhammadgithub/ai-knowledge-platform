// Browser-side API helper. Calls go to /api/*, which next.config.ts forwards to the NestJS API.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly issues: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Options = {
  method?: "GET" | "POST" | "DELETE";
  /** JSON is sent for plain objects. A FormData body (file uploads) is sent as is, with its own boundary. */
  body?: unknown;
  /** Sign-in and sign-up return 401/409 for normal reasons, so they opt out of the auto redirect. */
  handleSessionLoss?: boolean;
};

export async function api<T = void>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, handleSessionLoss = true } = options;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined || body instanceof FormData ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && handleSessionLoss && typeof window !== "undefined") {
      // Session ended, or access to the workspace was removed. Reload so the server decides where to go.
      window.location.assign(data?.code === "WORKSPACE_ACCESS_REVOKED" ? "/" : "/login");
    }
    throw new ApiError(
      typeof data?.message === "string"
        ? data.message
        : res.status >= 500
          ? "The server is not responding. Try again in a moment."
          : "The request failed. Try again.",
      res.status,
      data?.code,
      Array.isArray(data?.issues) ? data.issues : [],
    );
  }
  return data as T;
}
