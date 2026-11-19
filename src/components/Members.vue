<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../lib/api";
import { statusStyle } from "../data/admin";
interface M { id: string; display_name: string; email: string | null; status: string; role: string; quota_bytes: number; used_bytes: number; created_at: string; last_active_at: string | null }
const GB = 1073741824;
const rows = ref<M[]>([]), q = ref(""), f = ref("All"), sel = ref<string | null>(null), dName = ref(""), dQuota = ref(0), del = ref(""), toast = ref(""), err = ref("");
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const shown = computed(() => rows.value.filter((m) => (f.value === "All" || label(m.status) === f.value) && ((m.display_name ?? "") + (m.email ?? "")).toLowerCase().includes(q.value.toLowerCase())));
const cur = computed(() => rows.value.find((m) => m.id === sel.value));
watch(sel, () => { const m = cur.value; if (m) { dName.value = m.display_name; dQuota.value = Math.round(m.quota_bytes / GB); } del.value = ""; err.value = ""; });
const flash = (s: string) => { toast.value = s; setTimeout(() => (toast.value = ""), 2500); };
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");
async function load() { try { rows.value = await api<M[]>("/api/admin/members"); } catch { err.value = "Members could not be loaded."; } }
async function patch(body: Record<string, unknown>, done: string) {
  err.value = "";
  try { await api(`/api/admin/members/${sel.value}`, { method: "PATCH", body }); await load(); flash(done); } catch (e: any) { err.value = e.message; }
}
const save = () => patch({ displayName: dName.value, quotaGB: dQuota.value }, "Changes saved.");
const toggle = () => patch({ status: cur.value!.status === "active" ? "suspended" : "active" }, cur.value!.status === "active" ? "Member suspended." : "Member activated.");
async function remove() {
  try { await api(`/api/admin/members/${sel.value}`, { method: "DELETE" }); sel.value = null; await load(); flash("Member account deleted."); } catch (e: any) { err.value = e.message; }
}
onMounted(load);
</script>
<template>
  <div class="mb-4 flex flex-wrap gap-2"><input v-model="q" placeholder="Search by name or email" class="field max-w-xs" />
    <select v-model="f" class="field w-40"><option>All</option><option>Active</option><option>Suspended</option><option>Disabled</option></select></div>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface"><table class="rtable w-full text-left text-sm">
    <thead class="text-muted"><tr><th class="p-3">Member</th><th>Status</th><th>Storage</th><th>Created</th><th>Last activity</th></tr></thead>
    <tbody><tr v-for="m in shown" :key="m.id" class="cursor-pointer border-t border-line hover:bg-surface2" @click="sel = m.id">
      <td data-primary class="p-3"><b class="font-medium">{{ m.display_name }}</b><div class="text-muted">{{ m.email }}</div></td><td data-label="Status"><span :class="['pill', statusStyle[label(m.status)]]">{{ label(m.status) }}</span></td>
      <td data-label="Storage">{{ (m.used_bytes / GB).toFixed(1) }} / {{ Math.round(m.quota_bytes / GB) }} GB</td><td data-label="Created">{{ day(m.created_at) }}</td><td data-label="Last activity">{{ day(m.last_active_at) }}</td></tr>
      <tr v-if="!shown.length"><td colspan="5" class="p-8 text-center text-muted">No members match your search.</td></tr></tbody></table></div>
  <p v-if="toast" class="mt-3 text-sm text-emerald-600" role="status">{{ toast }}</p>
  <p v-if="err && !cur" class="mt-3 text-sm text-red-600" role="alert">{{ err }}</p>
  <div v-if="cur" class="fixed inset-0 z-40 flex justify-end bg-black/40" @click.self="sel = null"><div class="w-full max-w-md overflow-auto bg-surface p-6">
    <div class="flex justify-between"><h2 class="text-2xl font-semibold">Member details</h2><button @click="sel = null">✕</button></div>
    <label class="mt-5 block text-sm font-medium">Display name<input v-model="dName" class="field mt-1.5" maxlength="80" /></label>
    <p class="mt-3 text-sm text-muted">{{ cur.email }} · created {{ day(cur.created_at) }} · last active {{ day(cur.last_active_at) }}</p>
    <label class="mt-4 block text-sm font-medium">Storage quota (GB)<input v-model.number="dQuota" type="number" min="1" class="field mt-1.5" /></label>
    <div class="my-3 h-2 rounded-full bg-line"><div class="h-full rounded-full bg-accent" :style="{ width: Math.min(100, (cur.used_bytes / cur.quota_bytes) * 100) + '%' }" /></div>
    <p class="text-sm text-muted">{{ (cur.used_bytes / GB).toFixed(1) }} GB used. Only totals are visible to administrators.</p>
    <p v-if="err" class="mt-3 text-sm text-red-600" role="alert">{{ err }}</p>
    <div v-if="cur.role !== 'super_admin'" class="mt-5 flex gap-2"><button class="btn" @click="toggle">{{ cur.status === 'active' ? 'Suspend' : 'Activate' }}</button><button class="btn btn-p" @click="save">Save</button></div>
    <p v-else class="mt-5 text-sm text-muted">Super Admin accounts are managed from the database.</p>
    <div v-if="cur.role !== 'super_admin'" class="mt-8 rounded-xl border border-red-500/30 p-4"><h3 class="font-semibold text-red-600">Delete account</h3><p class="my-2 text-sm text-muted">Type <b>DELETE</b> to confirm. This permanently removes the member and their library.</p>
      <input v-model="del" class="field" /><button class="btn btn-d mt-2" :disabled="del !== 'DELETE'" @click="remove">Delete member</button></div></div></div>
</template>
