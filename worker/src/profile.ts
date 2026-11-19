import { Route, HttpError, limited, type Ctx } from "./http";
import { withUser } from "./db";
import { mediaUrl, magicOk } from "./uploads";

const AV: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_AVATAR = 1024 * 1024;   // the page sends a 512 px square, normally well under 200 KB
const q1 = <T = any>(c: Ctx, sql: string, p: unknown[] = []) => withUser(c.env, c.user!.id, (q) => q.query(sql, p)) as Promise<{ rows: T[]; rowCount: number | null }>;

export const profileRoutes: Route[] = [
  ["GET", /^\/api\/me$/, "user", async (c) => {
    const r = (await q1(c, "update public.profiles set last_active_at = now() where id = app.uid() returning avatar_key, created_at")).rows[0];
    return { ...c.user, created_at: r?.created_at ?? null, avatar_url: r?.avatar_key ? await mediaUrl(c.env, c.url.origin, r.avatar_key) : null };
  }],

  ["PATCH", /^\/api\/me$/, "user", async (c) => {
    const name = String(((await c.body()) as any).displayName ?? "").trim();
    if (!name || name.length > 80) throw new HttpError(400, "Enter a name up to 80 characters.");
    await withUser(c.env, c.user!.id, async (q) => {
      await q.query("update public.profiles set display_name = $1 where id = app.uid()", [name]);
      await q.query("update public.auth_user set name = $1, updated_at = now() where id = app.uid()", [name]);
    });
    return { ok: true };
  }],

  ["PUT", /^\/api\/me\/avatar$/, "user", async (c) => {
    if (limited(`avatar:${c.user!.id}`, 10)) throw new HttpError(429, "Too many changes. Please wait a minute.");
    const len = Number(c.req.headers.get("Content-Length")), type = c.req.headers.get("Content-Type") ?? "", ext = AV[type];
    if (!(len > 0 && len <= MAX_AVATAR)) throw new HttpError(400, "Profile photos must be smaller than 1 MB.");
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (!ext || buf.length !== len || !magicOk(buf, type)) throw new HttpError(400, "Use a JPEG, PNG or WebP image.");
    const key = `users/${c.user!.id}/avatar/${Date.now()}.${ext}`;
    await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
    const old = (await q1(c, "select avatar_key from public.profiles where id = app.uid()")).rows[0]?.avatar_key as string | null;
    await q1(c, "update public.profiles set avatar_key = $1 where id = app.uid()", [key]);
    if (old) await c.env.PHOTOS.delete(old);
    return { ok: true };
  }],

  ["DELETE", /^\/api\/me\/avatar$/, "user", async (c) => {
    const old = (await q1(c, "select avatar_key from public.profiles where id = app.uid()")).rows[0]?.avatar_key as string | null;
    await q1(c, "update public.profiles set avatar_key = null where id = app.uid()");
    if (old) await c.env.PHOTOS.delete(old);
    return { ok: true };
  }],

  // Usage breakdown. Uploaded originals and generated sizes both count toward the quota.
  ["GET", /^\/api\/me\/storage$/, "user", async (c) => {
    const r = (await q1(c, `select
        (select count(*) from public.photos where owner_id = app.uid() and status = 'ready' and deleted_at is null) as photo_count,
        (select count(*) from public.albums where owner_id = app.uid() and deleted_at is null) as albums,
        (select coalesce(sum(size_bytes), 0)::bigint from public.photos where owner_id = app.uid() and status = 'ready' and deleted_at is null) as originals,
        (select coalesce(sum(v.size_bytes), 0)::bigint from public.photo_variants v join public.photos p on p.id = v.photo_id where p.owner_id = app.uid() and p.deleted_at is null) as variants,
        ((select coalesce(sum(size_bytes), 0) from public.photos where owner_id = app.uid() and deleted_at is not null)
         + (select coalesce(sum(v.size_bytes), 0) from public.photo_variants v join public.photos p on p.id = v.photo_id where p.owner_id = app.uid() and p.deleted_at is not null))::bigint as trash`)).rows[0];
    return { ...r, used: c.user!.used_bytes, quota: c.user!.quota_bytes };
  }],
];
