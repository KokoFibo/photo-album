<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api, authClient, API, type Me } from "../lib/api";

const me = ref<Me | null>(null), draft = ref(""), newEmail = ref(""), msg = ref(""), err = ref(""), emailMsg = ref(""), busy = ref(false);
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");
const changed = () => window.dispatchEvent(new Event("profile-changed"));
async function load() { me.value = await api<Me>("/api/me"); draft.value = me.value.display_name; }

async function saveName() {
  err.value = msg.value = "";
  try { await api("/api/me", { method: "PATCH", body: { displayName: draft.value } }); msg.value = "Display name saved."; await load(); changed(); }
  catch (e: any) { err.value = e.message; }
}
async function pickAvatar(e: Event) {
  const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = ""; err.value = msg.value = "";
  if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { err.value = "Use a JPEG, PNG or WebP image."; return; }
  if (f.size > 15 * 1048576) { err.value = "Choose an image smaller than 15 MB."; return; }
  busy.value = true;
  try {
    const bmp = await createImageBitmap(f), side = Math.min(bmp.width, bmp.height);
    const c = document.createElement("canvas"); c.width = c.height = 512;
    c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512);   // centered square crop
    bmp.close();
    const enc = (t: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, t, q));
    let blob = await enc("image/webp", 0.85); if (!blob || blob.type !== "image/webp") blob = await enc("image/jpeg", 0.88);
    if (!blob) throw new Error("This image could not be processed.");
    const res = await fetch(`${API}/api/me/avatar`, { method: "PUT", credentials: "include", headers: { "Content-Type": blob.type }, body: blob });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "The photo could not be saved.");
    msg.value = "Profile photo updated."; await load(); changed();
  } catch (e: any) { err.value = e.message; }
  busy.value = false;
}
async function removeAvatar() {
  err.value = msg.value = ""; busy.value = true;
  try { await api("/api/me/avatar", { method: "DELETE" }); msg.value = "Profile photo removed."; await load(); changed(); } catch (e: any) { err.value = e.message; }
  busy.value = false;
}
async function changeEmail() {
  err.value = emailMsg.value = ""; busy.value = true;
  try {
    const r: any = await (authClient as any).changeEmail({ newEmail: newEmail.value, callbackURL: `${location.origin}/settings` });
    if (r?.error) throw new Error(r.error.message ?? "The email address could not be changed.");
    emailMsg.value = `We sent an approval link to ${me.value?.email}. After you approve it, we'll ask you to verify ${newEmail.value}.`; newEmail.value = "";
  } catch (e: any) { err.value = e.message; }
  busy.value = false;
}
async function signOut() { await authClient.signOut(); location.href = "/login"; }
onMounted(load);
</script>

<template>
  <h1 class="mb-6 text-4xl font-semibold tracking-tight">My Profile</h1>
  <div v-if="!me" class="h-40 max-w-3xl animate-pulse rounded-2xl bg-surface2" />
  <div v-else class="grid max-w-3xl gap-5">
    <section class="card flex flex-wrap items-center gap-5">
      <div class="grid size-24 place-items-center overflow-hidden rounded-full bg-accent-soft text-3xl font-semibold text-accent"><img v-if="me.avatar_url" :src="me.avatar_url" alt="" class="size-full object-cover" /><span v-else>{{ me.display_name[0] }}</span></div>
      <div class="min-w-0 flex-1"><h2 class="truncate text-xl font-semibold">{{ me.display_name }}</h2>
        <p class="text-muted">{{ me.email }}</p>
        <p class="text-sm text-muted">Member since {{ day(me.created_at) }} · <span :class="['pill', me.status === 'active' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600']">{{ me.status[0].toUpperCase() + me.status.slice(1) }}</span></p></div>
      <div class="flex gap-2"><label :class="['btn cursor-pointer', busy && 'pointer-events-none opacity-60']">{{ me.avatar_url ? "Change photo" : "Upload photo" }}<input hidden type="file" accept="image/jpeg,image/png,image/webp" @change="pickAvatar" /></label>
        <button v-if="me.avatar_url" class="btn btn-d" :disabled="busy" @click="removeAvatar">Remove</button></div>
    </section>
    <p v-if="err" class="text-sm text-red-600" role="alert">{{ err }}</p><p v-if="msg" class="text-sm text-emerald-600" role="status">{{ msg }}</p>
    <section class="card"><h2 class="mb-3 text-lg font-semibold">Display name</h2>
      <form class="flex gap-2" @submit.prevent="saveName"><input v-model="draft" class="field" maxlength="80" required /><button class="btn btn-p" :disabled="draft.trim() === me.display_name">Save</button></form></section>
    <section class="card"><h2 class="mb-1 text-lg font-semibold">Email address</h2><p class="mb-3 text-sm text-muted">Changing your email requires approval and verification.</p>
      <form class="flex gap-2" @submit.prevent="changeEmail"><input v-model="newEmail" type="email" required placeholder="new@example.com" class="field" /><button class="btn" :disabled="busy">Change email</button></form>
      <p v-if="emailMsg" class="mt-2 text-sm text-emerald-600" role="status">{{ emailMsg }}</p></section>
    <section class="card flex flex-wrap justify-between gap-3"><div><h2 class="text-lg font-semibold">Password and session</h2><p class="text-sm text-muted">You are signed in on this device.</p></div>
      <div class="flex gap-2"><a href="/change-password" class="btn">Change password</a><button class="btn" @click="signOut">Sign out</button></div></section>
  </div>
</template>
