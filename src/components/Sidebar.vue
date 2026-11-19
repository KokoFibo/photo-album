<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import UploadModal from "./UploadModal.vue";
import UploadTray from "./UploadTray.vue";
import { authClient, guard, myProfile } from "../lib/api";
const props = defineProps<{ path: string }>();
const nav = [
  ["/", "Home"],
  ["/photos", "Photos"],
  ["/albums", "Albums"],
  ["/favorites", "Favorites"],
  ["/shared", "Shared with Me"],
  ["/trash", "Trash"],
];
const cur = ref(props.path);
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
};
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
});
onUnmounted(() => {
  document.removeEventListener("astro:page-load", here);
  window.removeEventListener("photos-changed", refresh);
  window.removeEventListener("profile-changed", refresh);
  window.removeEventListener("open-upload", onOpen);
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
  <aside
    class="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col gap-1 p-4 bg-surface border-r border-line"
  >
    <div class="px-3 pb-5 text-xl font-semibold tracking-tight">Album</div>
    <a
      v-for="[href, label] in nav"
      :key="href"
      :href="href"
      :class="[
        'rounded-xl px-3 py-2 font-medium',
        on(href)
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-surface2 hover:text-ink',
      ]"
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
      class="rounded-xl px-3 py-2 font-medium text-muted hover:bg-surface2"
      >Profile</a
    >
    <a
      href="/settings"
      class="rounded-xl px-3 py-2 font-medium text-muted hover:bg-surface2"
      >Settings</a
    >
    <a
      v-if="isAdmin"
      href="/admin"
      class="rounded-xl px-3 py-2 font-medium text-muted hover:bg-surface2"
      >Administration</a
    >
    <button
      class="rounded-xl px-3 py-2 text-left font-medium text-muted hover:bg-surface2"
      @click="signOut"
    >
      Sign Out
    </button>
    <button
      class="rounded-xl px-3 py-2 text-left font-medium text-muted hover:bg-surface2"
      @click="toggle"
    >
      {{ dark ? "Light" : "Dark" }} mode
    </button>
  </aside>
  <header
    class="sticky top-0 z-20 flex items-center justify-end gap-2 px-4 lg:px-10 py-3 bg-bg/80 backdrop-blur lg:ml-60"
  >
    <button
      class="lg:hidden rounded-xl border border-line bg-surface px-3 h-10"
      @click="toggle"
    >
      {{ dark ? "☀" : "☾" }}
    </button>
    <button
      class="rounded-xl bg-accent px-4 h-10 font-medium text-white hover:brightness-110"
      @click="headerUpload"
    >
      + Add Photos
    </button>
  </header>
  <nav
    class="lg:hidden fixed bottom-0 inset-x-0 z-20 flex justify-around border-t border-line bg-surface/90 backdrop-blur px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-xs"
  >
    <a
      v-for="[href, label] in nav.slice(0, 4)"
      :key="href"
      :href="href"
      :class="['px-3 py-1', on(href) ? 'text-accent' : 'text-muted']"
      >{{ label }}</a
    >
    <a href="/settings" class="px-3 py-1 text-muted">Settings</a>
  </nav>
  <UploadTray @open="upload = true" />
  <UploadModal v-if="upload" :album-id="albumId" @close="upload = false" />
</template>
