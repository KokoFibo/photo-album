import { Route, HttpError, UUID, type Ctx } from "./http";
import { withUser, type Q } from "./db";
import { mediaUrl } from "./uploads";
import { purgePhoto } from "./purge";

const list = (v: unknown): string[] => { if (v === undefined || v === null) return []; if (!Array.isArray(v) || v.length > 1000) throw new HttpError(400, "Invalid selection."); return v.map(String).map((s) => { if (!UUID.test(s)) throw new HttpError(400, "Invalid selection."); return s; }); };
const BATCH = 200;
const matching = (all: boolean) => `p.owner_id = app.uid() and p.deleted_at is not null` + (all ? "" : ` and (p.id = any($1::uuid[]) or p.deleted_by_album_id = any($2::uuid[]))`);
const args = (all: boolean, pIds: string[], aIds: string[]) => (all ? [] : [pIds, aIds]);

export const trashRoutes: Route[] = [
  ["GET", /^\/api\/trash$/, "user", async (c) => {
    const { photos, albums } = await withUser(c.env, c.user!.id, async (q: Q) => ({
      photos: (await q.query(`select p.id, p.filename, p.width, p.height, p.deleted_at, p.purge_after, p.deleted_by_album_id,
          (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'small') as small_key
        from public.photos p where p.owner_id = app.uid() and p.deleted_at is not null order by p.deleted_at desc limit 500`)).rows,
      albums: (await q.query(`select a.id, a.name, a.deleted_at, a.purge_after,
          (select count(*) from public.photos p where p.deleted_by_album_id = a.id and p.deleted_at is not null) as trashed_photos
        from public.albums a where a.owner_id = app.uid() and a.deleted_at is not null order by a.deleted_at desc`)).rows,
    }));
    return { albums, photos: await Promise.all(photos.map(async ({ small_key, ...p }: any) => ({ ...p, url: small_key ? await mediaUrl(c.env, c.url.origin, small_key) : null }))) };
  }],

  // Restore uses the original rule: a restored album brings back the photos that were trashed with it
  ["POST", /^\/api\/trash\/restore$/, "user", async (c) => {
    const b = await c.body(), pIds = list(b.photoIds), aIds = list(b.albumIds);
    if (!pIds.length && !aIds.length) throw new HttpError(400, "Select something to restore.");
    await withUser(c.env, c.user!.id, async (q) => {
      for (const a of aIds) await q.query("select app.restore_album($1::uuid)", [a]);
      if (pIds.length) await q.query("select app.restore_photos($1::uuid[])", [pIds]);
    });
    return { ok: true };
  }],

  // Emptying the whole Trash needs the word DELETE; deleting selected items does not. Works in batches: the page repeats while `remaining` is above zero.
  ["POST", /^\/api\/trash\/purge$/, "user", async (c) => {
    const b = await c.body();
    const all = b.all === true, pIds = list(b.photoIds), aIds = list(b.albumIds);
    if (all && b.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm emptying the Trash.");   // deleting selected items needs no extra confirmation
    if (!all && !pIds.length && !aIds.length) throw new HttpError(400, "Select something to delete.");
    const me = c.user!.id;
    const rows = (await withUser(c.env, me, (q) => q.query(
      `select p.id, p.original_key, coalesce(array(select v.object_key from public.photo_variants v where v.photo_id = p.id), '{}') as vkeys
         from public.photos p where ${matching(all)} order by p.deleted_at limit ${BATCH}`, args(all, pIds, aIds)))).rows;
    let purged = 0;
    for (const r of rows) if (await purgePhoto(c.env, r.id, [r.original_key, ...r.vkeys])) purged++;
    const remaining = Number((await withUser(c.env, me, (q) => q.query(`select count(*) as n from public.photos p where ${matching(all)}`, args(all, pIds, aIds)))).rows[0].n);
    if (remaining === 0) {   // albums go last, once none of their photos are left
      const albumIds = all
        ? (await withUser(c.env, me, (q) => q.query("select id from public.albums where owner_id = app.uid() and deleted_at is not null"))).rows.map((r: any) => r.id as string)
        : aIds;
      if (albumIds.length) await withUser(c.env, me, (q) => q.query("select app.purge_albums($1::uuid[])", [albumIds]));
    }
    return { purged, remaining };
  }],
];
