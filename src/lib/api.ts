import { createAuthClient } from "better-auth/client";

export const API: string = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";
/** Better Auth client: sign in, sign up, sessions, password reset. Cookies are sent to the API (same site: localhost ports). */
export const authClient = createAuthClient({ baseURL: API, fetchOptions: { credentials: "include" } });

export interface Me { id: string; email: string | null; display_name: string; role: "super_admin" | "member"; status: string; used_bytes: number; quota_bytes: number; avatar_url?: string | null; created_at?: string | null }

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, { method: opts.method ?? "GET", credentials: "include", headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    console.error("API request failed:", API + path, e);
    throw new Error(`Could not reach the server at ${API}. Make sure the Worker is running and the address is correct.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("API error:", path, res.status, json); const err: any = new Error(json.error ?? "Something went wrong. Please try again."); err.status = res.status; throw err; }
  return json as T;
}

export async function myProfile(): Promise<Me | null> { try { return await api<Me>("/api/me"); } catch { return null; } }
export const myId = async () => (await myProfile())?.id ?? "";

/** Convenience redirect only. Real protection is Row Level Security and the API's own checks. */
export async function guard(adminOnly = false) {
  const p = await myProfile();
  if (!p) { location.href = "/login"; return null; }
  if (adminOnly && p.role !== "super_admin") { location.href = "/"; return null; }
  return p;
}
