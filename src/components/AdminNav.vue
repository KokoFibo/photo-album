<script setup lang="ts">
import { onMounted } from "vue";
import { guard } from "../lib/api";
const props = defineProps<{ path: string }>();
onMounted(() => guard(true));
const nav = [["/admin", "Overview"], ["/admin/members", "Members"], ["/admin/invitations", "Invitations"], ["/admin/storage", "Storage Management"], ["/admin/uploads", "Upload Activity"], ["/admin/jobs", "Background Jobs"], ["/admin/status", "System Status"], ["/admin/settings", "Settings"]];
const on = (p: string) => (p === "/admin" ? props.path.replace(/\/$/, "") === "/admin" : props.path.startsWith(p));
</script>
<template>
  <aside class="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col gap-1 border-r border-line bg-surface p-4 lg:flex">
    <div class="px-3 text-xl font-semibold tracking-tight">Album</div><div class="mb-4 px-3 text-xs uppercase tracking-wider text-accent">Administration</div>
    <a v-for="[h, l] in nav" :key="h" :href="h" :class="['rounded-xl px-3 py-2 font-medium', on(h) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface2 hover:text-ink']">{{ l }}</a>
    <a href="/" class="mt-auto rounded-xl px-3 py-2 font-medium text-muted hover:bg-surface2">‹ Back to library</a>
  </aside>
  <nav class="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 text-sm lg:hidden"><a v-for="[h, l] in nav" :key="h" :href="h" :class="['whitespace-nowrap rounded-full px-3 py-1', on(h) ? 'bg-accent-soft text-accent' : 'text-muted']">{{ l }}</a></nav>
</template>
