<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { api, myId } from "../lib/api";
interface S { id: string; name: string; description: string | null; updated_at: string; owner_name: string; role: "viewer" | "editor"; photo_count: number; cover_url: string | null }
const albums = ref<S[]>([]), loading = ref(true), msg = ref(""), err = ref(""), me = ref("");
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
async function load() { try { albums.value = await api<S[]>("/api/shared"); } catch { err.value = "Shared albums could not be loaded."; } loading.value = false; }
async function leave(a: S) {
  if (!confirm(`Leave “${a.name}”? You will lose access until ${a.owner_name} shares it again.`)) return;
  try { await api(`/api/albums/${a.id}/members/${me.value}`, { method: "DELETE" }); msg.value = "You left the album."; await load(); } catch (e: any) { err.value = e.message; }
}
onMounted(async () => { me.value = await myId(); await load(); window.addEventListener("photos-changed", load); });
onUnmounted(() => window.removeEventListener("photos-changed", load));
</script>
<template>
  <div class="mb-6"><h1 class="text-4xl font-semibold tracking-tight">Shared with Me</h1><p class="mt-1 text-muted">Albums other members have shared with you.</p></div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p><p v-if="err" class="mb-3 text-sm text-red-600" role="alert">{{ err }}</p>
  <div v-if="loading" class="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 xl:grid-cols-4"><div v-for="n in 4" :key="n" class="aspect-[4/3] animate-pulse rounded-2xl bg-surface2" /></div>
  <div v-else-if="!albums.length" class="py-24 text-center text-muted"><h2 class="text-2xl font-semibold text-ink">No shared albums yet</h2><p class="mt-1">When another member shares an album with you, it will appear here.</p></div>
  <div v-else class="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 xl:grid-cols-4 lg:gap-x-5">
    <div v-for="a in albums" :key="a.id" class="group">
      <a :href="`/album?id=${a.id}`" class="block">
        <div class="relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface2 shadow-[0_-6px_0_-2px_var(--b),0_-11px_0_-5px_var(--s2)] transition duration-300 group-hover:-translate-y-1">
          <img v-if="a.cover_url" :src="a.cover_url" :alt="a.name" loading="lazy" class="size-full object-cover transition duration-500 group-hover:scale-105" />
          <span class="absolute left-2.5 top-2.5 rounded-full bg-accent px-2.5 py-0.5 text-xs text-white">{{ a.role === "editor" ? "Editor" : "Viewer" }}</span></div>
        <h3 class="mt-3.5 text-[17px] font-medium">{{ a.name }}</h3>
        <p class="text-sm text-muted">{{ a.photo_count }} Photo{{ a.photo_count === 1 ? "" : "s" }} · Shared by {{ a.owner_name }}</p>
        <p class="text-xs text-muted">Updated {{ fmt(a.updated_at) }}</p></a>
      <button class="mt-1 text-xs text-muted hover:text-red-600" @click="leave(a)">Leave album</button>
    </div>
  </div>
</template>
