import { Route, HttpError, EMAIL, UUID, GB, limited, newToken, sha256Hex, type Ctx } from "./http";
import { withUser, asService, pgCode } from "./db";
import { sendMail } from "./mail";

const days = (v: unknown) => { const n = Number(v ?? 7); if (!Number.isInteger(n) || n < 1 || n > 30) throw new HttpError(400, "Expiry must be between 1 and 30 days."); return n; };
const inviteLink = (c: Ctx, token: string) => `${c.env.APP_URL}/accept-invitation?token=${token}`;
const mailInvite = (c: Ctx, email: string, token: string) =>
  sendMail(c.env, email, "You're invited to Album", `${c.user!.display_name} invited you to join their private photo library.`, inviteLink(c, token), "Accept invitation");
const rate = (c: Ctx) => { if (limited(`inv:${c.user!.id}`, 10)) throw new HttpError(429, "Too many requests. Please wait a minute."); };

export const adminRoutes: Route[] = [
  // Public: the Accept Invitation page checks a token before showing the registration form
  ["GET", /^\/api\/invitations\/validate$/, "public", async (c) => {
    if (limited(`val:${c.ip}`, 20)) throw new HttpError(429, "Too many attempts. Please try again in a minute.");
    const t = c.url.searchParams.get("token") ?? "";
    const r = t ? await asService(c.env, async (q) => q.query("select email, quota_bytes from app.lookup_invitation($1)", [await sha256Hex(t)])) : { rows: [] };
    if (!r.rows[0]) throw new HttpError(404, "This invitation is invalid or has expired.");
    return { email: r.rows[0].email, quotaGB: Math.round(r.rows[0].quota_bytes / GB) };
  }],

  ["GET", /^\/api\/admin\/invitations$/, "admin", async (c) =>
    (await withUser(c.env, c.user!.id, (q) => q.query("select id, email, quota_bytes, status, created_at, expires_at, accepted_at from public.invitations order by created_at desc"))).rows],

  ["POST", /^\/api\/admin\/invitations$/, "admin", async (c) => {
    rate(c);
    const b = await c.body(), email = String(b.email ?? "").trim().toLowerCase(), quotaGB = Number(b.quotaGB), d = days(b.expiresInDays);
    if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address.");
    if (!(quotaGB >= 1 && quotaGB <= 1000)) throw new HttpError(400, "Quota must be between 1 and 1000 GB.");
    const token = newToken();
    try {
      const r = await withUser(c.env, c.user!.id, async (q) => {
        await q.query("update public.invitations set status = 'expired' where lower(email) = $1 and status = 'pending' and expires_at < now()", [email]);
        return q.query("insert into public.invitations (email, token_hash, quota_bytes, invited_by, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5::int)) returning id",
          [email, await sha256Hex(token), Math.round(quotaGB * GB), c.user!.id, d]);
      });
      return { id: r.rows[0].id, ...(await mailInvite(c, email, token)) };
    } catch (e) { if (pgCode(e) === "23505") throw new HttpError(409, "An active invitation already exists for this email."); throw e; }
  }],

  ["POST", /^\/api\/admin\/invitations\/([^/]+)\/resend$/, "admin", async (c) => {
    rate(c);
    const id = c.params[0]; if (!UUID.test(id)) throw new HttpError(400, "Invalid invitation.");
    const days_ = days(((await c.body()) as any).expiresInDays), token = newToken();
    try {
      const r = await withUser(c.env, c.user!.id, async (q) => {
        const cur = await q.query("select email, status from public.invitations where id = $1", [id]);
        if (!cur.rows[0]) throw new HttpError(404, "Invitation not found.");
        if (!["pending", "expired"].includes(cur.rows[0].status)) throw new HttpError(409, "This invitation cannot be resent. Create a new one instead.");
        await q.query("update public.invitations set token_hash = $2, status = 'pending', expires_at = now() + make_interval(days => $3::int) where id = $1", [id, await sha256Hex(token), days_]);
        return cur.rows[0].email as string;
      });
      return await mailInvite(c, r, token);
    } catch (e) { if (pgCode(e) === "23505") throw new HttpError(409, "A newer active invitation already exists for this email."); throw e; }
  }],

  ["POST", /^\/api\/admin\/invitations\/([^/]+)\/revoke$/, "admin", async (c) => {
    rate(c);
    const id = c.params[0]; if (!UUID.test(id)) throw new HttpError(400, "Invalid invitation.");
    const r = await withUser(c.env, c.user!.id, (q) => q.query("update public.invitations set status = 'revoked', revoked_at = now() where id = $1 and status = 'pending' returning id", [id]));
    if (!r.rows[0]) throw new HttpError(409, "Only pending invitations can be revoked.");
    return { ok: true };
  }],

  ["GET", /^\/api\/admin\/members$/, "admin", async (c) =>
    (await withUser(c.env, c.user!.id, (q) => q.query("select id, display_name, email, status, role, quota_bytes, used_bytes, created_at, last_active_at from public.profiles order by created_at"))).rows],

  ["PATCH", /^\/api\/admin\/members\/([^/]+)$/, "admin", async (c) => {
    const id = c.params[0], b = await c.body(), sets: string[] = [], vals: unknown[] = [id];
    if (b.displayName !== undefined) { const n = String(b.displayName).trim(); if (!n || n.length > 80) throw new HttpError(400, "Enter a name up to 80 characters."); vals.push(n); sets.push(`display_name = $${vals.length}`); }
    if (b.quotaGB !== undefined) { const g = Number(b.quotaGB); if (!(g >= 1 && g <= 100000)) throw new HttpError(400, "Quota must be at least 1 GB."); vals.push(Math.round(g * GB)); sets.push(`quota_bytes = $${vals.length}`); }
    if (b.status !== undefined) { if (!["active", "suspended", "disabled"].includes(b.status)) throw new HttpError(400, "Invalid status."); vals.push(b.status); sets.push(`status = $${vals.length}::public.member_status`); }
    if (!sets.length) throw new HttpError(400, "Nothing to change.");
    const r = await withUser(c.env, c.user!.id, (q) => q.query(`update public.profiles set ${sets.join(", ")} where id = $1 and role = 'member' returning id`, vals));
    if (!r.rows[0]) throw new HttpError(404, "Member not found.");
    return { ok: true };
  }],

  ["DELETE", /^\/api\/admin\/members\/([^/]+)$/, "admin", async (c) => {
    const id = c.params[0];
    if (id === c.user!.id) throw new HttpError(400, "You cannot delete your own account.");
    const keys = (await asService(c.env, (q) => q.query("select app.member_object_keys($1) as k", [id]))).rows.map((r) => r.k as string);
    for (let i = 0; i < keys.length; i += 1000) await c.env.PHOTOS.delete(keys.slice(i, i + 1000));   // stored files first
    await withUser(c.env, c.user!.id, (q) => q.query("select app.delete_member($1)", [id]));
    return { ok: true };
  }],
];
