import { api } from "./api";
export type Kind = "thumbnail" | "small" | "medium" | "large" | "original";
const cache = new Map<string, { url: string; exp: number }>();

/** Short-lived image URLs for photos the member may see. Cached for 8 minutes (tokens last at least 10). */
export async function signed(ids: string[], kind: Kind, download = false): Promise<Record<string, string>> {
  const now = Date.now(), out: Record<string, string> = {}, need: string[] = [];
  for (const id of ids) { const c = cache.get(`${id}:${kind}:${download}`); if (c && c.exp > now) out[id] = c.url; else need.push(id); }
  for (let i = 0; i < need.length; i += 100) {
    const r = await api<{ urls: Record<string, string> }>("/api/media/sign", { method: "POST", body: { ids: need.slice(i, i + 100), kind, download } });
    for (const [id, u] of Object.entries(r.urls)) { out[id] = u; cache.set(`${id}:${kind}:${download}`, { url: u, exp: now + 8 * 60_000 }); }
  }
  return out;
}
