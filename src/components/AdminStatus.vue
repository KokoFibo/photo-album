<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../lib/api";
import { when, ago } from "../lib/format";
const s = ref<any>(null), err = ref(""), busy = ref(false);
const rows = [["database", "Database (application)"], ["service", "Database (background jobs)"], ["storage", "File storage (R2)"]];
async function load() { busy.value = true; try { s.value = await api("/api/admin/status"); err.value = ""; } catch (e: any) { err.value = e.message; } busy.value = false; }
onMounted(load);
</script>
<template>
  <div class="mb-5 flex items-center justify-between"><p class="text-sm text-muted">Checked just now from the server.</p><button class="btn" :disabled="busy" @click="load">{{ busy ? "Checking…" : "Check again" }}</button></div>
  <p v-if="err" class="mb-3 text-sm text-red-600" role="alert">{{ err }}</p>
  <div v-if="!s && !err" class="h-40 animate-pulse rounded-2xl bg-surface2" />
  <template v-if="s">
    <div class="overflow-hidden rounded-2xl border border-line bg-surface"><ul class="divide-y divide-line text-sm">
      <li v-for="[k, l] in rows" :key="k" class="flex items-center justify-between gap-3 p-4"><div><b class="font-medium">{{ l }}</b><div v-if="s.checks[k].error" class="text-xs text-red-600">{{ s.checks[k].error }}</div></div>
        <div class="flex items-center gap-3"><span class="text-xs text-muted">{{ s.checks[k].ms }} ms</span><span :class="['pill', s.checks[k].ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600']">{{ s.checks[k].ok ? "OK" : "Problem" }}</span></div></li>
      <li class="flex items-center justify-between gap-3 p-4"><div><b class="font-medium">Daily cleanup</b><div class="text-xs text-muted">{{ s.cleanup.message }} Last run: {{ s.cleanup.lastRun ? `${when(s.cleanup.lastRun)} (${ago(s.cleanup.lastRun)})` : "never" }}</div></div>
        <span :class="['pill', s.cleanup.warn ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600']">{{ s.cleanup.warn ? "Attention" : "OK" }}</span></li></ul></div>
    <p class="mt-3 text-xs text-muted">Environment: {{ s.environment }}. <a href="/admin/jobs" class="text-accent">Open Background Jobs</a></p>
  </template>
</template>
