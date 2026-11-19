<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import PasswordField from "./PasswordField.vue";
import Turnstile from "./TurnstileWidget.vue";
import { authClient, api } from "../lib/api";

type Mode =
  "login" | "accept" | "register" | "verify" | "forgot" | "reset" | "change";
const props = defineProps<{ mode: Mode }>();
const T: Record<Mode, [string, string, string]> = {
  login: ["Welcome back", "Sign in to your private library.", "Sign in"],
  accept: ["You're invited", "Checking your invitation…", "Continue"],
  register: [
    "Create your account",
    "Choose your name and a strong password.",
    "Create account",
  ],
  verify: [
    "Check your email",
    "We sent a verification link to your email address. Open it to activate your account.",
    "Resend email",
  ],
  forgot: [
    "Forgot your password?",
    "Enter your email and we'll send a reset link.",
    "Send reset link",
  ],
  reset: [
    "Set a new password",
    "Choose a new password for your account.",
    "Reset password",
  ],
  change: ["Change password", "Use at least 10 characters.", "Update password"],
};
const q =
  typeof location === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(location.search);
const token = q.get("token") ?? "";
const bootstrap = q.get("bootstrap") === "1";
const siteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined;
const showCaptcha =
  !!siteKey && ["login", "register", "forgot"].includes(props.mode);
const needsPw = ["login", "register", "reset", "change"].includes(props.mode);
const confirmPw = ["register", "reset", "change"].includes(props.mode);

const email = ref(q.get("email") ?? ""),
  name = ref(""),
  pw = ref(""),
  pw2 = ref(""),
  cur = ref(""),
  captcha = ref("");
const loading = ref(false),
  error = ref(""),
  ok = ref(""),
  ready = ref(true),
  verified = ref(false);
const invite = ref<{ email: string; quotaGB: number } | null>(null);
const widget = ref<{ reset: () => void }>();
const title = computed(() =>
  props.mode === "verify" && verified.value
    ? "Email verified"
    : T[props.mode][0],
);
const sub = computed(() => {
  if (props.mode === "accept")
    return invite.value
      ? `You've been invited to join Album with ${invite.value.quotaGB} GB of storage.`
      : T.accept[1];
  if (props.mode === "verify" && verified.value)
    return "Your email address is confirmed. You can sign in now.";
  return T[props.mode][1];
});
const withCaptcha = () =>
  captcha.value
    ? { headers: { "x-captcha-response": captcha.value } }
    : undefined;
const unwrap = (r: any) => {
  if (r?.error) throw r.error;
  return r.data;
};

onMounted(async () => {
  if (props.mode === "accept" || (props.mode === "register" && !bootstrap)) {
    ready.value = false;
    try {
      if (!token) throw new Error("This invitation link is incomplete.");
      const r = await api<{ email: string; quotaGB: number }>(
        `/api/invitations/validate?token=${encodeURIComponent(token)}`,
      );
      invite.value = r;
      email.value = r.email;
      ready.value = true;
    } catch (e: any) {
      error.value = e.message;
    }
  }
  if (props.mode === "reset" && (!token || q.get("error"))) {
    ready.value = false;
    error.value = "This reset link is invalid or has expired.";
  }
  if (props.mode === "verify") {
    if (q.get("verified") === "1") verified.value = true;
    else if (q.get("error"))
      error.value =
        "This verification link is invalid or has expired. Request a new one below.";
  }
  if (props.mode === "change") {
    const s: any = await authClient.getSession();
    if (!s?.data) location.href = "/login";
    else email.value = s.data.user.email;
  }
});

function friendly(e: any): string {
  const m = String(e?.message ?? ""),
    code = String(e?.code ?? ""),
    both = `${m} ${code}`;
  if (e?.status === 429 || /too many/i.test(both))
    return "Too many attempts. Please try again in a few minutes.";
  if (/captcha/i.test(both))
    return "The security check failed. Please try again.";
  if (/verif/i.test(both) && e?.status === 403)
    return "Please verify your email address first. We sent you a new verification link.";
  if (/invalid[ _]email[ _]or[ _]password/i.test(both))
    return "Incorrect email or password.";
  if (/already[ _]exists/i.test(both))
    return "An account with this email already exists.";
  if (/invitation/i.test(m)) return m;
  if (/failed[ _]to[ _]create/i.test(both))
    return "Registration is not available for this email. You need an invitation.";
  if (/invalid[ _]token|expired/i.test(both))
    return "This link is invalid or has expired. Please request a new one.";
  if (/invalid[ _]password|incorrect/i.test(both))
    return "Your current password is incorrect.";
  if (import.meta.env.DEV && !(e instanceof Error)) {
    console.error("auth error:", e);
    return `Something went wrong. [${e?.status ?? "no status"} ${code || m || "no details"}]`;
  } // development only
  return e instanceof Error ? m : "Something went wrong. Please try again.";
}

async function submit() {
  error.value = ok.value = "";
  if (props.mode === "accept") {
    location.href = `/register?token=${encodeURIComponent(token)}`;
    return;
  }
  if (confirmPw && pw.value.length < 10) {
    error.value = "Password must be at least 10 characters.";
    return;
  }
  if (confirmPw && pw.value !== pw2.value) {
    error.value = "Passwords do not match.";
    return;
  }
  if (showCaptcha && !captcha.value) {
    error.value = "Please complete the security check.";
    return;
  }
  loading.value = true;
  try {
    await run();
  } catch (e: any) {
    error.value = friendly(e);
  } finally {
    loading.value = false;
    widget.value?.reset();
  }
}

async function run() {
  const fetchOptions = withCaptcha();
  if (props.mode === "login") {
    unwrap(
      await authClient.signIn.email({
        email: email.value,
        password: pw.value,
        fetchOptions,
      } as any),
    );
    let me: any;
    try {
      me = await api("/api/me");
    } catch (e) {
      await authClient.signOut();
      throw e;
    } // suspended or disabled accounts are refused here
    ok.value = "Signed in. Redirecting…";
    location.href = "/";
  } else if (props.mode === "register") {
    unwrap(
      await authClient.signUp.email({
        email: email.value,
        password: pw.value,
        name: name.value.trim(),
        callbackURL: `${location.origin}/verify-email?verified=1`,
        ...(bootstrap ? {} : { inviteToken: token }),
        fetchOptions,
      } as any),
    );
    location.href = `/verify-email?email=${encodeURIComponent(email.value)}`;
  } else if (props.mode === "verify") {
    unwrap(
      await authClient.sendVerificationEmail({
        email: email.value,
        callbackURL: `${location.origin}/verify-email?verified=1`,
      } as any),
    );
    ok.value = "Verification email sent.";
  } else if (props.mode === "forgot") {
    const fn =
      (authClient as any).requestPasswordReset ??
      (authClient as any).forgetPassword; // name differs between Better Auth versions
    const r = await fn({
      email: email.value,
      redirectTo: `${location.origin}/reset-password`,
      fetchOptions,
    });
    if (r?.error?.status === 429) throw r.error;
    ok.value =
      "If an account exists for that email, a reset link is on its way."; // same message either way
  } else if (props.mode === "reset") {
    unwrap(
      await authClient.resetPassword({ newPassword: pw.value, token } as any),
    );
    ok.value = "Password updated. You can sign in now.";
  } else if (props.mode === "change") {
    unwrap(
      await authClient.changePassword({
        currentPassword: cur.value,
        newPassword: pw.value,
        revokeOtherSessions: true,
      } as any),
    );
    ok.value = "Password updated.";
  }
}
</script>

<template>
  <h1 class="text-3xl font-semibold tracking-tight">{{ title }}</h1>
  <p class="mb-6 mt-1 text-muted">{{ sub }}</p>
  <p
    v-if="error && !ready"
    class="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600"
    role="alert"
  >
    {{ error }}
  </p>
  <div
    v-if="mode === 'accept' && invite"
    class="mb-4 rounded-xl border border-line bg-surface2 px-4 py-3 text-sm"
  >
    Invitation for <b>{{ invite.email }}</b>
  </div>
  <form v-if="ready" class="space-y-4" @submit.prevent="submit">
    <label
      v-if="['login', 'forgot', 'register', 'verify'].includes(mode)"
      class="block text-sm font-medium"
      >Email
      <input
        v-model="email"
        type="email"
        class="field mt-1.5"
        autocomplete="email"
        required
        :readonly="mode === 'register' && !bootstrap"
    /></label>
    <label v-if="mode === 'register'" class="block text-sm font-medium"
      >Display name<input
        v-model="name"
        class="field mt-1.5"
        required
        maxlength="80"
    /></label>
    <PasswordField
      v-if="mode === 'change'"
      v-model="cur"
      label="Current password"
      autocomplete="current-password"
    />
    <PasswordField
      v-if="needsPw"
      v-model="pw"
      :label="mode === 'login' ? 'Password' : 'New password'"
      :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
    />
    <PasswordField
      v-if="confirmPw"
      v-model="pw2"
      label="Confirm password"
      autocomplete="new-password"
    />
    <Turnstile
      v-if="showCaptcha"
      ref="widget"
      :site-key="siteKey!"
      @token="captcha = $event"
    />
    <p
      v-if="error"
      class="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="ok"
      class="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600"
      role="status"
    >
      {{ ok }}
    </p>
    <button
      v-if="!(mode === 'verify' && verified)"
      class="btn btn-p w-full"
      :disabled="loading"
    >
      {{ loading ? "Please wait…" : T[mode][2] }}
    </button>
  </form>
  <div class="mt-5 text-sm text-muted">
    <a v-if="mode === 'login'" href="/forgot-password" class="text-accent"
      >Forgot your password?</a
    >
    <a v-else-if="mode !== 'change'" href="/login" class="text-accent"
      >Back to sign in</a
    >
    <p v-if="mode === 'login'" class="mt-3">
      Album is invitation-only. Ask the administrator for an invitation.
    </p>
  </div>
</template>
