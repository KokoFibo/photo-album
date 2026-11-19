<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { api } from "../lib/api";

interface Ph { id: string; width: number | null; height: number | null; thumb: string; full: string; download: string | null }
interface G { album: { name: string; description: string | null; photoCount: number }; expiresAt: string; allowDownload: boolean; photos: Ph[] }
const g = ref<G | null>(null), error = ref(""), loading = ref(true), open = ref<number | null>(null), now = ref(Date.now());
let token = "", tick: any, refresh: any, tx = 0;
const minutes = computed(() => (g.value ? Math.max(0, Math.ceil((+new Date(g.value.expiresAt) - now.value) / 60000)) : 0));
const expired = computed(() => !!g.value && +new Date(g.value.expiresAt) <= now.value);
const cur = computed(() => (open.value === null || !g.value ? null : g.value.photos[open.value]));

async function load() {
  try { g.value = await api<G>("/api/guest/open", { method: "POST", body: { token } }); error.value = ""; }
  catch (e: any) { g.value = null; error.value = e.status === 404 ? "This link has expired or is no longer available." : e.message; }
  loading.value = false;
}
const step = (d: number) => { if (open.value !== null && g.value?.photos.length) open.value = (open.value + d + g.value.photos.length) % g.value.photos.length; };
const keys = (e: KeyboardEvent) => { if (open.value === null) return; if (e.key === "Escape") open.value = null; else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); };
const swipe = (e: TouchEvent) => { const d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 60) step(d < 0 ? 1 : -1); };
let pushed = false;
watch(open, (i, prev) => {
  document.body.style.overflow = i === null ? "" : "hidden";            // no page scrolling behind the viewer
  if (i !== null && prev === null) { history.pushState({ lb: 1 }, ""); pushed = true; }
  else if (i === null && pushed) { pushed = false; if (history.state?.lb) history.back(); }
});
const pop = () => { if (open.value !== null) { pushed = false; open.value = null; } };   // Back button closes the viewer
onMounted(() => {
  token = decodeURIComponent(location.hash.slice(1));
  if (!token) { error.value = "This link is incomplete."; loading.value = false; return; }
  load(); tick = setInterval(() => (now.value = Date.now()), 15000); refresh = setInterval(load, 8 * 60_000);   // fresh image addresses while the page stays open
  addEventListener("keydown", keys); addEventListener("popstate", pop);
});
onUnmounted(() => { clearInterval(tick); clearInterval(refresh); removeEventListener("keydown", keys); removeEventListener("popstate", pop); document.body.style.overflow = ""; });
</script>

<template>
  <div v-if="loading" class="mx-auto max-w-6xl p-6"><div class="h-10 w-64 animate-pulse rounded bg-surface2" /><div class="mt-6 columns-2 gap-3 sm:columns-3"><div v-for="n in 6" :key="n" class="mb-3 h-44 animate-pulse rounded-xl bg-surface2" /></div></div>
  <div v-else-if="!g || expired" class="grid min-h-screen place-items-center p-6 text-center"><div><div class="mb-3 text-xl font-semibold tracking-tight">Album</div><h1 class="text-2xl font-semibold">{{ expired ? "This link has expired." : error }}</h1><p class="mt-2 text-muted">Ask the person who shared it for a new link.</p></div></div>
  <main v-else class="mx-auto max-w-6xl p-4 pb-16 sm:p-8">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div><div class="mb-2 text-sm font-semibold tracking-tight text-muted">Album · shared with you</div><h1 class="text-4xl font-semibold tracking-tight">{{ g.album.name }}</h1>
        <p v-if="g.album.description" class="mt-1 max-w-xl text-muted">{{ g.album.description }}</p>
        <p class="mt-1 text-sm text-muted">{{ g.album.photoCount }} photo{{ g.album.photoCount === 1 ? "" : "s" }}</p></div>
      <span class="rounded-full bg-surface2 px-3 py-1.5 text-sm text-muted">Link expires in {{ minutes }} min</span>
    </header>
    <div v-if="!g.photos.length" class="py-20 text-center text-muted">This album has no photos yet.</div>
    <div class="columns-2 gap-2 sm:columns-3 sm:gap-3.5 xl:columns-4">
      <button v-for="(p, n) in g.photos" :key="p.id" class="group relative mb-2 block w-full overflow-hidden rounded-xl bg-surface2 [break-inside:avoid] sm:mb-3.5" :style="{ aspectRatio: `${p.width || 3} / ${p.height || 2}` }" @click="open = n">
        <img :src="p.thumb" alt="" loading="lazy" class="size-full object-cover transition duration-500 group-hover:scale-105" /></button>
    </div>

    <div v-if="cur" class="fixed inset-0 z-30 grid place-items-center bg-black/95 text-white" @click.self="open = null" @touchstart="tx = $event.touches[0].clientX" @touchend="swipe">
      <div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]"><button class="size-10 rounded-full bg-white/10" aria-label="Close" @click="open = null">✕</button><span class="flex-1" />
        <a v-if="cur.download" :href="cur.download" class="btn !border-white/20 !bg-white/10 !text-white">Download</a></div>
      <button class="absolute left-3 z-10 hidden size-11 rounded-full bg-white/10 md:block" aria-label="Previous" @click="step(-1)">‹</button>
      <img :src="cur.full" alt="" class="max-h-[88dvh] max-w-[94%] rounded md:max-h-[100dvh] md:max-w-full md:rounded-none" />
      <button class="absolute right-3 z-10 hidden size-11 rounded-full bg-white/10 md:block" aria-label="Next" @click="step(1)">›</button>
    </div>
  </main>
</template>
