<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../lib/api";
import { statusStyle } from "../data/admin";
interface Row { id: string; email: string; quota_bytes: number; status: string; created_at: string; expires_at: string; accepted_at: string | null }
const rows = ref<Row[]>([]), q = ref(""), f = ref("All"), email = ref(""), quota = ref(20), days = ref(7);   // defaults come from Admin > Settings
const msg = ref(""), err = ref(""), devLink = ref(""), busy = ref(false);
const eff = (i: Row) => (i.status === "pending" && new Date(i.expires_at) < new Date() ? "expired" : i.status);
const label = (i: Row) => eff(i)[0].toUpperCase() + eff(i).slice(1);
const shown = computed(() => rows.value.filter((i) => (f.value === "All" || label(i) === f.value) && i.email.toLowerCase().includes(q.value.toLowerCase())));
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");
async function load() { try { rows.value = await api<Row[]>("/api/admin/invitations"); } catch { err.value = "Invitations could not be loaded."; } }
async function act(fn: () => Promise<{ devLink?: string }>, done: string) {
  err.value = msg.value = devLink.value = ""; busy.value = true;
  try { const r = await fn(); msg.value = done; devLink.value = r?.devLink ?? ""; await load(); }
  catch (e: any) { err.value = e.message; } finally { busy.value = false; }
}
const create = () => act(async () => {
  const r = await api<{ devLink?: string }>("/api/admin/invitations", { method: "POST", body: { email: email.value, quotaGB: quota.value, expiresInDays: days.value } });
  email.value = ""; return r;
}, "Invitation created and emailed.");
const resend = (i: Row) => act(() => api(`/api/admin/invitations/${i.id}/resend`, { method: "POST", body: { expiresInDays: days.value } }), "Invitation resent with a new link.");
const revoke = (i: Row) => act(() => api(`/api/admin/invitations/${i.id}/revoke`, { method: "POST" }), "Invitation revoked.");
onMounted(async () => { load(); try { const s = await api<{ default_quota_gb: number; invite_expiry_days: number }>("/api/admin/settings"); quota.value = s.default_quota_gb; days.value = s.invite_expiry_days; } catch { /* keep built-in defaults */ } });
</script>
<template>
  <form class="card mb-6 grid gap-3 sm:grid-cols-[1fr_110px_120px_auto]" @submit.prevent="create">
    <input v-model="email" type="email" required placeholder="Email address" class="field" />
    <input v-model.number="quota" type="number" min="1" max="1000" class="field" title="Initial quota (GB)" />
    <select v-model.number="days" class="field"><option :value="1">1 day</option><option :value="3">3 days</option><option :value="7">7 days</option><option :value="14">14 days</option><option :value="30">30 days</option></select>
    <button class="btn btn-p" :disabled="busy">Send invitation</button></form>
  <p v-if="err" class="mb-3 text-sm text-red-600" role="alert">{{ err }}</p>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p>
  <p v-if="devLink" class="mb-3 break-all rounded-xl border border-line bg-surface2 p-3 text-sm">Development mode, no email was sent. Invitation link: <a :href="devLink" class="text-accent">{{ devLink }}</a></p>
  <div class="mb-4 flex flex-wrap gap-2"><input v-model="q" placeholder="Search invitations" class="field max-w-xs" /><select v-model="f" class="field w-40"><option>All</option><option>Pending</option><option>Accepted</option><option>Expired</option><option>Revoked</option></select></div>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface"><table class="w-full text-left text-sm"><thead class="text-muted"><tr><th class="p-3">Email</th><th>Status</th><th>Quota</th><th>Created</th><th>Expires</th><th>Accepted</th><th></th></tr></thead>
    <tbody><tr v-for="i in shown" :key="i.id" class="border-t border-line"><td class="p-3">{{ i.email }}</td><td><span :class="['pill', statusStyle[label(i)]]">{{ label(i) }}</span></td><td>{{ Math.round(i.quota_bytes / 1073741824) }} GB</td><td>{{ day(i.created_at) }}</td><td>{{ day(i.expires_at) }}</td><td>{{ day(i.accepted_at) }}</td>
      <td class="space-x-1 whitespace-nowrap p-2 text-right"><button v-if="['pending', 'expired'].includes(eff(i))" class="btn !h-8" :disabled="busy" @click="resend(i)">Resend</button><button v-if="eff(i) === 'pending'" class="btn btn-d !h-8" :disabled="busy" @click="revoke(i)">Revoke</button></td></tr>
      <tr v-if="!shown.length"><td colspan="7" class="p-8 text-center text-muted">No invitations found.</td></tr></tbody></table></div>
</template>
