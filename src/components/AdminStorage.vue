<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { statusStyle } from "../data/admin";
interface M { id: string; display_name: string; email: string | null; status: string; used_bytes: number; quota_bytes: number; photos: number }
const rows = ref<M[]>([]), err = ref(""), loading = ref(true);
const used = computed(() => rows.value.reduce((s, m) => s + m.used_bytes, 0)), quota = computed(() => rows.value.reduce((s, m) => s + m.quota_bytes, 0));
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
onMounted(async () => { try { rows.value = await api<M[]>("/api/admin/storage"); } catch (e: any) { err.value = e.message; } loading.value = false; });
</script>
<template>
  <p v-if="err" class="mb-4 text-sm text-red-600" role="alert">{{ err }}</p>
  <div class="card mb-5"><div class="text-sm text-muted">Total storage used</div><div class="mt-1 text-3xl font-semibold">{{ bytes(used) }} <span class="text-lg font-normal text-muted">of {{ bytes(quota) }} allocated</span></div>
    <div class="mt-3 h-2 rounded-full bg-line"><div class="h-full rounded-full bg-accent" :style="{ width: Math.min(100, (used / (quota || 1)) * 100) + '%' }" /></div></div>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface"><table class="w-full text-left text-sm">
    <thead class="text-muted"><tr><th class="p-3">Member</th><th>Status</th><th class="min-w-48">Usage</th><th>Photos</th><th></th></tr></thead>
    <tbody>
      <tr v-for="m in rows" :key="m.id" class="border-t border-line"><td class="p-3"><b class="font-medium">{{ m.display_name }}</b><div class="text-muted">{{ m.email }}</div></td>
        <td><span :class="['pill', statusStyle[label(m.status)]]">{{ label(m.status) }}</span></td>
        <td><div class="h-1.5 w-40 rounded-full bg-line"><div :class="['h-full rounded-full', m.used_bytes / (m.quota_bytes || 1) > 0.9 ? 'bg-amber-500' : 'bg-accent']" :style="{ width: Math.min(100, (m.used_bytes / (m.quota_bytes || 1)) * 100) + '%' }" /></div><div class="mt-1 text-xs text-muted">{{ bytes(m.used_bytes) }} of {{ bytes(m.quota_bytes) }}</div></td>
        <td>{{ m.photos }}</td><td class="p-2 text-right"><a href="/admin/members" class="btn !h-8">Change quota</a></td></tr>
      <tr v-if="!loading && !rows.length"><td colspan="5" class="p-8 text-center text-muted">No members yet.</td></tr></tbody></table></div>
  <p class="mt-3 text-xs text-muted">Totals only. Administrators cannot see members' photos, albums or locations.</p>
</template>
