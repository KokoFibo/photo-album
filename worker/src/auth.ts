import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import type { Pool } from "pg";
import { asService } from "./db";
import { sendMail } from "./mail";
import { sha256Hex, type Env } from "./http";

const m = (table: string, fields: Record<string, string>) => ({ modelName: table, fields });

export function makeAuth(env: Env, pool: Pool) {
  return betterAuth({
    baseURL: env.API_URL, secret: env.BETTER_AUTH_SECRET, trustedOrigins: [env.APP_URL], database: pool,
    // Better Auth's camelCase fields -> our snake_case columns (see db/migrations/*_core.sql)
    user: {
      ...m("auth_user", { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" }),
      // Changing the email address: approve from the current address, then verify the new one
      changeEmail: { enabled: true, sendChangeEmailVerification: async ({ user, newEmail, url }: any) => { await sendMail(env, user.email, "Approve your Album email change", `Approve changing your Album email address to ${newEmail}.`, url, "Approve change"); } },
    },
    session: m("auth_session", { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at", ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id" }),
    account: m("auth_account", { accountId: "account_id", providerId: "provider_id", userId: "user_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" }),
    verification: m("auth_verification", { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" }),
    emailAndPassword: {
      enabled: true, minPasswordLength: 10, maxPasswordLength: 128, requireEmailVerification: true, autoSignIn: false,
      sendResetPassword: async ({ user, url }) => { await sendMail(env, user.email, "Reset your Album password", "We received a request to reset your password.", url, "Reset password"); },
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => { await sendMail(env, user.email, "Verify your Album email address", "Confirm your email address to activate your account.", url, "Verify email"); },
    },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 8 }, "/sign-up/email": { window: 60, max: 5 }, "/forget-password": { window: 60, max: 5 }, "/request-password-reset": { window: 60, max: 5 } } },
    plugins: env.TURNSTILE_SECRET ? [captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET })] : [],
    hooks: {
      // Invitation-only: a signup with an invitation token is validated here (the token is hashed, never stored raw).
      // Without a token only the bootstrap admin email gets through the database trigger; everyone else is rejected there.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const body = (ctx.body ?? {}) as { inviteToken?: string; email?: string };
        if (!body.inviteToken) return;
        try { await asService(env, async (q) => q.query("select app.begin_signup($1, $2)", [await sha256Hex(String(body.inviteToken)), String(body.email ?? "").toLowerCase()])); }
        catch { throw new APIError("BAD_REQUEST", { message: "This invitation is invalid, expired or was issued for another email address." }); }
      }),
    },
  });
}
