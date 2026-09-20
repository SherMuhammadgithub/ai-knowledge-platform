import { cookies } from "next/headers";
import { cache } from "react";
import type { DocumentItem, Me, Member } from "./types";

// Server-side calls go straight to the API (not through the /api rewrite) and forward the
// browser's cookie, so the API sees the same session the user has.
const API_URL = process.env.API_URL ?? "http://localhost:3001";

async function get(path: string): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  return fetch(`${API_URL}${path}`, { headers: { cookie: cookieHeader }, cache: "no-store" });
}

export type Session =
  | { state: "signed-in"; me: Me }
  | { state: "signed-out" }
  // The API did not answer, or answered with a server error. Not the same as being signed out.
  | { state: "unavailable" };

/** Never throws. Layouts use this so an API outage shows a message instead of a crashed page. */
export const getSession = cache(async (): Promise<Session> => {
  try {
    const res = await get("/auth/me");
    if (res.status === 401) return { state: "signed-out" };
    if (!res.ok) return { state: "unavailable" };
    return { state: "signed-in", me: (await res.json()) as Me };
  } catch {
    return { state: "unavailable" };
  }
});

/** For pages that already passed a layout check: the signed-in user, or null. */
export async function getMe(): Promise<Me | null> {
  const session = await getSession();
  return session.state === "signed-in" ? session.me : null;
}

export async function getMembers(): Promise<Member[]> {
  const res = await get("/workspaces/current/members");
  if (!res.ok) throw new Error(`API returned ${res.status} for members`);
  return res.json();
}

export async function getDocuments(): Promise<DocumentItem[]> {
  const res = await get("/documents");
  if (!res.ok) throw new Error(`API returned ${res.status} for documents`);
  return res.json();
}
