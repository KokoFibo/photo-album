export interface Env {
  ENVIRONMENT: string; APP_URL: string; API_URL: string;
  DATABASE_URL: string; DATABASE_SERVICE_URL: string; BETTER_AUTH_SECRET: string; MEDIA_SIGNING_SECRET: string;
  PHOTOS: R2Bucket; TURNSTILE_SECRET?: string; RESEND_API_KEY?: string; MAIL_FROM?: string;
}
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export type Me = { id: string; email: string | null; display_name: string; role: "super_admin" | "member"; status: string; used_bytes: number; quota_bytes: number };
export type Ctx = { req: Request; env: Env; url: URL; params: string[]; user: Me | null; body: () => Promise<any>; ip: string };
export type Route = [method: string, pattern: RegExp, access: "public" | "user" | "admin", handler: (c: Ctx) => Promise<unknown>];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GB = 1073741824;
export const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
export const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// In-memory limiter: fine locally. In production use Cloudflare's Rate Limiting binding.
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs = 60_000) {
  const now = Date.now(), a = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a); return a.length > max;
}
