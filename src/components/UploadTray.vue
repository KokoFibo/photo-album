<script setup lang="ts">
import { computed } from "vue";
import { uploads } from "../lib/uploads";
defineEmits<{ open: [] }>();
const active = computed(() => uploads.items.filter((i) => ["queued", "preparing", "uploading"].includes(i.status)));
const pct = computed(() => { const all = uploads.items.filter((i) => i.status !== "canceled"); return all.length ? Math.round(all.reduce((s, i) => s + (i.status === "done" ? 100 : i.progress), 0) / all.length) : 0; });
</script>
<template>
  <button v-if="active.length" class="fixed bottom-24 right-4 z-30 w-64 rounded-2xl border border-line bg-surface p-3 text-left shadow-xl lg:bottom-6" @click="$emit('open')">
    <div class="flex justify-between text-sm font-medium"><span>Uploading {{ active.length }} photo{{ active.length > 1 ? "s" : "" }}</span><span>{{ pct }}%</span></div>
    <div class="mt-2 h-1.5 rounded-full bg-line"><div class="h-full rounded-full bg-accent transition-all" :style="{ width: pct + '%' }" /></div>
  </button>
</template>
