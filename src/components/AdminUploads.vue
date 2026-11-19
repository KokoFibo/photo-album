<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
interface D { day: string; uploads: number; bytes: number; failed: number }
const days = ref(14), rows = ref<D[]>([]), err = ref(""), loading = ref(true);
const max = computed(() => Math.max(1, ...rows.value.map((r) => r.uploads)));
const total = computed(() => rows.value.reduce((s, r) => s + r.uploads, 0)), fails = computed(() => rows.value.reduce((s, r) => s + r.failed, 0));
const short = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
async function load() { loading.value = true; try { rows.value = await api<D[]>(`/api/admin/uploads?days=${days.value}`); err.value = ""; } catch (e: any) { err.value = e.message; } loading.value = false; }
onMounted(load);
</script>
<template>
  <div class="mb-4 flex flex-wrap items-center gap-3"><select v-model.number="days" class="field !w-40" @change="load"><option :value="7">Last 7 days</option><option :value="14">Last 14 days</option><option :value="30">Last 30 days</option></select>
    <span class="text-sm text-muted">{{ total }} uploads · {{ fails }} failed or stuck</span></div>
  <p v-if="err" class="mb-4 text-sm text-red-600" role="alert">{{ err }}</p>
  <div class="card mb-5"><div class="flex h-40 items-end gap-1.5" role="img" aria-label="Uploads per day">
    <div v-for="r in rows" :key="r.day" class="group flex h-full flex-1 flex-col justify-end" :title="`${short(r.day)}: ${r.uploads} uploads`"><div class="w-full rounded-t bg-accent/80 transition group-hover:bg-accent" :style="{ height: (r.uploads / max) * 100 + '%', minHeight: r.uploads ? '3px' : '0' }" /></div></div>
    <div class="mt-2 flex justify-between text-xs text-muted"><span>{{ rows.length ? short(rows[0].day) : "" }}</span><span>{{ rows.length ? short(rows[rows.length - 1].day) : "" }}</span></div></div>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface"><table class="rtable w-full text-left text-sm"><thead class="text-muted"><tr><th class="p-3">Day</th><th>Uploads</th><th>Size</th><th>Failed or stuck</th></tr></thead>
    <tbody><tr v-for="r in [...rows].reverse()" :key="r.day" class="border-t border-line"><td data-label="Day" class="p-3">{{ short(r.day) }}</td><td data-label="Uploads">{{ r.uploads }}</td><td data-label="Size">{{ bytes(r.bytes) }}</td><td data-label="Failed or stuck" :class="r.failed ? 'text-amber-600' : 'text-muted'">{{ r.failed }}</td></tr>
      <tr v-if="!loading && !rows.length"><td colspan="4" class="p-8 text-center text-muted">No data.</td></tr></tbody></table></div>
  <p class="mt-3 text-xs text-muted">"Stuck" means an upload that started more than an hour ago and never finished. They are cleaned up automatically after 24 hours.</p>
</template>
