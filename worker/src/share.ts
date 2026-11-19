import { Route, HttpError, EMAIL, UUID, limited, newToken, sha256Hex, type Ctx } from "./http";
import { withUser, asService } from "./db";
import { mediaUrl } from "./uploads";

const GONE = "This link has expired or is no longer available.";
const id = (v: string) => { if (!UUID.test(v)) throw new HttpError(400, "Invalid request."); return v; };
const q = <T = any>(c: Ctx, sql: string, p: unknown[] = []) => withUser(c.env, c.user!.id, (x) => x.query(sql, p)) as Promise<{ rows: T[]; rowCount: number | null }>;
const owner = async (c: Ctx, album: string) => { if (!(await q(c, "select app.owns_album($1::uuid) as ok", [album])).rows[0].ok) throw new HttpError(404, "Album not found."); };
const ext = (k: string) => k.split(".").pop() ?? "jpg";

export const shareRoutes: Route[] = [
  // ---- Shared with Me
  ["GET", /^\/api\/shared$/, "user", async (c) => {
    const rows = (await q(c, "select * from app.shared_with_me()")).rows;
    const ids = rows.map((r) => r.cover_photo_id ?? r.first_photo_id).filter(Boolean);
    const keys = new Map<string, string>(ids.length ? (await q(c, "select photo_id, object_key from public.photo_variants where kind = 'small' and photo_id = any($1::uuid[])", [ids])).rows.map((r) => [r.photo_id, r.object_key] as [string, string]) : []);
    return Promise.all(rows.map(async ({ cover_photo_id, first_photo_id, ...a }) => {
      const k = keys.get(cover_photo_id ?? first_photo_id);
      return { ...a, cover_url: k ? await mediaUrl(c.env, c.url.origin, k) : null };
    }));
  }],

  // ---- the owner's sharing panel
  ["GET", /^\/api\/albums\/([^/]+)\/sharing$/, "user", async (c) => {
    const album = id(c.params[0]); await owner(c, album);
    return {
      members: (await q(c, "select * from app.album_share_members($1::uuid)", [album])).rows,
      links: (await q(c, "select id, allow_download, created_at, expires_at from public.share_links where album_id = $1::uuid and revoked_at is null and expires_at > now() order by created_at desc", [album])).rows,
    };
  }],
  ["POST", /^\/api\/albums\/([^/]+)\/members$/, "user", async (c) => {
    const album = id(c.params[0]), b = await c.body(), email = String(b.email ?? "").trim().toLowerCase();
    if (limited(`share:${c.user!.id}`, 20)) throw new HttpError(429, "Too many requests. Please wait a minute.");
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (!["viewer", "editor"].includes(b.role)) throw new HttpError(400, "Choose Viewer or Editor.");
    return { name: (await q(c, "select app.share_album($1::uuid, $2, $3::public.share_role) as name", [album, email, b.role])).rows[0].name };
  }],
  ["PATCH", /^\/api\/albums\/([^/]+)\/members\/([^/]+)$/, "user", async (c) => {
    const b = await c.body();
    if (!["viewer", "editor"].includes(b.role)) throw new HttpError(400, "Choose Viewer or Editor.");
    const r = await q(c, "update public.album_members set role = $3::public.share_role where album_id = $1::uuid and user_id = $2 returning user_id", [id(c.params[0]), c.params[1], b.role]);
    if (!r.rows[0]) throw new HttpError(404, "Member not found.");
    return { ok: true };
  }],
  // The owner removes someone, or a member removes themselves (leaves the album)
  ["DELETE", /^\/api\/albums\/([^/]+)\/members\/([^/]+)$/, "user", async (c) => {
    await q(c, "delete from public.album_members where album_id = $1::uuid and user_id = $2", [id(c.params[0]), c.params[1]]);
    return { ok: true };
  }],

  // ---- guest links: no password, valid for exactly one hour, revocable
  ["POST", /^\/api\/albums\/([^/]+)\/links$/, "user", async (c) => {
    const album = id(c.params[0]); await owner(c, album);
    if (limited(`link:${c.user!.id}`, 20)) throw new HttpError(429, "Too many requests. Please wait a minute.");
    const active = Number((await q(c, "select count(*) as n from public.share_links where album_id = $1::uuid and revoked_at is null and expires_at > now()", [album])).rows[0].n);
    if (active >= 10) throw new HttpError(409, "This album already has 10 active links. Revoke one first.");
    const token = newToken(), allow = ((await c.body()) as any).allowDownload === true;
    const r = (await q(c, "insert into public.share_links (album_id, token_hash, allow_download, expires_at) values ($1::uuid, $2, $3, now() + interval '1 hour') returning id, expires_at", [album, await sha256Hex(token), allow])).rows[0];
    return { id: r.id, expiresAt: r.expires_at, url: `${c.env.APP_URL}/s#${token}` };   // the token sits after # so it never reaches servers or referrers
  }],
  ["DELETE", /^\/api\/links\/([^/]+)$/, "user", async (c) => {
    const r = await q(c, "update public.share_links set revoked_at = now() where id = $1::uuid and revoked_at is null returning id", [id(c.params[0])]);
    if (!r.rows[0]) throw new HttpError(404, "Link not found.");
    return { ok: true };
  }],

  // ---- public: what a guest sees. No metadata, no GPS, no other albums.
  ["POST", /^\/api\/guest\/open$/, "public", async (c) => {
    if (limited(`guest:${c.ip}`, 60)) throw new HttpError(429, "Too many requests. Please try again in a minute.");
    const t = String(((await c.body()) as any).token ?? "");
    if (t.length < 20 || t.length > 100) throw new HttpError(404, GONE);
    const hash = await sha256Hex(t);
    const [link, photos] = await asService(c.env, async (x) => [(await x.query("select * from app.guest_link($1)", [hash])).rows[0], (await x.query("select * from app.guest_photos($1)", [hash])).rows] as [any, any[]]);
    if (!link) throw new HttpError(404, GONE);
    const until = Math.floor(+new Date(link.expires_at) / 1000);   // image URLs never outlive the link
    const list = await Promise.all(photos.filter((p) => p.small_key && p.large_key).map(async (p) => ({
      id: p.id, width: p.width, height: p.height,
      thumb: await mediaUrl(c.env, c.url.origin, p.small_key, { until }),
      full: await mediaUrl(c.env, c.url.origin, p.large_key, { until }),
      download: link.allow_download && p.original_key ? await mediaUrl(c.env, c.url.origin, p.original_key, { until, ct: p.mime_type, fn: `photo-${String(p.id).slice(0, 8)}.${ext(p.original_key)}` }) : null,   // original file, not the preview size
    })));
    return { album: { name: link.name, description: link.description, photoCount: list.length }, expiresAt: link.expires_at, allowDownload: link.allow_download, photos: list };
  }],
];
