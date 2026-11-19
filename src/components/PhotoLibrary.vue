<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { api, myId } from "../lib/api";
import { signed } from "../lib/media";

const props = defineProps<{ mode: "photos" | "favorites" | "album"; albumId?: string; compact?: boolean; readOnly?: boolean }>();
interface P { id: string; filename: string; width: number | null; height: number | null; taken_at: string; exif: any; size_bytes: number; owner_id: string; favorite: boolean; url: string | null }
const SIZE = 60;
const items = ref<P[]>([]), loading = ref(true), more = ref(true), page = ref(0);
const q = ref(""), sort = ref("new"), sel = ref(false), chk = ref(new Set<string>()), me = ref(""), msg = ref("");
const open = ref<number | null>(null), big = ref(""), loc = ref<{ latitude: number; longitude: number } | null>(null), info = ref(true), zoom = ref(false);
const picker = ref(false), albums = ref<{ id: string; name: string }[]>([]);
const sentinel = ref<HTMLElement>(), box = ref<HTMLElement>();
let io: IntersectionObserver | undefined, timer: any, tx = 0;

const flash = (s: string) => { msg.value = s; setTimeout(() => (msg.value = ""), 2600); };
async function load(reset = false) {
  if (reset) { items.value = []; page.value = 0; more.value = true; chk.value = new Set(); }
  if (!more.value) return;
  loading.value = true;
  const params = new URLSearchParams({ mode: props.mode, sort: sort.value, page: String(page.value), limit: props.compact ? "12" : String(SIZE) });
  if (props.albumId) params.set("albumId", props.albumId);
  if (q.value.trim()) params.set("q", q.value.trim());
  try {
    const rows = await api<P[]>(`/api/photos?${params}`);
    items.value.push(...rows); page.value++; more.value = !props.compact && rows.length === SIZE;
  } catch { flash("Photos could not be loaded."); }
  loading.value = false;
}
const reload = () => load(true);
const type = () => { clearTimeout(timer); timer = setTimeout(reload, 300); };

const idx = computed(() => new Map(items.value.map((p, i) => [p.id, i])));
const groups = computed(() => {
  if (sort.value === "name") return [{ label: "", items: items.value }];
  const g: { label: string; items: P[] }[] = [];
  for (const p of items.value) {
    const l = new Date(p.taken_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!g.length || g[g.length - 1].label !== l) g.push({ label: l, items: [] });
    g[g.length - 1].items.push(p);
  }
  return g;
});
const cur = computed(() => (open.value === null ? null : items.value[open.value]));

function click(i: number) { if (sel.value) { const id = items.value[i].id; const s = new Set(chk.value); s.has(id) ? s.delete(id) : s.add(id); chk.value = s; } else open.value = i; }
watch(open, async (i) => {
  big.value = ""; loc.value = null; zoom.value = false;
  if (i === null) return;
  const p = items.value[i];
  const u = await signed([p.id], "large"); if (open.value === i) big.value = u[p.id] ?? "";
  void sharpen(p, i);
  if (p.owner_id === me.value) {   // GPS is private: the API only returns it to the owner
    const r = await api<{ latitude: number; longitude: number } | null>(`/api/photos/${p.id}/location`).catch(() => null);
    if (open.value === i) loc.value = r;
  }
});
// Desktop: show the 'large' preview at once, then swap in the original file for full sharpness (owner only; originals are never shared)
const wide = () => matchMedia("(min-width: 1024px) and (hover: hover)").matches;
async function sharpen(p: P, i: number) {
  if (!wide() || p.owner_id !== me.value || p.size_bytes > 40 * 1048576 || Math.max(p.width ?? 0, p.height ?? 0) <= 2048) return;
  await new Promise((r) => setTimeout(r, 400));   // skip photos the person swipes past quickly
  if (open.value !== i) return;
  try {
    const url = (await signed([p.id], "original"))[p.id]; if (!url) return;
    const im = new Image(); im.src = url; await im.decode();
    if (open.value === i) big.value = url;
  } catch { /* keep the preview */ }
}
const step = (d: number) => { if (open.value !== null && items.value.length) open.value = (open.value + d + items.value.length) % items.value.length; };
const keys = (e: KeyboardEvent) => { if (open.value === null) return; if (e.key === "Escape") open.value = null; else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); };
const swipe = (e: TouchEvent) => { const d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 60) step(d < 0 ? 1 : -1); };
const full = () => { document.fullscreenElement ? document.exitFullscreen() : box.value?.requestFullscreen?.(); };
async function download(p: P) { const u = await signed([p.id], "original", true); if (u[p.id]) { const a = document.createElement("a"); a.href = u[p.id]; a.click(); } }

async function fav(p: P) {
  try {
    await api(`/api/favorites/${p.id}`, { method: p.favorite ? "DELETE" : "PUT" });
    const was = p.favorite; p.favorite = !was;
    if (props.mode === "favorites" && was) { open.value = null; items.value = items.value.filter((x) => x.id !== p.id); }
  } catch { flash("Favorites could not be updated."); }
}
const ids = () => [...chk.value];
const done = (m: string) => { flash(m); window.dispatchEvent(new Event("photos-changed")); };
async function trash() {
  if (!confirm(`Move ${chk.value.size} photo(s) to Trash? You can restore them within 30 days.`)) return;
  try { await api("/api/photos/trash", { method: "POST", body: { ids: ids() } }); done("Moved to Trash."); } catch { flash("Photos could not be moved to Trash."); }
}
async function removeFromAlbum() {
  try { await api(`/api/albums/${props.albumId}/photos`, { method: "DELETE", body: { ids: ids() } }); done("Removed from album."); } catch { flash("Photos could not be removed."); }
}
async function setCover() {
  try { await api(`/api/albums/${props.albumId}/cover`, { method: "POST", body: { photoId: ids()[0] } }); done("Album cover updated."); } catch { flash("The cover could not be changed."); }
}
async function openPicker() {
  const all = await api<{ id: string; name: string; owner_id: string }[]>("/api/albums").catch(() => []);
  albums.value = all.filter((a) => a.owner_id === me.value); picker.value = true;
}
async function addTo(albumId: string) {
  picker.value = false;
  try { await api(`/api/albums/${albumId}/photos`, { method: "POST", body: { ids: ids() } }); done("Added to album."); } catch (e: any) { flash(e.message || "Photos could not be added."); }
}

onMounted(async () => {
  me.value = await myId(); await load();
  io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !loading.value && more.value) load(); }, { rootMargin: "600px" });
  if (sentinel.value) io.observe(sentinel.value);
  addEventListener("keydown", keys); window.addEventListener("photos-changed", reload);
});
onUnmounted(() => { io?.disconnect(); removeEventListener("keydown", keys); window.removeEventListener("photos-changed", reload); });

const meta = (p: P) => p.exif ?? {};
const expo = (v: number) => (v && v < 1 ? `1/${Math.round(1 / v)}s` : `${v}s`);
</script>

<template>
  <div v-if="!compact" class="mb-5 flex flex-wrap items-center gap-2">
    <input v-model="q" class="field max-w-xs" placeholder="Search by filename" @input="type" />
    <select v-model="sort" class="field w-36" @change="reload"><option value="new">Newest</option><option value="old">Oldest</option><option value="name">Filename</option></select>
    <button v-if="!readOnly" :class="['btn', sel && 'btn-p']" @click="sel = !sel; chk = new Set()">{{ sel ? "Done" : "Select" }}</button>
    <template v-if="sel && chk.size">
      <span class="text-sm text-muted">{{ chk.size }} selected</span>
      <button v-if="mode !== 'album'" class="btn" @click="openPicker">Add to album</button>
      <template v-if="mode === 'album'"><button class="btn" @click="removeFromAlbum">Remove from album</button><button v-if="chk.size === 1" class="btn" @click="setCover">Set as cover</button></template>
      <button class="btn btn-d" @click="trash">Move to Trash</button>
    </template>
  </div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p>

  <div v-if="loading && !items.length" class="columns-2 gap-2 sm:columns-3 sm:gap-3.5 xl:columns-4"><div v-for="n in 8" :key="n" class="mb-3 animate-pulse rounded-xl bg-surface2" :style="{ height: 140 + ((n * 53) % 120) + 'px' }" /></div>
  <div v-else-if="!items.length" class="py-20 text-center text-muted">
    <h2 class="text-2xl font-semibold text-ink">{{ q ? "No matching photos" : mode === "favorites" ? "No favorites yet" : mode === "album" ? "No photos in this album" : "No photos yet" }}</h2>
    <p class="mt-1">{{ q ? "Try a different filename." : mode === "favorites" ? "Tap the heart on any photo to keep it here." : "Use Add Photos to upload from your device." }}</p>
  </div>
  <template v-for="g in groups" :key="g.label">
    <h3 v-if="g.label" class="mb-3 mt-8 text-sm font-semibold text-muted">{{ g.label }}</h3>
    <div class="columns-2 gap-2 sm:columns-3 sm:gap-3.5 xl:columns-4">
      <div v-for="p in g.items" :key="p.id" role="button" tabindex="0" :class="['group relative mb-2 block w-full cursor-pointer overflow-hidden rounded-xl bg-surface2 [break-inside:avoid] sm:mb-3.5', chk.has(p.id) && 'outline outline-[3px] -outline-offset-[3px] outline-[var(--a)]']"
           :style="{ aspectRatio: `${p.width || 3} / ${p.height || 2}` }" @click="click(idx.get(p.id)!)" @keydown.enter="click(idx.get(p.id)!)">
        <img v-if="p.url" :src="p.url" :alt="p.filename" loading="lazy" class="size-full object-cover transition duration-500 group-hover:scale-105" />
        <span v-if="sel" :class="['absolute left-2 top-2 grid size-6 place-items-center rounded-full border-2 border-white text-xs text-white', chk.has(p.id) ? 'bg-accent' : 'bg-black/30']">{{ chk.has(p.id) ? "✓" : "" }}</span>
        <button :aria-label="p.favorite ? 'Remove from favorites' : 'Add to favorites'" :class="['absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition', p.favorite ? 'text-rose-400 opacity-100' : 'opacity-0 group-hover:opacity-100']" @click.stop="fav(p)">{{ p.favorite ? "♥" : "♡" }}</button>
        <span class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 text-left text-sm text-white opacity-0 transition group-hover:opacity-100">{{ p.filename }}</span>
      </div>
    </div>
  </template>
  <div ref="sentinel" class="h-8" />

  <div v-if="cur" ref="box" class="fixed inset-0 z-30 flex bg-black/95 text-white" @touchstart="tx = $event.touches[0].clientX" @touchend="swipe">
    <div class="relative grid min-w-0 flex-1 place-items-center overflow-hidden" @click.self="open = null">
      <div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3">
        <button class="size-10 rounded-full bg-white/10" aria-label="Close" @click="open = null">✕</button><span class="min-w-0 flex-1 truncate text-sm opacity-80">{{ cur.filename }}</span>
        <button class="size-10 rounded-full bg-white/10" :class="cur.favorite && 'text-rose-400'" aria-label="Favorite" @click="fav(cur)">{{ cur.favorite ? "♥" : "♡" }}</button>
        <button v-if="cur.owner_id === me" class="size-10 rounded-full bg-white/10" aria-label="Download original" @click="download(cur)">⤓</button>
        <button class="hidden size-10 rounded-full bg-white/10 sm:block" aria-label="Full screen" @click="full">⛶</button>
        <button class="size-10 rounded-full bg-white/10" aria-label="Photo information" @click="info = !info">ⓘ</button>
      </div>
      <button class="absolute left-3 z-10 size-11 rounded-full bg-white/10" aria-label="Previous" @click="step(-1)">‹</button>
      <img v-if="big" :src="big" :alt="cur.filename" decoding="async" :class="['max-h-[88dvh] max-w-[94%] rounded transition-transform duration-200 md:max-h-[100dvh] md:max-w-full md:rounded-none', zoom ? 'scale-[1.8] cursor-zoom-out' : 'cursor-zoom-in']" @click="zoom = !zoom" />
      <div v-else class="size-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      <button class="absolute right-3 z-10 size-11 rounded-full bg-white/10" aria-label="Next" @click="step(1)">›</button>
    </div>
    <aside v-if="info" class="hidden w-80 overflow-auto bg-surface p-6 pt-16 text-ink md:block">
      <h2 class="break-words text-lg font-semibold">{{ cur.filename }}</h2>
      <p class="mb-4 text-sm text-muted">{{ new Date(cur.taken_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }) }}</p>
      <div v-if="meta(cur).aperture || meta(cur).exposure || meta(cur).iso" class="mb-4 grid grid-cols-3 gap-2 text-center text-sm font-medium">
        <div class="rounded-xl bg-surface2 p-2">{{ meta(cur).aperture ? "ƒ/" + meta(cur).aperture : "–" }}<small class="block font-normal text-muted">Aperture</small></div>
        <div class="rounded-xl bg-surface2 p-2">{{ meta(cur).exposure ? expo(meta(cur).exposure) : "–" }}<small class="block font-normal text-muted">Shutter</small></div>
        <div class="rounded-xl bg-surface2 p-2">{{ meta(cur).iso || "–" }}<small class="block font-normal text-muted">ISO</small></div></div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted">Camera</dt><dd class="text-right">{{ [meta(cur).make, meta(cur).model].filter(Boolean).join(" ") || "–" }}</dd>
        <dt class="text-muted">Lens</dt><dd class="text-right">{{ meta(cur).lens || "–" }}</dd>
        <dt class="text-muted">Focal length</dt><dd class="text-right">{{ meta(cur).focalLength ? meta(cur).focalLength + " mm" : "–" }}</dd>
        <dt class="text-muted">Size</dt><dd class="text-right">{{ cur.width }} × {{ cur.height }} · {{ (cur.size_bytes / 1048576).toFixed(1) }} MB</dd>
        <template v-if="loc"><dt class="text-muted">Location</dt><dd class="text-right">{{ loc.latitude.toFixed(4) }}, {{ loc.longitude.toFixed(4) }}</dd></template></dl>
      <p v-if="cur.owner_id === me" class="mt-5 text-xs text-muted">Location is private to you. Shared copies never include GPS data.</p>
    </aside>
  </div>

  <div v-if="picker" class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" @click.self="picker = false"><div class="w-full max-w-sm rounded-3xl bg-surface p-6">
    <h2 class="mb-3 text-xl font-semibold">Add to album</h2>
    <p v-if="!albums.length" class="text-sm text-muted">You have no albums yet. Create one from the Albums page.</p>
    <button v-for="a in albums" :key="a.id" class="block w-full rounded-xl px-3 py-2 text-left hover:bg-surface2" @click="addTo(a.id)">{{ a.name }}</button></div></div>
</template>
