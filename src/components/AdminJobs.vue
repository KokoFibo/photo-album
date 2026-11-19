<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../lib/api";
import { when, ago } from "../lib/format";
interface Run { id: number; job: string; started_at: string; finished_at: string | null; ok: boolean | null; summary: Record<string, number>; error: string | null }
const runs = ref<Run[]>([]), b = ref<any>({}), err = ref(""), msg = ref(""), busy = ref(false);
const describe = (r: Run) => (r.summary && Object.keys(r.summary).length ? `${r.summary.photos ?? 0} photos and ${r.summary.albums ?? 0} albums purged, ${r.summary.abandonedUploads ?? 0} abandoned uploads removed` : "—");
async function load() { try { const r = await api<{ backlog: any; runs: Run[] }>("/api/admin/jobs"); b.value = r.backlog; runs.value = r.runs; err.value = ""; } catch (e: any) { err.value = e.message; } }
async function run() {
  busy.value = true; msg.value = err.value = "";
  try { await api("/api/admin/jobs/run", { method: "POST" }); msg.value = "Cleanup finished."; await load(); } catch (e: any) { err.value = e.message; }
  busy.value = false;
}
onMounted(load);
</script>
<template>
  <div class="mb-5 flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-muted">The cleanup runs every day at 03:00. It removes Trash older than 30 days, abandoned uploads and expired reservations.</p>
    <button class="btn btn-p" :disabled="busy" @click="run">{{ busy ? "Running…" : "Run cleanup now" }}</button></div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p><p v-if="err" class="mb-3 text-sm text-red-600" role="alert">{{ err }}</p>
  <div class="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
    <div v-for="[k, l] in [['photos_due', 'Photos waiting to be purged'], ['albums_due', 'Albums waiting to be purged'], ['stale_uploads', 'Abandoned uploads'], ['stale_reservations', 'Expired reservations'], ['in_trash', 'Photos in Trash']]" :key="k" :class="['card', k !== 'in_trash' && b[k] > 0 && '!border-amber-500/50']"><div class="text-xs text-muted">{{ l }}</div><div class="mt-1 text-2xl font-semibold">{{ b[k] ?? "–" }}</div></div></div>
  <h2 class="mb-2 text-lg font-semibold">Recent runs</h2>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface"><table class="rtable w-full text-left text-sm"><thead class="text-muted"><tr><th class="p-3">Finished</th><th>Result</th><th>Details</th></tr></thead>
    <tbody><tr v-for="r in runs" :key="r.id" class="border-t border-line align-top"><td data-label="Finished" class="p-3 whitespace-nowrap">{{ when(r.finished_at) }}<div class="text-xs text-muted">{{ ago(r.finished_at) }}</div></td>
      <td data-label="Result"><span :class="['pill', r.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600']">{{ r.ok ? "OK" : "Needs retry" }}</span></td>
      <td data-label="Details" class="text-muted">{{ describe(r) }}<div v-if="r.error" class="text-red-600">{{ r.error }}</div></td></tr>
      <tr v-if="!runs.length"><td colspan="3" class="p-8 text-center text-muted">No runs recorded yet. Use "Run cleanup now" to start one.</td></tr></tbody></table></div>
  <p class="mt-3 text-xs text-muted">Files that could not be deleted keep their quota and are retried on the next run.</p>
</template>
