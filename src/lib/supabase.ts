import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
const API = import.meta.env.PUBLIC_API_URL ?? "http://127.0.0.1:8787";

/** Calls the Worker API. Sends the member's access token unless auth is false. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(API + path, { method: opts.method ?? "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    console.error("API request failed:", API + path, e);
    throw new Error(`Could not reach the server at ${API} (${path}). Make sure the Worker is running and the address is correct.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json as T;
}

export async function myProfile() {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const { data } = await supabase.from("profiles").select("id,display_name,role,status,used_bytes,quota_bytes").eq("id", s.session.user.id).maybeSingle();
  return data;
}

/** Convenience redirect only. Real protection is Row Level Security and Worker-side checks. */
export async function guard(adminOnly = false) {
  const p = await myProfile();
  if (!p || p.status !== "active") { await supabase.auth.signOut(); location.href = "/login"; return null; }
  if (adminOnly && p.role !== "super_admin") { location.href = "/"; return null; }
  return p;
}

export async function myId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? "";
}
