import type { Env } from "./http";
import { asService } from "./db";

/** Deletes objects from R2 and verifies they are really gone. */
export async function deleteObjects(env: Env, keys: string[]): Promise<boolean> {
  const list = keys.filter(Boolean);
  for (let i = 0; i < list.length; i += 1000) await env.PHOTOS.delete(list.slice(i, i + 1000));
  return (await Promise.all(list.map((k) => env.PHOTOS.head(k)))).every((h) => !h);
}

/** Files first, then the database row. Quota is freed only after the files are confirmed deleted. */
export async function purgePhoto(env: Env, id: string, keys: string[]): Promise<boolean> {
  if (!(await deleteObjects(env, keys))) return false;
  await asService(env, (q) => q.query("select app.finalize_purge($1::uuid)", [id]));
  return true;
}

/** Scheduled job: purge expired Trash, expired albums, abandoned uploads and stale quota reservations. Failures are retried on the next run. */
async function cleanupSteps(env: Env) {
  let photos = 0, failed = 0;
  for (let round = 0; round < 5; round++) {
    const due = (await asService(env, (q) => q.query("select id, original_key, variant_keys from app.photos_due_for_purge(100)"))).rows;
    if (!due.length) break;
    for (const r of due) (await purgePhoto(env, r.id, [r.original_key, ...r.variant_keys])) ? photos++ : failed++;
    if (failed) break;
  }
  const albums = (await asService(env, (q) => q.query("select app.purge_due_albums() as n"))).rows[0].n;
  const stale = (await asService(env, (q) => q.query("select id, owner_id, original_key from app.stale_pending_photos(24)"))).rows;
  for (const s of stale) {
    const listed = await env.PHOTOS.list({ prefix: `users/${s.owner_id}/variants/${s.id}/` });
    if (await deleteObjects(env, [s.original_key, ...listed.objects.map((o) => o.key)])) await asService(env, (q) => q.query("select app.abort_upload($1::uuid)", [s.id]));
  }
  await asService(env, (q) => q.query("select app.cleanup_reservations()"));
  await asService(env, (q) => q.query("select app.cleanup_share_links()"));
  console.log(`[cleanup] purged ${photos} photos and ${albums} albums, removed ${stale.length} abandoned uploads, ${failed} failures`);
  return { photos, albums, abandonedUploads: stale.length, failures: failed };
}

const record = (env: Env, started: string, ok: boolean, summary: object, error: string | null) =>
  asService(env, (q) => q.query("select app.record_job_run('cleanup', $1::timestamptz, $2, $3::jsonb, $4)", [started, ok, JSON.stringify(summary), error]));

/** The daily job, with its result recorded for the Background Jobs page. */
export async function runCleanup(env: Env) {
  const started = new Date().toISOString();
  try { const summary = await cleanupSteps(env); await record(env, started, summary.failures === 0, summary, summary.failures ? `${summary.failures} files could not be deleted and will be retried` : null); return summary; }
  catch (e: any) { await record(env, started, false, {}, String(e?.message ?? e).slice(0, 500)).catch(() => {}); throw e; }
}
