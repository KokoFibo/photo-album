<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { myProfile } from "../lib/api";
import AlbumsView from "./AlbumsView.vue";
import PhotoLibrary from "./PhotoLibrary.vue";
const name = ref(""), used = ref(0), quota = ref(1);
const GB = 1073741824, gb = (n: number) => (n / GB).toFixed(1);
const hello = () => { const h = new Date().getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
async function load() { const p: any = await myProfile(); if (p) { name.value = p.display_name; used.value = p.used_bytes; quota.value = p.quota_bytes || 1; } }
const add = () => window.dispatchEvent(new CustomEvent("open-upload", { detail: {} }));
onMounted(() => { load(); window.addEventListener("photos-changed", load); });
onUnmounted(() => window.removeEventListener("photos-changed", load));
</script>
<template>
  <div class="flex flex-wrap items-end justify-between gap-6">
    <div><h1 class="text-4xl font-semibold tracking-tight">{{ hello() }}<span v-if="name">, {{ name }}</span>.</h1><p class="mt-1 text-lg text-muted">Your library, beautifully kept.</p></div>
    <div class="flex gap-2"><button class="btn btn-p" @click="add">Upload Photos</button><a href="/albums?new=1" class="btn">Create Album</a></div>
  </div>
  <div class="mt-6 max-w-md rounded-2xl bg-surface2 p-4 text-sm"><div class="flex justify-between"><span class="text-muted">Storage</span><span>{{ gb(used) }} of {{ gb(quota) }} GB used · {{ gb(Math.max(0, quota - used)) }} GB left</span></div>
    <div class="mt-2 h-1.5 rounded-full bg-line"><div class="h-full rounded-full bg-accent" :style="{ width: Math.min(100, (used / quota) * 100) + '%' }" /></div></div>
  <div class="mb-4 mt-12 flex items-baseline justify-between"><h2 class="text-2xl font-semibold">Albums</h2><a href="/albums" class="text-sm text-accent">See all</a></div>
  <AlbumsView :limit="4" />
  <div class="mb-4 mt-12 flex items-baseline justify-between"><h2 class="text-2xl font-semibold">Recently added</h2><a href="/photos" class="text-sm text-accent">All photos</a></div>
  <PhotoLibrary mode="photos" compact />
  <div class="mb-4 mt-12"><h2 class="text-2xl font-semibold">Quick access</h2></div>
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4"><a v-for="[h, l] in [['/favorites', 'Favorites'], ['/shared', 'Shared albums'], ['/photos', 'Recent uploads'], ['/trash', 'Trash']]" :key="h" :href="h" class="card !p-4 font-medium hover:border-accent">{{ l }}</a></div>
</template>
