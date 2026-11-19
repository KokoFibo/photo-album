import type { Env } from "./http";

/** Development outbox: nothing is sent; open http://localhost:8787/dev/mail to read the messages. */
export const outbox: { at: string; to: string; subject: string; link: string }[] = [];
const esc = (s: string) => s.replace(/[<>&"]/g, "");

export async function sendMail(env: Env, to: string, subject: string, intro: string, link: string, button: string): Promise<{ devLink?: string }> {
  if (env.ENVIRONMENT !== "production" || !env.RESEND_API_KEY) {
    outbox.unshift({ at: new Date().toISOString(), to, subject, link }); outbox.splice(30);
    console.log(`[dev email] ${subject} -> ${to}\n${link}`);
    return { devLink: link };
  }
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>${esc(subject)}</h2><p>${esc(intro)}</p><p><a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">${esc(button)}</a></p><p style="color:#777">If you weren't expecting this email, you can ignore it.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }) });
  if (!r.ok) throw new Error("The email could not be sent.");
  return {};
}
