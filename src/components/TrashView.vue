<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../lib/api";
interface TP {
  id: string;
  filename: string;
  width: number | null;
  height: number | null;
  deleted_at: string;
  purge_after: string;
  deleted_by_album_id: string | null;
  url: string | null;
}
interface TA {
  id: string;
  name: string;
  deleted_at: string;
  purge_after: string;
  trashed_photos: number;
}
const photos = ref<TP[]>([]),
  albums = ref<TA[]>([]),
  loading = ref(true),
  chkP = ref(new Set<string>()),
  chkA = ref(new Set<string>());
const msg = ref(""),
  err = ref(""),
  emptyOpen = ref(false),
  typed = ref(""),
  busy = ref(false);
const picked = computed(() => chkP.value.size + chkA.value.size),
  empty = computed(() => !photos.value.length && !albums.value.length);
const left = (d: string) =>
  Math.max(0, Math.ceil((+new Date(d) - Date.now()) / 864e5));
const flash = (s: string) => {
  msg.value = s;
  setTimeout(() => (msg.value = ""), 3000);
};
const toggleP = (id: string) => {
  const s = new Set(chkP.value);
  s.has(id) ? s.delete(id) : s.add(id);
  chkP.value = s;
};
const toggleA = (id: string) => {
  const s = new Set(chkA.value);
  s.has(id) ? s.delete(id) : s.add(id);
  chkA.value = s;
};

async function load() {
  try {
    const r = await api<{ photos: TP[]; albums: TA[] }>("/api/trash");
    photos.value = r.photos;
    albums.value = r.albums;
    chkP.value = new Set();
    chkA.value = new Set();
  } catch {
    err.value = "Trash could not be loaded.";
  }
  loading.value = false;
}
async function restore() {
  err.value = "";
  busy.value = true;
  try {
    await api("/api/trash/restore", {
      method: "POST",
      body: { photoIds: [...chkP.value], albumIds: [...chkA.value] },
    });
    flash("Restored.");
    await load();
    window.dispatchEvent(new Event("photos-changed"));
  } catch (e: any) {
    err.value = e.message;
  }
  busy.value = false;
}
/** "selected": delete the chosen items right away. "all": empty the Trash (needs the word DELETE). */
async function purge(mode: "selected" | "all") {
  if (mode === "all" && typed.value !== "DELETE") return;
  busy.value = true;
  err.value = "";
  const all = mode === "all",
    body: Record<string, unknown> = {
      all,
      photoIds: [...chkP.value],
      albumIds: [...chkA.value],
    };
  if (all) body.confirm = "DELETE";
  try {
    let r: { purged: number; remaining: number },
      guard = 0;
    do {
      r = await api("/api/trash/purge", { method: "POST", body });
    } while (r.remaining > 0 && r.purged > 0 && ++guard < 100);
    if (r.remaining > 0)
      err.value =
        "Some files could not be deleted yet. They will be retried automatically.";
    else flash("Deleted permanently.");
    emptyOpen.value = false;
    typed.value = "";
    await load();
    window.dispatchEvent(new Event("photos-changed"));
  } catch (e: any) {
    err.value = e.message;
  }
  busy.value = false;
}
const reload = () => load();
onMounted(() => {
  load();
  window.addEventListener("photos-changed", reload);
});
onUnmounted(() => window.removeEventListener("photos-changed", reload));
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-4xl font-semibold tracking-tight">Trash</h1>
      <p class="mt-1 text-muted">
        Items are removed permanently after 30 days.
      </p>
    </div>
    <div v-if="!empty" class="flex flex-wrap gap-2">
      <button class="btn" :disabled="!picked || busy" @click="restore">
        Restore{{ picked ? ` (${picked})` : "" }}
      </button>
      <button
        class="btn btn-d"
        :disabled="!picked || busy"
        @click="purge('selected')"
      >
        {{ busy ? "Working…" : "Delete forever" }}
      </button>
      <button
        class="btn btn-d"
        :disabled="busy || picked > 0"
        :title="
          picked > 0 ? 'Clear your selection to empty the whole Trash' : ''
        "
        @click="
          emptyOpen = true;
          typed = '';
          err = '';
        "
      >
        Empty Trash
      </button>
    </div>
  </div>
  <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">
    {{ msg }}
  </p>
  <p v-if="err && !emptyOpen" class="mb-3 text-sm text-red-600" role="alert">
    {{ err }}
  </p>

  <div v-if="loading" class="columns-2 gap-3 sm:columns-3 xl:columns-4">
    <div
      v-for="n in 6"
      :key="n"
      class="mb-3 h-40 animate-pulse rounded-xl bg-surface2"
    />
  </div>
  <div v-else-if="empty" class="py-24 text-center text-muted">
    <h2 class="text-2xl font-semibold text-ink">Trash is empty</h2>
    <p class="mt-1">
      Deleted photos and albums stay here for 30 days before they are removed.
    </p>
  </div>
  <template v-else>
    <template v-if="albums.length">
      <h2 class="mb-3 text-sm font-semibold text-muted">Albums</h2>
      <div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label
          v-for="a in albums"
          :key="a.id"
          :class="[
            'card flex cursor-pointer items-center gap-3 !p-4',
            chkA.has(a.id) && 'border-accent',
          ]"
        >
          <input
            type="checkbox"
            :checked="chkA.has(a.id)"
            @change="toggleA(a.id)"
          />
          <div class="min-w-0">
            <b class="block truncate font-medium">{{ a.name }}</b>
            <span class="text-sm text-muted"
              >{{ a.trashed_photos }} photo{{
                a.trashed_photos === 1 ? "" : "s"
              }}
              deleted with it · {{ left(a.purge_after) }} days left</span
            >
          </div>
        </label>
      </div>
    </template>
    <template v-if="photos.length">
      <h2 class="mb-3 text-sm font-semibold text-muted">Photos</h2>
      <div class="columns-2 gap-2 sm:columns-3 sm:gap-3.5 xl:columns-4">
        <div
          v-for="p in photos"
          :key="p.id"
          role="button"
          tabindex="0"
          :class="[
            'group relative mb-2 block cursor-pointer overflow-hidden rounded-xl bg-surface2 [break-inside:avoid] sm:mb-3.5',
            chkP.has(p.id) &&
              'outline outline-[3px] -outline-offset-[3px] outline-[var(--a)]',
          ]"
          :style="{ aspectRatio: `${p.width || 3} / ${p.height || 2}` }"
          @click="toggleP(p.id)"
          @keydown.enter="toggleP(p.id)"
        >
          <img
            v-if="p.url"
            :src="p.url"
            :alt="p.filename"
            loading="lazy"
            class="size-full object-cover opacity-80"
          />
          <span
            :class="[
              'absolute left-2 top-2 grid size-6 place-items-center rounded-full border-2 border-white text-xs text-white',
              chkP.has(p.id) ? 'bg-accent' : 'bg-black/30',
            ]"
            >{{ chkP.has(p.id) ? "✓" : "" }}</span
          >
          <span
            class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-xs text-white"
            >{{ left(p.purge_after) }} days left<span
              v-if="p.deleted_by_album_id"
            >
              · deleted with album</span
            ></span
          >
        </div>
      </div>
    </template>
  </template>

  <div
    v-if="emptyOpen"
    class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"
    @click.self="emptyOpen = false"
  >
    <div class="w-full max-w-md rounded-3xl bg-surface p-6">
      <h2 class="text-2xl font-semibold">Empty Trash</h2>
      <p class="my-3 text-sm text-muted">
        Everything in Trash will be deleted permanently. This cannot be undone.
        Type <b>DELETE</b> to confirm.
      </p>
      <input
        v-model="typed"
        class="field"
        autocomplete="off"
        @keydown.enter="purge('all')"
      />
      <p v-if="err" class="mt-3 text-sm text-red-600" role="alert">{{ err }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn" @click="emptyOpen = false">Cancel</button
        ><button
          class="btn btn-d"
          :disabled="typed !== 'DELETE' || busy"
          @click="purge('all')"
        >
          {{ busy ? "Deleting…" : "Empty Trash" }}
        </button>
      </div>
    </div>
  </div>
</template>
