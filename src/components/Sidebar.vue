<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import UploadModal from "./UploadModal.vue";
import UploadTray from "./UploadTray.vue";
import { authClient, guard, myProfile } from "../lib/api";
const props = defineProps<{ path: string }>();
const cur = ref(props.path);
const menu = ref(false);   // hamburger menu (phones and tablets)
const on = (p: string) =>
  p === "/"
    ? cur.value === "/"
    : cur.value.startsWith(p) || (p === "/albums" && cur.value === "/album");
const upload = ref(false),
  albumId = ref<string | undefined>(),
  isAdmin = ref(false),
  who = ref(""),
  used = ref(0),
  quota = ref(1),
  avatar = ref<string | null>(null);
const nav = computed(() => [
  ["/", "Home"],
  ...(isAdmin.value ? [["/admin", "Overview"]] : []),
  ["/photos", "Photos"],
  ["/albums", "Albums"],
  ["/favorites", "Favorites"],
  ["/shared", "Shared with Me"],
  ["/trash", "Trash"],
]);
const dark = ref(
  typeof document === "undefined" ||
    (document.documentElement.dataset.theme ?? "dark") === "dark",
);
const GB = 1073741824,
  MB = 1048576;
const size = (n: number) =>
  n >= GB
    ? `${(n / GB).toFixed(1)} GB`
    : n >= MB
      ? `${(n / MB).toFixed(1)} MB`
      : `${Math.round((n || 0) / 1024)} KB`; // small uploads no longer show as 0.0 GB
async function refresh() {
  const p = await myProfile();
  if (p) {
    used.value = p.used_bytes;
    quota.value = p.quota_bytes || 1;
    who.value = p.display_name;
    avatar.value = p.avatar_url ?? null;
  }
}
function openUpload(id?: string) {
  albumId.value = id;
  upload.value = true;
}
const here = () => {
  cur.value = location.pathname;
  menu.value = false;
};
const esc = (e: KeyboardEvent) => {
  if (e.key === "Escape") menu.value = false;
};
watch(menu, (v) => {
  document.body.style.overflow = v ? "hidden" : "";   // no scrolling behind the open menu
});
const onOpen = (e: any) => openUpload(e.detail?.albumId);
onMounted(async () => {
  const p = await guard();
  if (p) {
    isAdmin.value = p.role === "super_admin";
    who.value = p.display_name;
    avatar.value = p.avatar_url ?? null;
    used.value = p.used_bytes;
    quota.value = p.quota_bytes || 1;
  }
  document.addEventListener("astro:page-load", here);
  window.addEventListener("photos-changed", refresh);
  window.addEventListener("profile-changed", refresh);
  window.addEventListener("open-upload", onOpen);
  window.addEventListener("keydown", esc);
});
onUnmounted(() => {
  document.removeEventListener("astro:page-load", here);
  window.removeEventListener("photos-changed", refresh);
  window.removeEventListener("profile-changed", refresh);
  window.removeEventListener("open-upload", onOpen);
  window.removeEventListener("keydown", esc);
  document.body.style.overflow = "";
});
function headerUpload() {
  openUpload(
    location.pathname === "/album"
      ? (new URLSearchParams(location.search).get("id") ?? undefined)
      : undefined,
  );
}
function toggle() {
  dark.value = !dark.value;
  const v = dark.value ? "dark" : "light";
  document.documentElement.dataset.theme = v;
  try {
    localStorage.setItem("theme", v);
  } catch {}
}
async function signOut() {
  await authClient.signOut();
  location.href = "/login";
}
</script>
<template>
  <div
    v-if="menu"
    class="fixed inset-0 z-40 bg-black/50 lg:hidden"
    aria-hidden="true"
    @click="menu = false"
  />
  <aside
    id="main-menu"
    aria-label="Main menu"
    :class="[
      'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-[transform,visibility] duration-200 lg:z-auto lg:w-60 lg:translate-x-0 lg:visible',
      menu ? 'translate-x-0' : '-translate-x-full invisible',
    ]"
  >
    <div class="flex items-center justify-between px-3 pb-5">
      <span class="text-xl font-semibold tracking-tight">Album</span>
      <button
        class="grid size-9 place-items-center rounded-full text-muted hover:bg-surface2 lg:hidden"
        aria-label="Close menu"
        @click="menu = false"
      >
        ✕
      </button>
    </div>
    <a
      v-for="[href, label] in nav"
      :key="href"
      :href="href"
      :class="[
        'rounded-xl px-3 py-2.5 font-medium lg:py-2',
        on(href)
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-surface2 hover:text-ink',
      ]"
      @click="menu = false"
      >{{ label }}</a
    >
    <div class="mt-auto rounded-2xl bg-surface2 p-4 text-sm">
      <div class="text-muted">Storage</div>
      <div class="my-2 h-1.5 rounded-full bg-line">
        <div
          class="h-full rounded-full bg-accent"
          :style="{ width: Math.min(100, (used / quota) * 100) + '%' }"
        />
      </div>
      {{ size(used) }} <span class="text-muted">of {{ size(quota) }} used</span>
    </div>
    <a
      v-if="who"
      href="/profile"
      class="flex items-center gap-2 px-3 pt-2 text-sm text-muted"
      @click="menu = false"
      ><span
        class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold text-accent"
        ><img
          v-if="avatar"
          :src="avatar"
          alt=""
          class="size-full object-cover"
        /><span v-else>{{ who[0] }}</span></span
      ><span class="truncate">{{ who }}</span></a
    >
    <a
      href="/profile"
      class="rounded-xl px-3 py-2.5 font-medium text-muted hover:bg-surface2 lg:py-2"
      @click="menu = false"
      >Profile</a
    >
    <a
      href="/settings"
      class="rounded-xl px-3 py-2.5 font-medium text-muted hover:bg-surface2 lg:py-2"
      @click="menu = false"
      >Settings</a
    >
    <button
      class="rounded-xl px-3 py-2.5 text-left font-medium text-muted hover:bg-surface2 lg:py-2"
      @click="signOut"
    >
      Sign Out
    </button>
    <button
      class="rounded-xl px-3 py-2.5 text-left font-medium text-muted hover:bg-surface2 lg:py-2"
      @click="toggle"
    >
      {{ dark ? "Light" : "Dark" }} mode
    </button>
  </aside>
  <header
    class="sticky top-0 z-20 flex items-center gap-2 bg-bg/80 px-4 py-3 backdrop-blur lg:ml-60 lg:justify-end lg:px-10"
  >
    <button
      class="grid size-10 place-items-center rounded-xl border border-line bg-surface text-lg lg:hidden"
      aria-label="Open menu"
      aria-controls="main-menu"
      :aria-expanded="menu"
      @click="menu = true"
    >
      ☰
    </button>
    <span class="text-lg font-semibold tracking-tight lg:hidden">Album</span>
    <span class="flex-1 lg:hidden" />
    <button
      class="h-10 rounded-xl bg-accent px-4 font-medium text-white hover:brightness-110"
      @click="headerUpload"
    >
      + Add Photos
    </button>
  </header>
  <UploadTray @open="upload = true" />
  <UploadModal v-if="upload" :album-id="albumId" @close="upload = false" />
</template>
