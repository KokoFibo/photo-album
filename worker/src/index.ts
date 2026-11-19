import { Pool } from "pg";
import { makeAuth } from "./auth";
import { HttpError, type Env, type Me, type Route } from "./http";
import { withUser } from "./db";
import { outbox } from "./mail";
import { adminRoutes } from "./admin";
import { libraryRoutes } from "./library";
import { uploadRoutes } from "./uploads";
import { trashRoutes } from "./trash";
import { profileRoutes } from "./profile";
import { shareRoutes } from "./share";
import { opsRoutes } from "./ops";
import { runCleanup } from "./purge";

const routes: Route[] = [...adminRoutes, ...libraryRoutes, ...uploadRoutes, ...trashRoutes, ...profileRoutes, ...shareRoutes, ...opsRoutes];

function fail(e: any): [number, string] {
  if (e instanceof HttpError) return [e.status, e.message];
  if (e?.code === "P0001") return [400, e.message];              // our own `raise exception` messages
  if (e?.code === "42501") return [403, "You do not have permission to do this."];
  if (e?.code === "23505") return [409, "That already exists."];
  console.error(e);
  return [500, "Something went wrong. Please try again."];
}

export default {
  // Daily cleanup (see [triggers] in wrangler.toml). In development: `npm run dev` then GET /__scheduled
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runCleanup(env)); },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url), origin = req.headers.get("Origin");
    const h: Record<string, string> = { "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", Vary: "Origin" };
    if (origin && origin === env.APP_URL) Object.assign(h, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, x-captcha-response", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const withCors = (r: Response) => { const x = new Headers(r.headers); for (const [k, v] of Object.entries(h)) x.set(k, v); return new Response(r.body, { status: r.status, headers: x }); };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    if (url.pathname === "/dev/mail" && env.ENVIRONMENT !== "production") {   // development outbox
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      return new Response(`<meta charset=utf-8><title>Dev mail</title><body style="font:15px system-ui;max-width:720px;margin:2rem auto"><h2>Development outbox</h2>${outbox.map((m) => `<p><b>${esc(m.subject)}</b> to ${esc(m.to)}<br><small>${m.at}</small><br><a href="${esc(m.link)}">${esc(m.link)}</a></p>`).join("") || "<p>No messages yet.</p>"}`, { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname === "/dev/r2" && env.ENVIRONMENT !== "production") {   // development: checks that the R2 binding really works
      try {
        const key = `dev-check/${crypto.randomUUID()}.txt`;
        await env.PHOTOS.put(key, "ok", { httpMetadata: { contentType: "text/plain" } });
        const got = await env.PHOTOS.get(key), text = got ? await got.text() : null;
        await env.PHOTOS.delete(key);
        const listed = await env.PHOTOS.list({ prefix: "users/", limit: 20 });
        return json({ r2: text === "ok" ? "working" : "unexpected result", storedObjects: listed.objects.map((o) => ({ key: o.key, size: o.size })), moreThan20: listed.truncated });
      } catch (e: any) { return json({ r2: "failed", error: String(e?.message ?? e) }, 500); }
    }

    let pool: Pool | undefined;
    const auth = () => makeAuth(env, (pool ??= new Pool({ connectionString: env.DATABASE_URL, max: 1 })));
    try {
      if (url.pathname.startsWith("/api/auth/")) return withCors(await auth().handler(req));

      for (const [method, re, access, handler] of routes) {
        if (req.method !== method) continue;
        const m = url.pathname.match(re);
        if (!m) continue;
        let user: Me | null = null;
        if (access !== "public") {
          // CSRF defence on top of SameSite cookies: changes must come from our own site
          if (!["GET", "HEAD"].includes(req.method) && origin !== env.APP_URL) throw new HttpError(403, "This request is not allowed from this address.");
          const s = await auth().api.getSession({ headers: req.headers });
          if (!s) throw new HttpError(401, "Please sign in.");
          user = (await withUser(env, s.user.id, (q) => q.query("select id, email, display_name, role, status, used_bytes, quota_bytes from public.profiles where id = app.uid()"))).rows[0] ?? null;
          if (!user) throw new HttpError(403, "Your account is not set up. Please contact the administrator.");
          if (user.status !== "active") throw new HttpError(403, user.status === "suspended" ? "This account has been suspended. Please contact the administrator." : "This account is not active. Please contact the administrator.");
          if (access === "admin" && user.role !== "super_admin") throw new HttpError(403, "You do not have permission to do this.");
        }
        const out = await handler({ req, env, url, params: m.slice(1), user, body: () => req.json().catch(() => ({})), ip: req.headers.get("CF-Connecting-IP") ?? "local" });
        return out instanceof Response ? withCors(out) : json(out);
      }
      throw new HttpError(404, "Not found.");
    } catch (e: any) {
      const [status, message] = fail(e);
      const detail = env.ENVIRONMENT !== "production" && status === 500 ? { detail: String(e?.stack ?? e).slice(0, 900) } : {};   // development only
      return json({ error: message, ...detail }, status);
    }
    finally { if (pool) ctx.waitUntil(pool.end().catch(() => {})); }
  },
};
