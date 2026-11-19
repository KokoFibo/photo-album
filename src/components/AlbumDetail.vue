<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api, myId } from "../lib/api";
import PhotoLibrary from "./PhotoLibrary.vue";
import ShareDialog from "./ShareDialog.vue";

const id = new URLSearchParams(location.search).get("id") ?? "";
const album = ref<any>(null), me = ref(""), ready = ref(false), msg = ref(""), editing = ref(false), sharing = ref(false), fName = ref(""), fDesc = ref(""), opened = ref(false), more = ref(false);
const isOwner = computed(() => album.value?.my_role === "owner"), canEdit = computed(() => ["owner", "editor"].includes(album.value?.my_role));
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const flash = (s: string) => { msg.value = s; setTimeout(() => (msg.value = ""), 2600); };

async function load() {
  try { album.value = await api(`/api/albums/${id}`); } catch { album.value = null; }
  ready.value = true;
  if (!opened.value && isOwner.value && new URLSearchParams(location.search).get("share") === "1") { sharing.value = true; opened.value = true; }
}
async function save() {
  try { await api(`/api/albums/${id}`, { method: "PATCH", body: { name: fName.value, description: fDesc.value } }); editing.value = false; flash("Album saved."); load(); }
  catch (e: any) { editing.value = false; flash(e.message || "The album could not be saved."); }
}
async function del() {
  if (!confirm("Move this album to Trash? Photos that are only in this album move to Trash too.")) return;
  try { await api(`/api/albums/${id}/delete`, { method: "POST" }); location.href = "/albums"; } catch { flash("The album could not be deleted."); }
}
async function leave() {
  if (!confirm("Leave this album? You will lose access until the owner shares it again.")) return;
  try { await api(`/api/albums/${id}/members/${me.value}`, { method: "DELETE" }); location.href = "/shared"; } catch { flash("You could not leave the album."); }
}
const addPhotos = () => window.dispatchEvent(new CustomEvent("open-upload", { detail: { albumId: id } }));
onMounted(async () => { me.value = await myId(); await load(); window.addEventListener("photos-changed", load); });
onUnmounted(() => window.removeEventListener("photos-changed", load));
</script>

<template>
  <div v-if="ready && !album" class="py-24 text-center text-muted"><h2 class="text-2xl font-semibold text-ink">Album not found</h2><a href="/albums" class="mt-3 inline-block text-accent">Back to albums</a></div>
  <template v-else-if="album">
    <section class="relative mb-8 flex min-h-[260px] items-end sm:min-h-[340px] overflow-hidden rounded-3xl bg-surface2 p-6 text-white lg:p-8">
      <img v-if="album.hero_url" :src="album.hero_url" alt="" class="absolute inset-0 size-full object-cover" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div class="relative flex w-full flex-wrap items-end justify-between gap-4">
        <div><a :href="isOwner ? '/albums' : '/shared'" class="text-sm opacity-80">‹ {{ isOwner ? "Albums" : "Shared with Me" }}</a>
          <h1 class="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{{ album.name }}</h1>
          <p class="opacity-90">{{ album.photo_count }} Photo{{ album.photo_count === 1 ? "" : "s" }} · Updated {{ fmt(album.updated_at) }}<template v-if="!isOwner"> · Shared by {{ album.owner_name }} ({{ album.my_role === "editor" ? "Editor" : "Viewer" }})</template></p>
          <p v-if="album.description" class="mt-1 max-w-xl opacity-80">{{ album.description }}</p></div>
        <div class="relative flex flex-wrap items-center gap-2">
          <button v-if="isOwner" class="btn !border-white/30 !bg-white/15 !text-white" @click="sharing = true">Share</button>
          <button v-if="isOwner" class="btn btn-p" @click="addPhotos">+ Add Photos</button>
          <button class="btn !w-11 !border-white/30 !bg-white/15 !px-0 !text-white" aria-label="More actions" :aria-expanded="more" @click="more = !more">⋯</button>
          <template v-if="more">
            <div class="fixed inset-0 z-10" @click="more = false" />
            <div class="absolute bottom-12 right-0 z-20 w-44 rounded-xl border border-line bg-surface p-1 text-sm text-ink shadow-xl">
              <button v-if="canEdit" class="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-surface2" @click="more = false; fName = album.name; fDesc = album.description ?? ''; editing = true">Edit details</button>
              <button v-if="isOwner" class="block w-full rounded-lg px-3 py-2.5 text-left text-red-600 hover:bg-surface2" @click="more = false; del()">Delete album</button>
              <button v-if="!isOwner" class="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-surface2" @click="more = false; leave()">Leave album</button>
            </div>
          </template>
        </div>
      </div>
    </section>
    <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">{{ msg }}</p>
    <PhotoLibrary mode="album" :album-id="id" :read-only="!isOwner" />
    <ShareDialog v-if="sharing" :album-id="id" :album-name="album.name" @close="sharing = false" />
    <div v-if="editing" class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" @click.self="editing = false"><form class="w-full max-w-md space-y-4 rounded-3xl bg-surface p-6" @submit.prevent="save">
      <h2 class="text-2xl font-semibold">Edit Details</h2>
      <label class="block text-sm font-medium">Name<input v-model="fName" class="field mt-1.5" maxlength="120" required /></label>
      <label class="block text-sm font-medium">Description<textarea v-model="fDesc" class="field mt-1.5 !h-24 py-2" /></label>
      <div class="flex justify-end gap-2"><button type="button" class="btn" @click="editing = false">Cancel</button><button class="btn btn-p">Save</button></div></form></div>
  </template>
</template>
