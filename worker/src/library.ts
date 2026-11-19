import { Route, HttpError, UUID, type Ctx } from "./http";
import { withUser } from "./db";
import { mediaUrl } from "./uploads";

const id = (v: string) => { if (!UUID.test(v)) throw new HttpError(400, "Invalid request."); return v; };
const ids = (v: unknown): string[] => { if (!Array.isArray(v) || !v.length || v.length > 500) throw new HttpError(400, "Select between 1 and 500 photos."); return v.map(String).map(id); };
const q1 = <T = any>(c: Ctx, sql: string, p: unknown[] = []) => withUser(c.env, c.user!.id, (q) => q.query(sql, p)) as Promise<{ rows: T[]; rowCount: number | null }>;

export const libraryRoutes: Route[] = [

  // ---- photos
  ["GET", /^\/api\/photos$/, "user", async (c) => {
    const sp = c.url.searchParams, mode = sp.get("mode") ?? "photos";
    const limit = Math.min(60, Math.max(1, Number(sp.get("limit") ?? 60) | 0)), page = Math.max(0, Number(sp.get("page") ?? 0) | 0);
    const params: unknown[] = [], where = ["p.status = 'ready'", "p.deleted_at is null"];
    if (mode === "favorites") where.push("exists (select 1 from public.favorites f where f.photo_id = p.id and f.user_id = app.uid())");
    if (mode === "album") { params.push(id(sp.get("albumId") ?? "")); where.push(`exists (select 1 from public.album_photos ap where ap.photo_id = p.id and ap.album_id = $${params.length}::uuid)`); }
    const term = (sp.get("q") ?? "").replace(/[%_\\]/g, " ").trim().slice(0, 100);
    if (term) { params.push(`%${term}%`); where.push(`p.filename ilike $${params.length}`); }
    const order = ({ new: "p.taken_at desc", old: "p.taken_at asc", name: "p.filename asc" } as Record<string, string>)[sp.get("sort") ?? "new"] ?? "p.taken_at desc";
    params.push(limit, page * limit);
    const rows = (await q1(c, `select p.id, p.filename, p.width, p.height, p.taken_at, p.exif, p.size_bytes, p.owner_id,
        exists (select 1 from public.favorites f where f.photo_id = p.id and f.user_id = app.uid()) as favorite,
        (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'small') as small_key
      from public.photos p where ${where.join(" and ")} order by ${order}, p.id limit $${params.length - 1} offset $${params.length}`, params)).rows;
    return Promise.all(rows.map(async ({ small_key, ...r }) => ({ ...r, url: small_key ? await mediaUrl(c.env, c.url.origin, small_key) : null })));
  }],
  ["GET", /^\/api\/photos\/([^/]+)\/location$/, "user", async (c) =>
    (await q1(c, "select latitude, longitude from public.photo_locations where photo_id = $1::uuid", [id(c.params[0])])).rows[0] ?? null],   // owner-only by policy
  ["POST", /^\/api\/photos\/trash$/, "user", async (c) => ({ moved: (await q1(c, "select app.trash_photos($1::uuid[]) as n", [ids((await c.body()).ids)])).rows[0].n })],
  ["PUT", /^\/api\/favorites\/([^/]+)$/, "user", async (c) => { await q1(c, "insert into public.favorites (user_id, photo_id) values (app.uid(), $1::uuid) on conflict do nothing", [id(c.params[0])]); return { ok: true }; }],
  ["DELETE", /^\/api\/favorites\/([^/]+)$/, "user", async (c) => { await q1(c, "delete from public.favorites where photo_id = $1::uuid and user_id = app.uid()", [id(c.params[0])]); return { ok: true }; }],

  // ---- albums
  ["GET", /^\/api\/albums$/, "user", async (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.url.searchParams.get("limit") ?? 500) | 0));
    const rows = (await q1(c, `select a.id, a.name, a.description, a.updated_at, a.photo_count, a.owner_id,
        (select v.object_key from public.photo_variants v where v.kind = 'small' and v.photo_id = coalesce(
           (select p.id from public.photos p where p.id = a.cover_photo_id and p.deleted_at is null and p.status = 'ready'),
           (select ap.photo_id from public.album_photos ap join public.photos p on p.id = ap.photo_id where ap.album_id = a.id and p.deleted_at is null and p.status = 'ready' order by ap.position, ap.added_at limit 1))) as cover_key
      from public.albums_with_counts a where a.owner_id = app.uid() order by a.updated_at desc limit $1`, [limit])).rows;
    return Promise.all(rows.map(async ({ cover_key, ...a }) => ({ ...a, cover_url: cover_key ? await mediaUrl(c.env, c.url.origin, cover_key) : null })));
  }],
  ["GET", /^\/api\/albums\/([^/]+)$/, "user", async (c) => {
    const r = (await q1(c, `select a.id, a.name, a.description, a.updated_at, a.photo_count, a.owner_id, app.album_owner_name(a.id) as owner_name,
        (case when a.owner_id = app.uid() then 'owner' else (select m.role::text from public.album_members m where m.album_id = a.id and m.user_id = app.uid()) end) as my_role,
        (select v.object_key from public.photo_variants v where v.kind = 'large' and v.photo_id = coalesce(a.hero_photo_id, a.cover_photo_id,
           (select ap.photo_id from public.album_photos ap join public.photos p on p.id = ap.photo_id where ap.album_id = a.id and p.deleted_at is null and p.status = 'ready' order by ap.position, ap.added_at limit 1))) as hero_key
      from public.albums_with_counts a where a.id = $1::uuid`, [id(c.params[0])])).rows[0];
    if (!r) throw new HttpError(404, "Album not found.");
    const { hero_key, ...a } = r;
    return { ...a, hero_url: hero_key ? await mediaUrl(c.env, c.url.origin, hero_key) : null };
  }],
  ["POST", /^\/api\/albums$/, "user", async (c) => {
    const b = await c.body(), name = String(b.name ?? "").trim();
    if (!name || name.length > 120) throw new HttpError(400, "Enter an album name up to 120 characters.");
    return { id: (await q1(c, "insert into public.albums (owner_id, name, description) values (app.uid(), $1, $2) returning id", [name, String(b.description ?? "").trim().slice(0, 2000) || null])).rows[0].id };
  }],
  ["PATCH", /^\/api\/albums\/([^/]+)$/, "user", async (c) => {
    const b = await c.body(), name = String(b.name ?? "").trim();
    if (!name || name.length > 120) throw new HttpError(400, "Enter an album name up to 120 characters.");
    const r = await q1(c, "update public.albums set name = $2, description = $3, updated_at = now() where id = $1::uuid returning id", [id(c.params[0]), name, String(b.description ?? "").trim().slice(0, 2000) || null]);
    if (!r.rows[0]) throw new HttpError(404, "Album not found.");
    return { ok: true };
  }],
  ["POST", /^\/api\/albums\/([^/]+)\/delete$/, "user", async (c) => { await q1(c, "select app.delete_album($1::uuid)", [id(c.params[0])]); return { ok: true }; }],
  ["POST", /^\/api\/albums\/([^/]+)\/photos$/, "user", async (c) => {
    const r = await q1(c, "insert into public.album_photos (album_id, photo_id) select $1::uuid, unnest($2::uuid[]) on conflict do nothing", [id(c.params[0]), ids((await c.body()).ids)]);
    return { added: r.rowCount };
  }],
  ["DELETE", /^\/api\/albums\/([^/]+)\/photos$/, "user", async (c) => {
    await q1(c, "delete from public.album_photos where album_id = $1::uuid and photo_id = any($2::uuid[])", [id(c.params[0]), ids((await c.body()).ids)]);
    return { ok: true };
  }],
  ["POST", /^\/api\/albums\/([^/]+)\/cover$/, "user", async (c) => {
    const r = await q1(c, `update public.albums set cover_photo_id = $2::uuid, updated_at = now() where id = $1::uuid and owner_id = app.uid()
        and exists (select 1 from public.photos p where p.id = $2::uuid and p.owner_id = app.uid()) returning id`, [id(c.params[0]), id(String((await c.body()).photoId))]);
    if (!r.rows[0]) throw new HttpError(404, "Album or photo not found.");
    return { ok: true };
  }],
];
