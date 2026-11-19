<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { guard } from "../lib/api";
const props = defineProps<{ path: string }>();
const menu = ref(false);   // hamburger menu (phones and tablets)
const esc = (e: KeyboardEvent) => { if (e.key === "Escape") menu.value = false; };
watch(menu, (v) => { document.body.style.overflow = v ? "hidden" : ""; });
onMounted(() => { guard(true); window.addEventListener("keydown", esc); });
onUnmounted(() => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; });
const nav = [["/", "Home"], ["/admin", "Overview"], ["/admin/members", "Members"], ["/admin/invitations", "Invitations"], ["/admin/storage", "Storage Management"], ["/admin/uploads", "Upload Activity"], ["/admin/jobs", "Background Jobs"], ["/admin/status", "System Status"], ["/admin/settings", "Settings"]];
const on = (p: string) => (p === "/" ? false : p === "/admin" ? props.path.replace(/\/$/, "") === "/admin" : props.path.startsWith(p));
</script>
<template>
  <div v-if="menu" class="fixed inset-0 z-40 bg-black/50 lg:hidden" aria-hidden="true" @click="menu = false" />
  <aside id="admin-menu" aria-label="Administration menu" :class="['fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-[transform,visibility] duration-200 lg:z-10 lg:w-60 lg:translate-x-0 lg:visible', menu ? 'translate-x-0' : '-translate-x-full invisible']">
    <div class="flex items-start justify-between px-3">
      <div><div class="text-xl font-semibold tracking-tight">Album</div><div class="mb-4 text-xs uppercase tracking-wider text-accent">Administration</div></div>
      <button class="grid size-9 place-items-center rounded-full text-muted hover:bg-surface2 lg:hidden" aria-label="Close menu" @click="menu = false">✕</button>
    </div>
    <a v-for="[h, l] in nav" :key="h" :href="h" :class="['rounded-xl px-3 py-2.5 font-medium lg:py-2', on(h) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface2 hover:text-ink']" @click="menu = false">{{ l }}</a>
  </aside>
  <header class="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
    <button class="grid size-10 place-items-center rounded-xl border border-line bg-surface text-lg" aria-label="Open menu" aria-controls="admin-menu" :aria-expanded="menu" @click="menu = true">☰</button>
    <span class="font-semibold tracking-tight">Administration</span>
  </header>
</template>
