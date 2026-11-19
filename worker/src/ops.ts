import { Route, HttpError, limited, type Ctx } from "./http";
import { withUser, asService } from "./db";
import { runCleanup } from "./purge";

const q = <T = any>(c: Ctx, sql: string, p: unknown[] = []) => withUser(c.env, c.user!.id, (x) => x.query(sql, p)) as Promise<{ rows: T[] }>;
async function timed(fn: () => Promise<unknown>) {
  const t = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t }; }
  catch (e: any) { return { ok: false, ms: Date.now() - t, error: String(e?.message ?? e).slice(0, 200) }; }
}

export const opsRoutes: Route[] = [
  ["GET", /^\/api\/admin\/overview$/, "admin", async (c) => (await q(c, "select * from app.admin_overview()")).rows[0] ?? {}],
  ["GET", /^\/api\/admin\/storage$/, "admin", async (c) => (await q(c, "select * from app.admin_storage()")).rows],
  ["GET", /^\/api\/admin\/uploads$/, "admin", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.url.searchParams.get("days") ?? 14) | 0));
    return (await q(c, "select * from app.admin_upload_activity($1::int)", [days])).rows;
  }],
  ["GET", /^\/api\/admin\/jobs$/, "admin", async (c) => ({
    backlog: (await q(c, "select * from app.admin_job_backlog()")).rows[0] ?? {},
    runs: (await q(c, "select * from app.admin_job_runs(30)")).rows,
  })],
  // Runs the daily cleanup right now (the same job the schedule runs)
  ["POST", /^\/api\/admin\/jobs\/run$/, "admin", async (c) => {
    if (limited(`jobrun:${c.user!.id}`, 3)) throw new HttpError(429, "The cleanup was just started. Please wait a minute.");
    return { ok: true, summary: await runCleanup(c.env) };
  }],
  ["GET", /^\/api\/admin\/status$/, "admin", async (c) => {
    const [database, service, storage] = await Promise.all([
      timed(() => withUser(c.env, c.user!.id, (x) => x.query("select 1"))),
      timed(() => asService(c.env, (x) => x.query("select 1"))),
      timed(async () => {
        const key = `dev-check/${crypto.randomUUID()}.txt`;
        await c.env.PHOTOS.put(key, "ok");
        const got = await c.env.PHOTOS.get(key);
        if ((await got?.text()) !== "ok") throw new Error("Unexpected result from storage");
        await c.env.PHOTOS.delete(key);
      }),
    ]);
    const last = (await q(c, "select finished_at, ok from app.admin_job_runs(50) where job = 'cleanup' order by id desc limit 1")).rows[0];
    const ageHours = last?.finished_at ? (Date.now() - +new Date(last.finished_at)) / 36e5 : null;
    const warn = !last || last.ok === false || (ageHours ?? 0) > 36;
    return {
      checks: { database, service, storage }, environment: c.env.ENVIRONMENT, time: new Date().toISOString(),
      cleanup: { lastRun: last?.finished_at ?? null, ok: last?.ok ?? null, ageHours, warn, message: !last ? "The cleanup has not run yet." : last.ok === false ? "The last cleanup failed." : (ageHours ?? 0) > 36 ? "The cleanup has not run for more than 36 hours." : "The cleanup is running on schedule." },
    };
  }],
  ["GET", /^\/api\/admin\/settings$/, "admin", async (c) => (await q(c, "select * from app.admin_get_settings()")).rows[0]],
  ["PUT", /^\/api\/admin\/settings$/, "admin", async (c) => {
    const b = await c.body();
    await q(c, "select app.admin_set_settings($1::int, $2::int)", [Math.round(Number(b.defaultQuotaGB)), Math.round(Number(b.inviteExpiryDays))]);
    return { ok: true };
  }],
];
