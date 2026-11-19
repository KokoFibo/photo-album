// Runs the same API as the Cloudflare Worker on a normal Node server (behind Caddy on the VPS).
//   node dist/server.mjs             -> HTTP server on 127.0.0.1:$PORT
//   node dist/server.mjs --cleanup   -> run the daily cleanup once and exit (used by the systemd timer)
import http from "node:http";
import { Readable } from "node:stream";
import worker from "./index";
import { runCleanup } from "./purge";
import { createR2 } from "./r2-s3";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing environment variable ${k}`); process.exit(1); } return v as string; };
const env: any = {
  ENVIRONMENT: "production", APP_URL: need("APP_URL"), API_URL: need("API_URL"),
  DATABASE_URL: need("DATABASE_URL"), DATABASE_SERVICE_URL: need("DATABASE_SERVICE_URL"),
  BETTER_AUTH_SECRET: need("BETTER_AUTH_SECRET"), MEDIA_SIGNING_SECRET: need("MEDIA_SIGNING_SECRET"),
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined, MAIL_FROM: process.env.MAIL_FROM || undefined, TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || undefined,
  PHOTOS: createR2({ accountId: need("R2_ACCOUNT_ID"), bucket: need("R2_BUCKET"), accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") }),
};
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch((e) => console.error(e)); }, passThroughOnException() {} };

if (process.argv.includes("--cleanup")) {
  try { await runCleanup(env); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
}

const server = http.createServer(async (nreq, nres) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) {
      if (k === "cf-connecting-ip") continue;   // never trust a client-supplied address
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else if (v !== undefined) headers.set(k, v);
    }
    const ip = String(nreq.headers["x-forwarded-for"] ?? nreq.socket.remoteAddress ?? "").split(",")[0].trim();   // set by Caddy
    if (ip) headers.set("cf-connecting-ip", ip);
    const hasBody = nreq.method !== "GET" && nreq.method !== "HEAD";
    const req = new Request(new URL(nreq.url ?? "/", env.API_URL), { method: nreq.method, headers, body: hasBody ? (Readable.toWeb(nreq) as any) : undefined, duplex: "half" } as any);
    const res = await worker.fetch(req, env, ctx as any);
    nres.statusCode = res.status;
    res.headers.forEach((v, k) => { if (k !== "set-cookie") nres.setHeader(k, v); });
    const cookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
    if (cookies.length) nres.setHeader("set-cookie", cookies);
    if (!res.body) { nres.end(); return; }
    Readable.fromWeb(res.body as any).on("error", () => nres.destroy()).pipe(nres);
  } catch (e) {
    console.error(e);
    if (!nres.headersSent) { nres.statusCode = 500; nres.setHeader("Content-Type", "application/json"); }
    nres.end(JSON.stringify({ error: "Something went wrong. Please try again." }));
  }
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, "127.0.0.1", () => console.log(`Album API listening on 127.0.0.1:${port}`));   // only Caddy can reach it
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));
