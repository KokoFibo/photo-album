<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
const o = ref<any>(null), health = ref<"ok" | "warn" | "down" | "">(""), err = ref("");
onMounted(async () => {
  try { o.value = await api("/api/admin/overview"); } catch (e: any) { err.value = e.message; }
  try { const s = await api<any>("/api/admin/status"); health.value = Object.values(s.checks).some((c: any) => !c.ok) ? "down" : s.cleanup.warn ? "warn" : "ok"; } catch { health.value = "down"; }
});
</script>
<template>
  <p v-if="err" class="mb-4 text-sm text-red-600" role="alert">{{ err }}</p>
  <div v-if="!o" class="grid grid-cols-2 gap-4 lg:grid-cols-4"><div v-for="n in 8" :key="n" class="h-24 animate-pulse rounded-2xl bg-surface2" /></div>
  <template v-else>
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <a href="/admin/members" class="card hover:border-accent"><div class="text-sm text-muted">Members</div><div class="mt-1 text-3xl font-semibold">{{ o.members }}</div><div class="text-xs text-muted">{{ o.active }} active · {{ o.inactive }} suspended or disabled</div></a>
      <a href="/admin/invitations" class="card hover:border-accent"><div class="text-sm text-muted">Pending invitations</div><div class="mt-1 text-3xl font-semibold">{{ o.pending_invites }}</div></a>
      <a href="/admin/storage" class="card hover:border-accent"><div class="text-sm text-muted">Storage used</div><div class="mt-1 text-3xl font-semibold">{{ bytes(o.used_bytes) }}</div><div class="text-xs text-muted">of {{ bytes(o.quota_bytes) }} allocated</div></a>
      <div class="card"><div class="text-sm text-muted">Photos · albums</div><div class="mt-1 text-3xl font-semibold">{{ o.photos }} <span class="text-lg text-muted">· {{ o.albums }}</span></div></div>
      <a href="/admin/uploads" class="card hover:border-accent"><div class="text-sm text-muted">Uploads, last 7 days</div><div class="mt-1 text-3xl font-semibold">{{ o.uploads_7d }}</div></a>
      <a href="/admin/uploads" :class="['card hover:border-accent', o.failed_uploads > 0 && '!border-amber-500/50']"><div class="text-sm text-muted">Failed or stuck uploads</div><div class="mt-1 text-3xl font-semibold">{{ o.failed_uploads }}</div></a>
    </div>
    <a href="/admin/status" class="card mt-5 flex items-center justify-between hover:border-accent">
      <div><h2 class="text-lg font-semibold">{{ health === "ok" ? "All systems operational" : health === "warn" ? "Needs attention" : health === "down" ? "A system check failed" : "Checking systems…" }}</h2>
        <p class="text-sm text-muted">Database, file storage and the daily cleanup. Open System Status for details.</p></div>
      <span :class="['pill', health === 'ok' ? 'bg-emerald-500/15 text-emerald-600' : health === 'warn' ? 'bg-amber-500/15 text-amber-600' : health === 'down' ? 'bg-red-500/15 text-red-600' : 'bg-slate-500/15 text-muted']">{{ health === "ok" ? "Healthy" : health === "warn" ? "Attention" : health === "down" ? "Problem" : "…" }}</span></a>
  </template>
</template>
