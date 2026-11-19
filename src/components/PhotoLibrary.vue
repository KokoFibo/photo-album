<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { api, myId } from "../lib/api";
import { signed } from "../lib/media";
import PhotoInfo from "./PhotoInfo.vue";

const props = defineProps<{ mode: "photos" | "favorites" | "album"; albumId?: string; compact?: boolean; readOnly?: boolean; canDownload?: boolean }>();
interface P { id: string; filename: string; width: number | null; height: number | null; taken_at: string; exif: any; size_bytes: number; owner_id: string; favorite: boolean; url: string | null }
const SIZE = 60;
const items = ref<P[]>([]), loading = ref(true), more = ref(true), page = ref(0);
const q = ref(""), sort = ref("new"), sel = ref(false), chk = ref(new Set<string>()), me = ref(""), msg = ref("");
const open = ref<number | null>(null), big = ref(""), loc = ref<{ latitude: number; longitude: number } | null>(null), info = ref(true), sheet = ref(false);
const scale = ref(1), ox = ref(0), oy = ref(0), dragging = ref(false), imgEl = ref<HTMLImageElement>(), stage = ref<HTMLElement>();
const ncol = () => (innerWidth >= 1280 ? 4 : innerWidth >= 640 ? 3 : 2);
const cols = ref(typeof innerWidth === "undefined" ? 2 : ncol());
const onResize = () => { cols.value = ncol(); };
const picker = ref(false), albums = ref<{ id: string; name: string }[]>([]);
const sentinel = ref<HTMLElement>(), box = ref<HTMLElement>();
let io: IntersectionObserver | undefined, timer: any;

const loadingAll = ref(false);
const allSelected = computed(() => !more.value && items.value.length > 0 && chk.value.size === items.value.length);
async function selectAll() {   // loads every page of the album first, so the whole album is selected, not only what is on screen
  loadingAll.value = true;
  while (more.value) { const n = items.value.length; await load(); if (items.value.length === n) break; }
  chk.value = new Set(items.value.map((x) => x.id)); loadingAll.value = false;
}
const chunks = (a: string[], n = 500) => { const o: string[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };   // the server accepts 500 photos per request
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
// Masonry columns are filled in order, so photos that are already on screen never jump when more load
const split = (list: P[]) => {
  const n = cols.value, out: P[][] = Array.from({ length: n }, () => []), h: number[] = new Array(n).fill(0);
  for (const p of list) { let k = 0; for (let j = 1; j < n; j++) if (h[j] < h[k] - 0.001) k = j; out[k].push(p); h[k] += (p.height || 2) / (p.width || 3); }
  return out;
};
const groups = computed(() => {
  if (sort.value === "name") return [{ label: "", cols: split(items.value) }];
  const g: { label: string; items: P[]; cols: P[][] }[] = [];
  for (const p of items.value) {
    const l = new Date(p.taken_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!g.length || g[g.length - 1].label !== l) g.push({ label: l, items: [], cols: [] });
    g[g.length - 1].items.push(p);
  }
  for (const x of g) x.cols = split(x.items);
  return g;
});
const cur = computed(() => (open.value === null ? null : items.value[open.value]));

function click(i: number) { if (sel.value) { const id = items.value[i].id; const s = new Set(chk.value); s.has(id) ? s.delete(id) : s.add(id); chk.value = s; } else open.value = i; }
watch(open, async (i) => {
  document.body.style.overflow = i === null ? "" : "hidden";   // no page scrolling behind the lightbox
  big.value = ""; loc.value = null; resetZoom();
  if (i === null) { sheet.value = false; return; }
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

// Touch and mouse gestures on the picture: pinch or double-tap to zoom, drag to pan, swipe sideways to change photo
const pts = new Map<number, { x: number; y: number }>();
const g = { dist: 0, scale: 1, ox: 0, oy: 0, sx: 0, sy: 0, moved: false, pinch: false, lastTap: 0 };
function clampPan() {
  const el = imgEl.value, st = stage.value; if (!el || !st) return;
  const mx = Math.max(0, (el.clientWidth * scale.value - st.clientWidth) / 2), my = Math.max(0, (el.clientHeight * scale.value - st.clientHeight) / 2);
  ox.value = Math.min(mx, Math.max(-mx, ox.value)); oy.value = Math.min(my, Math.max(-my, oy.value));
}
function resetZoom() { scale.value = 1; ox.value = 0; oy.value = 0; }
function setScale(v: number) { scale.value = Math.min(5, Math.max(1, v)); if (scale.value === 1) { ox.value = 0; oy.value = 0; } else clampPan(); }
function down(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button, a, [data-nogesture]")) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragging.value = true;
  if (pts.size === 1) Object.assign(g, { sx: e.clientX, sy: e.clientY, ox: ox.value, oy: oy.value, moved: false, pinch: false });
  else if (pts.size === 2) { const [a, b] = [...pts.values()]; Object.assign(g, { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: scale.value, pinch: true, moved: true }); }
}
function move(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size >= 2) { const [a, b] = [...pts.values()]; setScale(g.scale * Math.hypot(a.x - b.x, a.y - b.y) / (g.dist || 1)); return; }
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
  if (scale.value > 1 && !g.pinch) { ox.value = g.ox + dx; oy.value = g.oy + dy; clampPan(); }
}
function up(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (pts.size > 0) return;                                  // the other finger of a pinch is still down
  dragging.value = false;
  if (g.pinch) { if (scale.value < 1.05) resetZoom(); return; }
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (g.moved) { if (scale.value === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1); return; }
  if (!(e.target as HTMLElement).closest("img")) return;     // a tap beside the picture closes it (see closeBackdrop)
  if (e.pointerType === "mouse") return setScale(scale.value > 1 ? 1 : 2);
  const now = Date.now();
  if (now - g.lastTap < 300) { setScale(scale.value > 1 ? 1 : 2.5); g.lastTap = 0; } else g.lastTap = now;
}
const cancel = () => { pts.clear(); dragging.value = false; };
const wheel = (e: WheelEvent) => setScale(scale.value * Math.exp(-e.deltaY * 0.0025));
const closeBackdrop = () => { if (!g.moved) open.value = null; };
const toggleInfo = () => { if (matchMedia("(min-width: 768px)").matches) info.value = !info.value; else sheet.value = !sheet.value; };
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
  try { for (const part of chunks(ids())) await api("/api/photos/trash", { method: "POST", body: { ids: part } }); done("Moved to Trash."); } catch { flash("Photos could not be moved to Trash."); }
}
async function removeFromAlbum() {
  try { for (const part of chunks(ids())) await api(`/api/albums/${props.albumId}/photos`, { method: "DELETE", body: { ids: part } }); done("Removed from album."); } catch { flash("Photos could not be removed."); }
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
  try { for (const part of chunks(ids())) await api(`/api/albums/${albumId}/photos`, { method: "POST", body: { ids: part } }); done("Added to album."); } catch (e: any) { flash(e.message || "Photos could not be added."); }
}

onMounted(async () => {
  me.value = await myId(); await load();
  io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !loading.value && !loadingAll.value && more.value) load(); }, { rootMargin: "600px" });
  if (sentinel.value) io.observe(sentinel.value);
  addEventListener("keydown", keys); addEventListener("resize", onResize); window.addEventListener("photos-changed", reload);
});
onUnmounted(() => { io?.disconnect(); document.body.style.overflow = ""; removeEventListener("resize", onResize); removeEventListener("keydown", keys); window.removeEventListener("photos-changed", reload); });

</script>

<template>
  <div v-if="!compact" class="mb-5 flex flex-wrap items-center gap-2">
    <input v-model="q" class="field max-w-xs" placeholder="Search by filename" @input="type" />
    <select v-model="sort" class="field w-36" @change="reload"><option value="new">Newest</option><option value="old">Oldest</option><option value="name">Filename</option></select>
    <button v-if="!readOnly" :class="['btn', sel && 'btn-p']" @click="sel = !sel; chk = new Set()">{{ sel ? "Done" : "Select" }}</button>
    <button v-if="sel && mode === 'album'" class="btn" :disabled="loadingAll" @click="allSelected ? (chk = new Set()) : selectAll()">{{ loadingAll ? "Selecting…" : allSelected ? "Clear selection" : "Select all" }}</button>
  </div>
  <div v-if="sel && chk.size" class="h-20" />
  <div v-if="sel && chk.size" class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
    <div class="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
      <span class="mr-auto text-sm font-medium">{{ chk.size }} selected</span>
      <button v-if="mode !== 'album'" class="btn" @click="openPicker">Add to album</button>
      <template v-if="mode === 'album'"><button class="btn" @click="removeFromAlbum">Remove from album</button><button v-if="chk.size === 1" class="btn" @click="setCover">Set as cover</button></template>
      <button class="btn btn-d" @click="trash">Move to Trash</button>
    </div>
  </div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p>

  <div v-if="loading && !items.length" class="columns-2 gap-2 sm:columns-3 sm:gap-3.5 xl:columns-4"><div v-for="n in 8" :key="n" class="mb-3 animate-pulse rounded-xl bg-surface2" :style="{ height: 140 + ((n * 53) % 120) + 'px' }" /></div>
  <div v-else-if="!items.length" class="py-20 text-center text-muted">
    <h2 class="text-2xl font-semibold text-ink">{{ q ? "No matching photos" : mode === "favorites" ? "No favorites yet" : mode === "album" ? "No photos in this album" : "No photos yet" }}</h2>
    <p class="mt-1">{{ q ? "Try a different filename." : mode === "favorites" ? "Tap the heart on any photo to keep it here." : "Use Add Photos to upload from your device." }}</p>
  </div>
  <template v-for="g in groups" :key="g.label">
    <h3 v-if="g.label" class="mb-3 mt-8 text-sm font-semibold text-muted">{{ g.label }}</h3>
    <div class="flex items-start gap-2 sm:gap-3.5">
      <div v-for="(col, ci) in g.cols" :key="ci" class="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3.5">
        <div v-for="p in col" :key="p.id" role="button" tabindex="0" :class="['group relative block w-full cursor-pointer overflow-hidden rounded-xl bg-surface2', chk.has(p.id) && 'outline outline-[3px] -outline-offset-[3px] outline-[var(--a)]']"
             :style="{ aspectRatio: `${p.width || 3} / ${p.height || 2}` }" @click="click(idx.get(p.id)!)" @keydown.enter="click(idx.get(p.id)!)">
          <img v-if="p.url" :src="p.url" :alt="p.filename" loading="lazy" class="size-full object-cover transition duration-500 group-hover:scale-105" />
          <span v-if="sel" :class="['absolute left-2 top-2 grid size-7 place-items-center rounded-full border-2 border-white text-xs text-white sm:size-6', chk.has(p.id) ? 'bg-accent' : 'bg-black/30']">{{ chk.has(p.id) ? "✓" : "" }}</span>
          <button :aria-label="p.favorite ? 'Remove from favorites' : 'Add to favorites'" :class="['absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-black/40 backdrop-blur transition sm:size-8', p.favorite ? 'text-rose-400 opacity-100' : 'text-white opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100']" @click.stop="fav(p)">{{ p.favorite ? "♥" : "♡" }}</button>
          <span class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 text-left text-sm text-white opacity-0 transition group-hover:opacity-100">{{ p.filename }}</span>
        </div>
      </div>
    </div>
  </template>
  <div ref="sentinel" class="h-8" />

  <div v-if="cur" ref="box" class="fixed inset-0 z-30 flex bg-black/95 text-white">
    <div ref="stage" class="relative grid min-w-0 flex-1 touch-none place-items-center overflow-hidden" @click.self="closeBackdrop" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @wheel.prevent="wheel">
      <div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button class="size-10 rounded-full bg-white/10" aria-label="Close" @click="open = null">✕</button><span class="min-w-0 flex-1 truncate text-sm opacity-80">{{ cur.filename }}</span>
        <button class="size-10 rounded-full bg-white/10" :class="cur.favorite && 'text-rose-400'" aria-label="Favorite" @click="fav(cur)">{{ cur.favorite ? "♥" : "♡" }}</button>
        <button v-if="cur.owner_id === me || canDownload" class="size-10 rounded-full bg-white/10" aria-label="Download original" @click="download(cur)">⤓</button>
        <button class="hidden size-10 rounded-full bg-white/10 sm:block" aria-label="Full screen" @click="full">⛶</button>
        <button class="size-10 rounded-full bg-white/10" aria-label="Photo information" @click="toggleInfo">ⓘ</button>
      </div>
      <button class="absolute left-3 z-10 hidden size-11 rounded-full bg-white/10 md:block" aria-label="Previous" @click="step(-1)">‹</button>
      <img v-if="big" ref="imgEl" :src="big" :alt="cur.filename" decoding="async" draggable="false"
           :class="['max-h-[88dvh] max-w-[94%] select-none rounded md:max-h-[100dvh] md:max-w-full md:rounded-none', !dragging && 'transition-transform duration-200', scale > 1 ? 'cursor-grab' : 'cursor-zoom-in']"
           :style="{ transform: `translate(${ox}px, ${oy}px) scale(${scale})` }" />
      <div v-else class="size-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      <button class="absolute right-3 z-10 hidden size-11 rounded-full bg-white/10 md:block" aria-label="Next" @click="step(1)">›</button>
      <div v-if="sheet" data-nogesture class="absolute inset-x-0 bottom-0 z-20 max-h-[70dvh] overflow-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink md:hidden">
        <button class="mx-auto mb-4 block h-1.5 w-12 rounded-full bg-line" aria-label="Close information" @click="sheet = false" />
        <PhotoInfo :photo="cur" :loc="loc" :mine="cur.owner_id === me" />
      </div>
    </div>
    <aside v-if="info" class="hidden w-80 overflow-auto bg-surface p-6 pt-16 text-ink md:block">
      <PhotoInfo :photo="cur" :loc="loc" :mine="cur.owner_id === me" />
    </aside>
  </div>

  <div v-if="picker" class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" @click.self="picker = false"><div class="w-full max-w-sm rounded-3xl bg-surface p-6">
    <h2 class="mb-3 text-xl font-semibold">Add to album</h2>
    <p v-if="!albums.length" class="text-sm text-muted">You have no albums yet. Create one from the Albums page.</p>
    <button v-for="a in albums" :key="a.id" class="block w-full rounded-xl px-3 py-2 text-left hover:bg-surface2" @click="addTo(a.id)">{{ a.name }}</button></div></div>
</template>
