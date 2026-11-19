<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, authClient, type Me } from "../lib/api";

interface Storage { photo_count: number; albums: number; originals: number; variants: number; trash: number; used: number; quota: number }
const me = ref<Me | null>(null), st = ref<Storage | null>(null), draftName = ref(""), theme = ref("dark"), draftTheme = ref("dark");
const verified = ref<boolean | null>(null), sessions = ref<any[]>([]), currentId = ref("");
const msg = ref(""), err = ref(""), saving = ref(false);
const GB = 1073741824, MB = 1048576;
const fmt = (n: number) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : `${(n / MB).toFixed(1)} MB`);
const pct = (n: number) => (st.value ? Math.min(100, (n / (st.value.quota || 1)) * 100) : 0);
const dirty = computed(() => draftName.value.trim() !== me.value?.display_name || draftTheme.value !== theme.value);
const browser = (ua?: string) => (!ua ? "Unknown device" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser") + (/Windows/.test(ua) ? " on Windows" : /Mac OS/.test(ua) ? " on macOS" : /Android/.test(ua) ? " on Android" : /iPhone|iPad/.test(ua) ? " on iOS" : /Linux/.test(ua) ? " on Linux" : "");

async function load() {
  me.value = await api<Me>("/api/me"); draftName.value = me.value.display_name;
  theme.value = draftTheme.value = document.documentElement.dataset.theme ?? "dark";
  st.value = await api<Storage>("/api/me/storage").catch(() => null);
  try {
    const s: any = await authClient.getSession(); verified.value = s?.data?.user?.emailVerified ?? null; currentId.value = s?.data?.session?.id ?? "";
    const l: any = await (authClient as any).listSessions(); sessions.value = l?.data ?? [];
  } catch { /* session details are optional */ }
}
async function save() {
  err.value = msg.value = ""; saving.value = true;
  try {
    if (draftName.value.trim() !== me.value?.display_name) { await api("/api/me", { method: "PATCH", body: { displayName: draftName.value } }); window.dispatchEvent(new Event("profile-changed")); }
    if (draftTheme.value !== theme.value) { document.documentElement.dataset.theme = draftTheme.value; try { localStorage.setItem("theme", draftTheme.value); } catch {} }
    msg.value = "Settings saved."; await load();
  } catch (e: any) { err.value = e.message; }
  saving.value = false;
}
function cancel() { draftName.value = me.value?.display_name ?? ""; draftTheme.value = theme.value; err.value = msg.value = ""; }
async function signOutOthers() {
  err.value = msg.value = "";
  try { const r: any = await (authClient as any).revokeOtherSessions(); if (r?.error) throw new Error(r.error.message); msg.value = "Signed out of your other devices."; await load(); }
  catch (e: any) { err.value = e.message || "Other sessions could not be ended."; }
}
async function signOut() { await authClient.signOut(); location.href = "/login"; }
onMounted(load);
</script>

<template>
  <h1 class="mb-6 text-4xl font-semibold tracking-tight">Settings</h1>
  <div v-if="!me" class="h-40 max-w-3xl animate-pulse rounded-2xl bg-surface2" />
  <div v-else class="grid max-w-3xl gap-5">
    <section class="card"><h2 class="mb-3 text-lg font-semibold">Personal information</h2>
      <label class="block text-sm font-medium">Display name<input v-model="draftName" class="field mt-1.5" maxlength="80" /></label>
      <p class="mt-3 text-sm text-muted">Email: {{ me.email }} · <a href="/profile" class="text-accent">Change photo or email</a></p></section>

    <section class="card"><h2 class="mb-3 text-lg font-semibold">Security</h2>
      <ul class="space-y-2 text-sm">
        <li class="flex justify-between"><span class="text-muted">Email verification</span><span :class="['pill', verified === false ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600']">{{ verified === false ? "Not verified" : "Verified" }}</span></li>
        <li class="flex justify-between"><span class="text-muted">Active sessions</span><span>{{ sessions.length || 1 }}</span></li>
        <li v-for="s in sessions" :key="s.id" class="flex justify-between gap-3 text-muted"><span class="truncate">{{ browser(s.userAgent) }}<template v-if="s.id === currentId"> · this device</template></span><span class="shrink-0">{{ new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }}</span></li></ul>
      <div class="mt-4 flex flex-wrap gap-2"><a href="/change-password" class="btn">Change password</a><button v-if="sessions.length > 1" class="btn" @click="signOutOthers">Sign out other devices</button><button class="btn" @click="signOut">Sign out</button></div></section>

    <section class="card"><h2 class="mb-3 text-lg font-semibold">Appearance</h2>
      <div class="flex gap-3"><label v-for="t in ['light', 'dark']" :key="t" :class="['flex-1 cursor-pointer rounded-xl border p-3 capitalize', draftTheme === t ? 'border-accent bg-accent-soft' : 'border-line']">
        <input v-model="draftTheme" type="radio" :value="t" class="mr-2" />{{ t }} mode</label></div></section>

    <section class="card"><h2 class="mb-3 text-lg font-semibold">Storage</h2>
      <template v-if="st">
        <p><b class="text-2xl font-semibold">{{ fmt(me.used_bytes) }}</b> <span class="text-muted">of {{ fmt(me.quota_bytes) }} used · {{ fmt(Math.max(0, me.quota_bytes - me.used_bytes)) }} remaining</span></p>
        <div class="my-3 flex h-2.5 overflow-hidden rounded-full bg-line"><div class="bg-accent" :style="{ width: pct(st.originals) + '%' }" /><div class="bg-sky-400" :style="{ width: pct(st.variants) + '%' }" /><div class="bg-amber-400" :style="{ width: pct(st.trash) + '%' }" /></div>
        <ul class="space-y-1 text-sm text-muted">
          <li class="flex justify-between"><span><i class="mr-2 inline-block size-2 rounded-full bg-accent" />Original photos ({{ st.photo_count }})</span><span>{{ fmt(st.originals) }}</span></li>
          <li class="flex justify-between"><span><i class="mr-2 inline-block size-2 rounded-full bg-sky-400" />Generated sizes</span><span>{{ fmt(st.variants) }}</span></li>
          <li class="flex justify-between"><span><i class="mr-2 inline-block size-2 rounded-full bg-amber-400" />Trash</span><span>{{ fmt(st.trash) }}</span></li>
          <li class="flex justify-between"><span>Albums</span><span>{{ st.albums }}</span></li></ul>
        <p class="mt-3 text-xs text-muted">Profile photos are not counted toward your storage.</p></template>
      <p v-else class="text-sm text-muted">Storage details are not available right now.</p></section>

    <p v-if="err" class="text-sm text-red-600" role="alert">{{ err }}</p>
    <div class="flex items-center justify-end gap-2"><span v-if="msg" class="mr-auto text-sm text-emerald-600" role="status">{{ msg }}</span>
      <button class="btn" :disabled="!dirty || saving" @click="cancel">Cancel</button><button class="btn btn-p" :disabled="!dirty || saving" @click="save">{{ saving ? "Saving…" : "Save changes" }}</button></div>
  </div>
</template>
