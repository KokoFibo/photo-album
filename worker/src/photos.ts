import { Env, HttpError, rest, limited } from "./index";

const enc = new TextEncoder();
const KINDS = ["thumbnail", "small", "medium", "large"] as const;
const MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const VARIANT_MIME: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg" };
const MAX_ORIGINAL = 50 * 1024 * 1024, MAX_VARIANT = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64u = (b: Uint8Array | ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hmacKey = (env: Env) => crypto.subtle.importKey("raw", enc.encode(env.MEDIA_SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function mint(env: Env, payload: object) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64u(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body)))}`;
}
async function unmint<T>(env: Env, token: string): Promise<T> {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig || !(await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(sig), enc.encode(body)))) throw new HttpError(403, "This link is not valid.");
  const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
  if (p.exp < Date.now() / 1000) throw new HttpError(403, "This link has expired.");
  return p as T;
}

async function requireMember(req: Request, env: Env) {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) throw new HttpError(401, "Please sign in.");
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) throw new HttpError(401, "Your session has expired. Please sign in again.");
  const { id } = (await u.json()) as { id: string };
  const [p] = (await (await rest(env, `profiles?id=eq.${id}&select=id,status`)).json()) as any[];
  if (!p || p.status !== "active") throw new HttpError(403, "Your account is not active.");
  return { id, jwt };
}
// PostgREST as the signed-in member: Row Level Security decides what is visible
const asUser = (env: Env, jwt: string, path: string, init: RequestInit = {}) =>
  fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

function magicOk(b: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
}
const num = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : undefined);
function cleanExif(x: any) {
  const o: Record<string, unknown> = { make: text(x?.make), model: text(x?.model), lens: text(x?.lens), aperture: num(x?.aperture, 0, 100) ?? undefined, exposure: num(x?.exposure, 0, 10000) ?? undefined, iso: num(x?.iso, 0, 10_000_000) ?? undefined, focalLength: num(x?.focalLength, 0, 10000) ?? undefined };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

type Meta = { photoId: string; uid: string; mime: string; size: number; keys: Record<string, string>; variants: Record<string, number>; vmime: string; lat: number | null; lng: number | null; exp: number };
type PutTok = { photoId: string; uid: string; key: string; size: number; mime: string; exp: number };

async function init(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  if (limited(`up:${me.id}`, 120)) throw new HttpError(429, "Too many uploads at once. Please wait a moment.");
  const b = (await req.json().catch(() => ({}))) as any;
  const mime = String(b.mimeType ?? ""), ext = MIME[mime];
  if (!ext) throw new HttpError(400, /hei[cf]/.test(mime) ? "HEIC photos are not supported yet. Please export them as JPEG." : "Only JPEG, PNG and WebP photos are supported.");
  const size = num(b.size, 1, MAX_ORIGINAL);
  if (!size) throw new HttpError(400, "Each photo must be smaller than 50 MB.");
  const vmime = String(b.variantMime ?? "image/webp");
  if (!VARIANT_MIME[vmime]) throw new HttpError(400, "Invalid image format.");
  const variants: Record<string, number> = {}; let total = size;
  for (const k of KINDS) { const s = num(b.variants?.[k], 1, MAX_VARIANT); if (!s) throw new HttpError(400, "Invalid image sizes."); variants[k] = s; total += s; }
  const width = num(b.width, 1, 100000), height = num(b.height, 1, 100000);
  const sha = /^[0-9a-f]{64}$/.test(String(b.sha256)) ? String(b.sha256) : null;
  const taken = b.takenAt && !isNaN(Date.parse(b.takenAt)) ? new Date(b.takenAt).toISOString() : new Date().toISOString();
  const lat = num(b.gps?.lat, -90, 90), lng = num(b.gps?.lng, -180, 180);
  const filename = String(b.filename ?? "photo").replace(/[\\/\0]/g, "_").slice(0, 200);

  const rr = await asUser(env, me.jwt, "rpc/reserve_upload", { method: "POST", body: JSON.stringify({ p_bytes: total }) });   // quota check under a row lock
  if (!rr.ok) { const t = await rr.text(); throw new HttpError(/Not enough storage/.test(t) ? 413 : 403, /Not enough storage/.test(t) ? "Not enough storage space. Free some space or ask the administrator for more." : "Uploads are not available for this account."); }
  const reservation = (await rr.json()) as string;
  const photoId = crypto.randomUUID(), d = new Date();
  const keys: Record<string, string> = { original: `users/${me.id}/originals/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${photoId}.${ext}` };
  for (const k of KINDS) keys[k] = `users/${me.id}/variants/${photoId}/${k}.${VARIANT_MIME[vmime]}`;
  const ins = await rest(env, "photos", { method: "POST", body: JSON.stringify({ id: photoId, owner_id: me.id, filename, mime_type: mime, size_bytes: size, width, height, sha256: sha, taken_at: taken, exif: cleanExif(b.exif), original_key: keys.original, status: "pending" }) });
  if (!ins.ok) {
    await rest(env, `upload_reservations?id=eq.${reservation}`, { method: "DELETE" });
    if (ins.status === 409) throw new HttpError(409, "This photo is already in your library.");
    throw new Error(await ins.text());
  }
  await rest(env, `upload_reservations?id=eq.${reservation}`, { method: "PATCH", body: JSON.stringify({ photo_id: photoId }) });

  const exp = Math.floor(Date.now() / 1000) + 3600, origin = url.origin, urls: Record<string, string> = {};
  const sizes: Record<string, [number, string]> = { original: [size, mime], ...Object.fromEntries(KINDS.map((k) => [k, [variants[k], vmime] as [number, string]])) };
  for (const [kind, [s, m]] of Object.entries(sizes)) urls[kind] = `${origin}/api/uploads/put/${await mint(env, { photoId, uid: me.id, key: keys[kind], size: s, mime: m, exp } satisfies PutTok)}`;
  const completeToken = await mint(env, { photoId, uid: me.id, mime, size, keys, variants, vmime, lat, lng, exp } satisfies Meta);
  return { photoId, urls, completeToken };
}

async function put(req: Request, env: Env, token: string) {
  const t = await unmint<PutTok>(env, token);
  if (!req.body || Number(req.headers.get("Content-Length")) !== t.size) throw new HttpError(400, "Unexpected file size.");
  await env.PHOTOS.put(t.key, req.body, { httpMetadata: { contentType: t.mime } });
  return { ok: true };
}

async function cleanup(env: Env, m: Meta) {
  await env.PHOTOS.delete(Object.values(m.keys)).catch(() => {});
  await rest(env, "rpc/abort_upload", { method: "POST", body: JSON.stringify({ p_photo: m.photoId }) }).catch(() => {});
}

async function complete(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const m = await unmint<Meta>(env, ((await req.json().catch(() => ({}))) as any).token);
  if (m.uid !== me.id) throw new HttpError(403, "Not allowed.");
  const files = [{ kind: "original", key: m.keys.original, size: m.size, mime: m.mime }, ...KINDS.map((k) => ({ kind: k, key: m.keys[k], size: m.variants[k], mime: m.vmime }))];
  try {
    let total = 0;
    for (const f of files) {
      const head = await env.PHOTOS.head(f.key);
      if (!head || head.size !== f.size) throw new HttpError(400, "The upload did not finish. Please retry.");
      const part = await env.PHOTOS.get(f.key, { range: { offset: 0, length: 12 } });
      if (!part || !magicOk(new Uint8Array(await part.arrayBuffer()), f.mime)) throw new HttpError(400, "This file is not a valid image.");
      total += head.size;
    }
    const r = await rest(env, "rpc/finalize_upload", { method: "POST", body: JSON.stringify({ p_photo: m.photoId, p_variants: files.filter((f) => f.kind !== "original").map((f) => ({ kind: f.kind, key: f.key, size: f.size })), p_total: total, p_lat: m.lat, p_lng: m.lng }) });
    if (!r.ok) throw new HttpError(409, "The upload could not be completed. Your storage may be full.");
  } catch (e) { await cleanup(env, m); throw e; }
  return { ok: true, photoId: m.photoId };
}

async function abort(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const m = await unmint<Meta>(env, ((await req.json().catch(() => ({}))) as any).token);
  if (m.uid !== me.id) throw new HttpError(403, "Not allowed.");
  await cleanup(env, m);
  return { ok: true };
}

// Returns short-lived URLs only for photos the member may see (Row Level Security decides)
async function signUrls(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  if (limited(`sign:${me.id}`, 300)) throw new HttpError(429, "Too many requests. Please wait a moment.");
  const b = (await req.json().catch(() => ({}))) as any;
  const kind = String(b.kind ?? "small"), download = b.download === true;
  const ids: string[] = Array.isArray(b.ids) ? [...new Set<string>(b.ids)].filter((i) => UUID.test(i)).slice(0, 100) : [];
  if (!ids.length || ![...KINDS, "original"].includes(kind)) return { urls: {} };
  const photos = (await (await asUser(env, me.jwt, `photos?id=in.(${ids.join(",")})&select=id,owner_id,original_key,filename,mime_type`)).json()) as any[];
  const vkeys: Record<string, string> = {};
  if (kind !== "original") {
    const vs = (await (await asUser(env, me.jwt, `photo_variants?photo_id=in.(${ids.join(",")})&kind=eq.${kind}&select=photo_id,object_key`)).json()) as any[];
    for (const v of vs) vkeys[v.photo_id] = v.object_key;
  }
  const exp = (Math.floor(Date.now() / 600_000) + 2) * 600;   // stable within a 10-minute window so browsers can cache
  const urls: Record<string, string> = {};
  for (const p of photos) {
    if (kind === "original" && p.owner_id !== me.id) continue;   // sharing permissions arrive with the sharing phase
    const key = kind === "original" ? p.original_key : vkeys[p.id];
    if (!key || !key.startsWith(`users/${p.owner_id}/`)) continue;   // never serve another member's objects
    urls[p.id] = `${url.origin}/api/media/${await mint(env, { k: key, fn: download ? p.filename : undefined, ct: kind === "original" ? p.mime_type : undefined, exp })}`;
  }
  return { urls };
}

async function media(env: Env, token: string) {
  const t = await unmint<{ k: string; fn?: string; ct?: string }>(env, token);
  const obj = await env.PHOTOS.get(t.k);
  if (!obj) throw new HttpError(404, "Not found.");
  const h = new Headers({ "Content-Type": t.ct ?? obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" });
  if (t.fn) h.set("Content-Disposition", `attachment; filename="${t.fn.replace(/["\\\r\n]/g, "_")}"`);
  return new Response(obj.body, { headers: h });
}

export async function photoRoutes(req: Request, env: Env, url: URL): Promise<unknown> {
  const p = url.pathname, m = req.method;
  if (m === "POST" && p === "/api/uploads/init") return init(req, env, url);
  if (m === "PUT" && p.startsWith("/api/uploads/put/")) return put(req, env, p.slice(17));
  if (m === "POST" && p === "/api/uploads/complete") return complete(req, env);
  if (m === "POST" && p === "/api/uploads/abort") return abort(req, env);
  if (m === "POST" && p === "/api/media/sign") return signUrls(req, env, url);
  if (m === "GET" && p.startsWith("/api/media/")) return media(env, p.slice(11));
  return undefined;
}
