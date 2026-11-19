<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { api, myId } from "../lib/api";

const props = defineProps<{ limit?: number; showCreate?: boolean }>();
interface A { id: string; name: string; description: string | null; updated_at: string; photo_count: number; owner_id: string; cover_url: string | null }
const albums = ref<A[]>([]), loading = ref(true), menu = ref<string | null>(null), msg = ref(""), me = ref("");
const editing = ref<A | "new" | null>(null), fName = ref(""), fDesc = ref(""), busy = ref(false);
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const flash = (s: string) => { msg.value = s; setTimeout(() => (msg.value = ""), 2600); };

async function load() {
  try { albums.value = await api<A[]>(`/api/albums${props.limit ? `?limit=${props.limit}` : ""}`); } catch { flash("Albums could not be loaded."); }
  loading.value = false;
}
function edit(a: A | "new") { editing.value = a; fName.value = a === "new" ? "" : a.name; fDesc.value = a === "new" ? "" : a.description ?? ""; menu.value = null; }
async function save() {
  const name = fName.value.trim(); if (!name) return;
  busy.value = true;
  try {
    const body = { name, description: fDesc.value.trim() };
    editing.value === "new" ? await api("/api/albums", { method: "POST", body }) : await api(`/api/albums/${(editing.value as A).id}`, { method: "PATCH", body });
    editing.value = null; flash("Album saved."); window.dispatchEvent(new Event("photos-changed"));
  } catch { flash("The album could not be saved."); }
  busy.value = false;
}
async function del(a: A) {
  menu.value = null;
  if (!confirm(`Move “${a.name}” to Trash? Photos that are only in this album move to Trash too.`)) return;
  try { await api(`/api/albums/${a.id}/delete`, { method: "POST" }); flash("Album moved to Trash."); window.dispatchEvent(new Event("photos-changed")); } catch { flash("The album could not be deleted."); }
}
onMounted(async () => {
  me.value = await myId(); await load();
  window.addEventListener("photos-changed", load);
  if (props.showCreate && location.search.includes("new=1")) edit("new");
});
onUnmounted(() => window.removeEventListener("photos-changed", load));
</script>

<template>
  <div v-if="showCreate" class="mb-6 flex justify-end"><button class="btn btn-p" @click="edit('new')">+ New Album</button></div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p>
  <div v-if="loading" class="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 xl:grid-cols-4 lg:gap-x-5"><div v-for="n in 4" :key="n" class="aspect-[4/3] animate-pulse rounded-2xl bg-surface2" /></div>
  <div v-else-if="!albums.length" class="py-16 text-center text-muted"><h2 class="text-2xl font-semibold text-ink">No albums yet</h2><p class="mt-1">Create an album to organize your photos.</p>
    <button v-if="showCreate" class="btn btn-p mt-4" @click="edit('new')">Create Album</button></div>
  <div v-else class="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 xl:grid-cols-4 lg:gap-x-5">
    <div v-for="a in albums" :key="a.id" class="group relative">
      <a :href="`/album?id=${a.id}`" class="block">
        <div class="relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface2 shadow-[0_-6px_0_-2px_var(--b),0_-11px_0_-5px_var(--s2)] transition duration-300 group-hover:-translate-y-1">
          <img v-if="a.cover_url" :src="a.cover_url" :alt="a.name" loading="lazy" class="size-full object-cover transition duration-500 group-hover:scale-105" />
          <span v-if="a.owner_id !== me" class="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-0.5 text-xs text-white backdrop-blur">Shared</span>
        </div>
        <h3 class="mt-3.5 pr-8 text-[17px] font-medium">{{ a.name }}</h3>
        <p class="text-sm text-muted">{{ a.photo_count }} Photo{{ a.photo_count === 1 ? "" : "s" }} · Updated {{ fmt(a.updated_at) }}</p>
      </a>
      <button class="absolute bottom-0 right-0 size-8 rounded-full text-muted hover:bg-surface2" aria-label="Album options" @click="menu = menu === a.id ? null : a.id">⋯</button>
      <div v-if="menu === a.id" class="absolute bottom-9 right-0 z-10 w-44 rounded-xl border border-line bg-surface p-1 text-sm shadow-xl">
        <a :href="`/album?id=${a.id}`" class="block rounded-lg px-3 py-2 hover:bg-surface2">Open Album</a>
        <template v-if="a.owner_id === me">
          <button class="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface2" @click="edit(a)">Edit Details</button>
          <a :href="`/album?id=${a.id}`" class="block rounded-lg px-3 py-2 hover:bg-surface2">Change Cover</a>
          <a :href="`/album?id=${a.id}&share=1`" class="block rounded-lg px-3 py-2 hover:bg-surface2">Share Album</a>
          <button class="block w-full rounded-lg px-3 py-2 text-left text-red-600 hover:bg-surface2" @click="del(a)">Delete Album</button></template>
      </div>
    </div>
  </div>
  <div v-if="editing" class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" @click.self="editing = null"><form class="w-full max-w-md space-y-4 rounded-3xl bg-surface p-6" @submit.prevent="save">
    <h2 class="text-2xl font-semibold">{{ editing === "new" ? "New Album" : "Edit Details" }}</h2>
    <label class="block text-sm font-medium">Name<input v-model="fName" class="field mt-1.5" maxlength="120" required /></label>
    <label class="block text-sm font-medium">Description<textarea v-model="fDesc" class="field mt-1.5 !h-24 py-2" /></label>
    <div class="flex justify-end gap-2"><button type="button" class="btn" @click="editing = null">Cancel</button><button class="btn btn-p" :disabled="busy">Save</button></div></form></div>
</template>
