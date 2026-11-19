// API security tests. Run:  node --env-file=tests/.env tests/security.mjs
// Needs Node 20.6+, the Worker running (cd worker && npm run dev) and two accounts (see tests/.env.example).
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const API = process.env.API ?? "http://localhost:8787", APP = process.env.APP ?? "http://localhost:4321", DB = process.env.DATABASE_ADMIN_URL || "";
for (const k of ["MEMBER_EMAIL", "MEMBER_PASSWORD", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) if (!process.env[k]) { console.error(`Missing ${k}. Copy tests/.env.example to tests/.env and fill it in.`); process.exit(2); }

let pass = 0, fail = 0, skip = 0;
const section = (t) => console.log(`\n== ${t}`);
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name} (${why})`); };
const sql = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAqc", q], { encoding: "utf8" }).trim();
const sha = (s) => createHash("sha256").update(s).digest("hex");

function send(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === "https:" ? https : http;
    const h = { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) };
    const req = lib.request(u, { method, headers: h }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); }
  async req(method, path, { body, origin = APP, headers = {} } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload;
    if (body !== undefined) { payload = Buffer.isBuffer(body) ? body : JSON.stringify(body); if (!Buffer.isBuffer(body)) h["Content-Type"] = "application/json"; }
    const r = await send(method, API + path, { headers: h, body: payload });
    for (const c of [].concat(r.headers["set-cookie"] ?? [])) { const [pair] = c.split(";"), i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    let json = null; if ((r.headers["content-type"] ?? "").includes("json")) { try { json = JSON.parse(r.buf.toString()); } catch { /* not JSON */ } }
    return { status: r.status, json, headers: r.headers, text: r.buf.toString() };
  }
  async login(email, password) {
    const r = await this.req("POST", "/api/auth/sign-in/email", { body: { email, password } });
    if (r.status !== 200) throw new Error(`${this.name}: sign-in failed (${r.status} ${r.text.slice(0, 120)})`);
  }
}

const jpeg = (n = 300) => { const b = Buffer.alloc(n, 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const webp = (n = 120) => { const b = Buffer.alloc(n, 7); b.write("RIFF", 0); b.writeUInt32LE(n - 8, 4); b.write("WEBP", 8); return b; };
const VAR = webp(), initBody = (o = {}) => ({ filename: "sec-test.jpg", mimeType: "image/jpeg", size: 300, sha256: randomBytes(32).toString("hex"), width: 640, height: 480, takenAt: new Date().toISOString(), exif: {}, gps: { lat: 48.85, lng: 2.35 }, variantMime: "image/webp", variants: { thumbnail: VAR.length, small: VAR.length, medium: VAR.length, large: VAR.length }, ...o });
async function uploadFake(c, { corrupt = false, sha256 } = {}) {
  const orig = corrupt ? Buffer.from("this is plain text, not an image.....".padEnd(300, ".")) : jpeg();
  const init = await c.req("POST", "/api/uploads/init", { body: initBody({ size: orig.length, sha256: sha256 ?? randomBytes(32).toString("hex") }) });
  if (init.status !== 200) return { init };
  const { urls, completeToken, photoId } = init.json;
  for (const [kind, buf] of [["original", orig], ["thumbnail", VAR], ["small", VAR], ["medium", VAR], ["large", VAR]]) {
    const r = await send("PUT", urls[kind], { headers: { Origin: APP, "Content-Type": "application/octet-stream" }, body: buf });
    if (r.status !== 200) return { init, putFailed: kind, status: r.status };
  }
  return { init, photoId, urls, completeToken, complete: await c.req("POST", "/api/uploads/complete", { body: { token: completeToken } }) };
}

const anon = new Client("anonymous"), A = new Client("member"), B = new Client("admin");
const created = { photos: [], albums: [] };
let restoreQuota = null, memberId = null;

try {
  await A.login(process.env.MEMBER_EMAIL, process.env.MEMBER_PASSWORD);
  await B.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const meA = (await A.req("GET", "/api/me")).json, meB = (await B.req("GET", "/api/me")).json;
  if (meA?.role !== "member" || meB?.role !== "super_admin") throw new Error("MEMBER_* must be a normal member and ADMIN_* the Super Admin.");
  memberId = meA.id;

  section("Anonymous visitors");
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/photos"], ["GET", "/api/albums"], ["GET", "/api/trash"], ["GET", "/api/shared"], ["GET", "/api/me/storage"], ["GET", "/api/admin/members"], ["GET", "/api/admin/invitations"], ["GET", "/api/admin/overview"], ["POST", "/api/uploads/init"], ["POST", "/api/media/sign"], ["POST", "/api/trash/purge"]]) {
    const r = await anon.req(m, p, { body: m === "POST" ? {} : undefined });
    ok(`${m} ${p} needs a sign-in`, r.status === 401, `got ${r.status}`);
  }
  ok("forged media link is refused", (await anon.req("GET", "/api/media/forged.token")).status === 403);
  ok("forged upload link is refused", (await send("PUT", `${API}/api/uploads/put/forged.token`, { headers: { Origin: APP }, body: Buffer.from("x") })).status === 403);
  ok("unknown guest link is refused", (await anon.req("POST", "/api/guest/open", { body: { token: "a".repeat(43) } })).status === 404);

  section("Cross-site request protection and roles");
  let r = await A.req("POST", "/api/photos/trash", { body: { ids: [] }, origin: null });
  ok("a change without an Origin header is refused", r.status === 403, `got ${r.status}`);
  r = await A.req("POST", "/api/photos/trash", { body: { ids: [] }, origin: "https://evil.example" });
  ok("a change from another website is refused", r.status === 403, `got ${r.status}`);
  for (const [m, p] of [["GET", "/api/admin/members"], ["GET", "/api/admin/storage"], ["GET", "/api/admin/status"], ["GET", "/api/admin/settings"], ["POST", "/api/admin/invitations"], ["POST", "/api/admin/jobs/run"], ["DELETE", `/api/admin/members/${meB.id}`]]) {
    r = await A.req(m, p, { body: m === "POST" ? {} : undefined });
    ok(`a member cannot use ${m} ${p}`, r.status === 403, `got ${r.status}`);
  }

  section("Member data is private from other accounts (including the admin)");
  const album = (await A.req("POST", "/api/albums", { body: { name: "sec-test album" } })).json?.id; created.albums.push(album);
  const up = await uploadFake(A);
  ok("the owner can upload through the real pipeline", up.complete?.status === 200, JSON.stringify(up.complete?.json ?? up));
  const pid = up.photoId; created.photos.push(pid);
  await A.req("POST", `/api/albums/${album}/photos`, { body: { ids: [pid] } });
  const mine = (await A.req("GET", `/api/photos?mode=album&albumId=${album}`)).json;
  ok("the owner sees the photo in the album", Array.isArray(mine) && mine.some((p) => p.id === pid));
  ok("the owner can read the private GPS", Math.abs((await A.req("GET", `/api/photos/${pid}/location`)).json?.latitude - 48.85) < 0.001);
  const theirs = await B.req("GET", `/api/photos?mode=album&albumId=${album}`);
  ok("another account sees no photos of that album", theirs.status === 200 && theirs.json.length === 0);
  ok("another account cannot open the album", (await B.req("GET", `/api/albums/${album}`)).status === 404);
  ok("another account cannot see the album in its list", !(await B.req("GET", "/api/albums")).json.some((a) => a.id === album));
  ok("another account cannot read the GPS", (await B.req("GET", `/api/photos/${pid}/location`)).json === null);
  ok("another account gets no media link", Object.keys((await B.req("POST", "/api/media/sign", { body: { ids: [pid], kind: "small" } })).json.urls).length === 0);
  ok("another account gets no original-file link", Object.keys((await B.req("POST", "/api/media/sign", { body: { ids: [pid], kind: "original" } })).json.urls).length === 0);
  ok("another account cannot open the sharing panel", (await B.req("GET", `/api/albums/${album}/sharing`)).status === 404);
  ok("another account cannot rename the album", (await B.req("PATCH", `/api/albums/${album}`, { body: { name: "hacked" } })).status === 404);
  ok("another account cannot add photos to the album", (await B.req("POST", `/api/albums/${album}/photos`, { body: { ids: [pid] } })).status >= 400);
  ok("another account cannot create a guest link", (await B.req("POST", `/api/albums/${album}/links`, { body: {} })).status === 404);
  ok("another account cannot delete the album", (await B.req("POST", `/api/albums/${album}/delete`)).status >= 400);
  await B.req("DELETE", `/api/albums/${album}/photos`, { body: { ids: [pid] } });
  await B.req("POST", "/api/photos/trash", { body: { ids: [pid] } });
  await B.req("POST", "/api/trash/purge", { body: { photoIds: [pid], albumIds: [album] } });
  const still = (await A.req("GET", `/api/photos?mode=album&albumId=${album}`)).json;
  ok("the photo survives every attempt by the other account", still.some((p) => p.id === pid));
  const adminJson = JSON.stringify([(await B.req("GET", "/api/admin/storage")).json, (await B.req("GET", "/api/admin/members")).json, (await B.req("GET", "/api/admin/overview")).json, (await B.req("GET", "/api/admin/uploads")).json]);
  ok("admin pages expose no filenames, keys or locations", !/sec-test|original_key|object_key|latitude|exif|users\//.test(adminJson));

  section("Guest links (no password, one hour)");
  const link = (await A.req("POST", `/api/albums/${album}/links`, { body: { allowDownload: false } })).json;
  ok("the owner can create a link", !!link?.url && link.url.includes("/s#"), JSON.stringify(link));
  const token = link.url.split("#")[1];
  let g = await anon.req("POST", "/api/guest/open", { body: { token } });
  ok("a guest opens the link without signing in", g.status === 200 && g.json.photos.length === 1);
  ok("the link is valid for about one hour", Math.abs(+new Date(g.json.expiresAt) - Date.now() - 3600_000) < 120_000);
  ok("the guest response has no metadata, names or locations", !/latitude|longitude|exif|filename|owner|sec-test\.jpg|users\//i.test(JSON.stringify(g.json.photos)));
  ok("downloads are off unless the owner allows them", g.json.allowDownload === false && g.json.photos[0].download === null);
  const img = await send("GET", g.json.photos[0].thumb, { headers: { Origin: APP } });
  ok("the guest can load a photo", img.status === 200 && String(img.headers["content-type"]).startsWith("image/"));
  ok("a guest cannot reach the member API", (await anon.req("GET", `/api/albums/${album}`)).status === 401);
  const dl = (await A.req("POST", `/api/albums/${album}/links`, { body: { allowDownload: true } })).json, dtoken = dl.url.split("#")[1];
  const g2 = await anon.req("POST", "/api/guest/open", { body: { token: dtoken } });
  const file = await send("GET", g2.json.photos[0].download, { headers: { Origin: APP } });
  ok("an allowed download is delivered as an attachment", file.status === 200 && /attachment/.test(file.headers["content-disposition"] ?? ""));
  await A.req("DELETE", `/api/links/${link.id}`);
  ok("a revoked link stops working at once", (await anon.req("POST", "/api/guest/open", { body: { token } })).status === 404);
  if (DB) {
    sql(`update public.share_links set expires_at = now() - interval '1 minute' where token_hash = '${sha(dtoken)}'`);
    ok("an expired link stops working", (await anon.req("POST", "/api/guest/open", { body: { token: dtoken } })).status === 404);
  } else skipped("expired link", "set DATABASE_ADMIN_URL");

  section("Upload validation, duplicates and quota");
  for (const [label, o, want] of [["GIF images", { mimeType: "image/gif" }, 400], ["PDF files", { mimeType: "application/pdf" }, 400], ["HEIC photos (not supported yet)", { mimeType: "image/heic" }, 400], ["files over 50 MB", { size: 60 * 1024 * 1024 }, 400], ["missing generated sizes", { variants: {} }, 400], ["a zero-byte file", { size: 0 }, 400]]) {
    ok(`init refuses ${label}`, (await A.req("POST", "/api/uploads/init", { body: initBody(o) })).status === want);
  }
  const probe = await A.req("POST", "/api/uploads/init", { body: initBody() });
  const url = probe.json.urls.original;
  ok("a tampered upload link is refused", (await send("PUT", url.slice(0, -1) + (url.endsWith("A") ? "B" : "A"), { headers: { Origin: APP }, body: jpeg() })).status === 403);
  ok("a wrong-size upload is refused", (await send("PUT", url, { headers: { Origin: APP }, body: jpeg(301) })).status === 400);
  ok("another account cannot finish someone else's upload", (await B.req("POST", "/api/uploads/complete", { body: { token: probe.json.completeToken } })).status === 403);
  await A.req("POST", "/api/uploads/abort", { body: { token: probe.json.completeToken } });
  const bad = await uploadFake(A, { corrupt: true });
  ok("a non-image with an image name is rejected", bad.complete?.status === 400, JSON.stringify(bad.complete?.json));
  const fixed = randomBytes(32).toString("hex"), first = await uploadFake(A, { sha256: fixed });
  if (first.photoId) created.photos.push(first.photoId);
  ok("the first upload of a photo works", first.complete?.status === 200);
  ok("the same photo cannot be uploaded twice", (await A.req("POST", "/api/uploads/init", { body: initBody({ sha256: fixed }) })).status === 409);
  if (DB) {
    const where = `lower(email) = lower('${process.env.MEMBER_EMAIL.replace(/'/g, "''")}')`;
    restoreQuota = sql(`select quota_bytes from public.profiles where ${where}`);
    sql(`update public.profiles set quota_bytes = used_bytes + 500 where ${where}`);
    r = await A.req("POST", "/api/uploads/init", { body: initBody() });
    ok("an upload over the storage quota is refused", r.status === 413, `got ${r.status}`);
    sql(`update public.profiles set quota_bytes = ${restoreQuota} where ${where}`); restoreQuota = null;
  } else skipped("quota enforcement", "set DATABASE_ADMIN_URL");

  section("Sign-in and registration");
  const rnd = randomBytes(5).toString("hex"), mail = `sec-${rnd}@example.com`;
  r = await anon.req("POST", "/api/auth/sign-up/email", { body: { email: mail, password: "SecurePassw0rd!x", name: "Intruder" } });
  ok("registration without an invitation fails", r.status !== 200, `got ${r.status}`);
  if (DB) ok("no account was created without an invitation", sql(`select count(*) from public.auth_user where email = '${mail}'`) === "0");
  r = await anon.req("POST", "/api/auth/sign-up/email", { body: { email: `sec2-${rnd}@example.com`, password: "SecurePassw0rd!x", name: "Intruder", inviteToken: "x".repeat(43) } });
  ok("registration with a made-up invitation fails", r.status === 400, `got ${r.status}`);
  const wrong = await anon.req("POST", "/api/auth/sign-in/email", { body: { email: process.env.MEMBER_EMAIL, password: "WrongPassw0rd!" } });
  const unknown = await anon.req("POST", "/api/auth/sign-in/email", { body: { email: `nobody-${rnd}@example.com`, password: "WrongPassw0rd!" } });
  ok("a wrong password is refused", wrong.status === 401);
  ok("sign-in does not reveal whether an email exists", wrong.json?.code === unknown.json?.code && wrong.json?.message === unknown.json?.message);

  section("Headers, CORS and robustness");
  r = await anon.req("GET", "/api/me", { origin: "https://evil.example" });
  ok("another website gets no CORS permission", !r.headers["access-control-allow-origin"]);
  r = await anon.req("OPTIONS", "/api/photos", { origin: "https://evil.example", headers: { "Access-Control-Request-Method": "GET" } });
  ok("a preflight from another website gets no CORS permission", !r.headers["access-control-allow-origin"]);
  r = await A.req("GET", "/api/me");
  ok("API answers say nosniff and no-store", r.headers["x-content-type-options"] === "nosniff" && /no-store/.test(r.headers["cache-control"] ?? ""));
  ok("search engines are told to stay away", /noindex/.test(r.headers["x-robots-tag"] ?? ""));
  const robots = await send("GET", `${APP}/robots.txt`);
  ok("robots.txt disallows everything", /Disallow:\s*\//.test(robots.buf.toString()));
  r = await A.req("GET", "/api/photos?q=" + encodeURIComponent("'; drop table photos; --") + "&sort=" + encodeURIComponent("name; select 1"));
  ok("hostile search text is handled safely", r.status === 200);
  ok("a malformed id is rejected, not crashed on", (await A.req("GET", "/api/photos?mode=album&albumId=not-a-uuid")).status === 400);
  ok("a hostile id list is rejected", (await A.req("POST", "/api/photos/trash", { body: { ids: ["x' or '1'='1"] } })).status === 400);

  section("Rate limiting");
  let limited = false;
  for (let i = 0; i < 80 && !limited; i++) limited = (await anon.req("POST", "/api/guest/open", { body: { token: "z".repeat(30) } })).status === 429;
  ok("rapid guesses at guest links are slowed down", limited);
} catch (e) {
  fail++; console.log(`\n  ERROR  ${e.message}`);
} finally {
  section("Clean-up");
  try {
    if (restoreQuota && DB) sql(`update public.profiles set quota_bytes = ${restoreQuota} where lower(email) = lower('${process.env.MEMBER_EMAIL.replace(/'/g, "''")}')`);
    if (created.photos.length) await A.req("POST", "/api/photos/trash", { body: { ids: created.photos } });
    for (const a of created.albums.filter(Boolean)) await A.req("POST", `/api/albums/${a}/delete`);
    for (let i = 0; i < 5 && (created.photos.length || created.albums.length); i++) {
      const p = await A.req("POST", "/api/trash/purge", { body: { photoIds: created.photos, albumIds: created.albums.filter(Boolean) } });
      if (!p.json || p.json.remaining === 0) break;
    }
    console.log("  test photos and album removed from Trash");
  } catch (e) { console.log(`  could not clean up automatically: ${e.message}. Delete "sec-test" items from Trash by hand.`); }
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
