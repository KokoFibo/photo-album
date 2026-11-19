import { Client, types } from "pg";
import type { Env } from "./http";

types.setTypeParser(20, (v: string) => Number(v));   // bigint -> number (sizes and counts stay far below 2^53)
export type Q = Client;

async function run<T>(url: string, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]);   // Row Level Security reads this
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; }
  finally { await c.end().catch(() => {}); }
}
/** Runs in one transaction as the signed-in member (role album_app, Row Level Security applies). */
export const withUser = <T>(env: Env, userId: string, fn: (q: Q) => Promise<T>) => run(env.DATABASE_URL, userId, fn);
/** Server-only operations (role album_service): uploads, purge, signup grants. */
export const asService = <T>(env: Env, fn: (q: Q) => Promise<T>) => run(env.DATABASE_SERVICE_URL, null, fn);
export const pgCode = (e: any): string | undefined => e?.code;
