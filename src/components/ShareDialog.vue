<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../lib/api";

const props = defineProps<{ albumId: string; albumName: string }>();
defineEmits<{ close: [] }>();
interface Mem {
  user_id: string;
  display_name: string;
  email: string;
  role: "viewer" | "editor";
}
interface Lnk {
  id: string;
  allow_download: boolean;
  created_at: string;
  expires_at: string;
}
const tab = ref<"people" | "link">("people"),
  members = ref<Mem[]>([]),
  links = ref<Lnk[]>([]);
const email = ref(""),
  role = ref<"viewer" | "editor">("viewer"),
  allowDl = ref(false),
  newUrl = ref("");
const msg = ref(""),
  err = ref(""),
  busy = ref(false),
  copied = ref(false);
let copyTimer: any;
const left = (d: string) =>
  Math.max(0, Math.ceil((+new Date(d) - Date.now()) / 60000));

async function load() {
  const r = await api<{ members: Mem[]; links: Lnk[] }>(
    `/api/albums/${props.albumId}/sharing`,
  );
  members.value = r.members;
  links.value = r.links;
}
async function run(fn: () => Promise<unknown>, done: string) {
  err.value = msg.value = "";
  busy.value = true;
  try {
    await fn();
    msg.value = done;
    await load();
    window.dispatchEvent(new Event("photos-changed"));
  } catch (e: any) {
    err.value = e.message;
  }
  busy.value = false;
}
const add = () =>
  run(async () => {
    await api(`/api/albums/${props.albumId}/members`, {
      method: "POST",
      body: { email: email.value, role: role.value },
    });
    email.value = "";
  }, "Album shared.");
const setRole = (m: Mem, r: string) =>
  run(
    () =>
      api(`/api/albums/${props.albumId}/members/${m.user_id}`, {
        method: "PATCH",
        body: { role: r },
      }),
    "Role updated.",
  );
const removeMember = (m: Mem) =>
  run(
    () =>
      api(`/api/albums/${props.albumId}/members/${m.user_id}`, {
        method: "DELETE",
      }),
    `${m.display_name} no longer has access.`,
  );
const createLink = () =>
  run(async () => {
    const r = await api<{ url: string }>(`/api/albums/${props.albumId}/links`, {
      method: "POST",
      body: { allowDownload: allowDl.value },
    });
    newUrl.value = r.url;
    copied.value = false;
  }, "Link created. It works for one hour.");
const revoke = (l: Lnk) =>
  run(() => api(`/api/links/${l.id}`, { method: "DELETE" }), "Link revoked.");
async function copy() {
  (document.getElementById("guest-link") as HTMLInputElement | null)?.select();
  try {
    await navigator.clipboard.writeText(newUrl.value);
  } catch {
    try {
      document.execCommand("copy");
    } catch {
      err.value = "Copy the link manually.";
      return;
    }
  }
  err.value = "";
  copied.value = true;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (copied.value = false), 2500);
}
onMounted(() => load().catch((e) => (err.value = e.message)));
</script>

<template>
  <div
    class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"
    @click.self="$emit('close')"
  >
    <div
      class="max-h-[92vh] w-full max-w-lg overflow-auto rounded-3xl bg-surface p-6 shadow-2xl"
    >
      <div class="flex justify-between">
        <div>
          <h2 class="text-2xl font-semibold">Share album</h2>
          <p class="truncate text-sm text-muted">{{ albumName }}</p>
        </div>
        <button aria-label="Close" @click="$emit('close')">✕</button>
      </div>
      <div class="my-4 flex gap-2">
        <button
          :class="['chip', tab === 'people' && 'on']"
          class="rounded-full px-4 py-1.5 text-sm font-medium"
          :style="
            tab === 'people'
              ? 'background:var(--a2);color:var(--a)'
              : 'background:var(--s2)'
          "
          @click="tab = 'people'"
        >
          People
        </button>
        <button
          class="rounded-full px-4 py-1.5 text-sm font-medium"
          :style="
            tab === 'link'
              ? 'background:var(--a2);color:var(--a)'
              : 'background:var(--s2)'
          "
          @click="tab = 'link'"
        >
          Guest link
        </button>
      </div>
      <p v-if="err" class="mb-3 text-sm text-red-600" role="alert">{{ err }}</p>
      <p v-if="msg" class="mb-3 text-sm text-emerald-600" role="status">
        {{ msg }}
      </p>

      <template v-if="tab === 'people'">
        <p class="mb-3 text-sm text-muted">
          Share with members of Album. Viewers can look at the photos. Editors
          can also change the album's details.
        </p>
        <form class="flex gap-2" @submit.prevent="add">
          <input
            v-model="email"
            type="email"
            required
            placeholder="Member's email address"
            class="field"
          />
          <select v-model="role" class="field !w-28">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option></select
          ><button class="btn btn-p" :disabled="busy">Share</button>
        </form>
        <ul class="mt-4 divide-y divide-line text-sm">
          <li
            v-for="m in members"
            :key="m.user_id"
            class="flex items-center gap-2 py-2"
          >
            <div class="min-w-0 flex-1">
              <b class="block truncate font-medium">{{ m.display_name }}</b
              ><span class="text-muted">{{ m.email }}</span>
            </div>
            <select
              :value="m.role"
              class="field !h-9 !w-28"
              @change="setRole(m, ($event.target as HTMLSelectElement).value)"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              class="btn btn-d !h-9"
              :disabled="busy"
              @click="removeMember(m)"
            >
              Remove
            </button>
          </li>
          <li v-if="!members.length" class="py-4 text-center text-muted">
            Not shared with anyone yet.
          </li>
        </ul>
      </template>

      <template v-else>
        <p class="mb-3 text-sm text-muted">
          Anyone with the link can view this album without signing in or
          entering a password. Every link stops working after <b>1 hour</b>.
          Guests never see locations or your other albums.
        </p>
        <label class="mb-3 flex items-center gap-2 text-sm"
          ><input v-model="allowDl" type="checkbox" /> Allow guests to download
          photos (2048 px copies, no location data)</label
        >
        <button class="btn btn-p" :disabled="busy" @click="createLink">
          Create 1-hour link
        </button>
        <div
          v-if="newUrl"
          class="mt-4 rounded-xl border border-line bg-surface2 p-3 text-sm"
        >
          <p class="mb-2 text-muted">
            Copy it now. For your safety this link cannot be shown again.
          </p>
          <div class="flex gap-2">
            <input
              id="guest-link"
              :value="newUrl"
              readonly
              class="field !h-9 text-xs"
              @click="copy"
            /><button
              :class="[
                'btn !h-9 shrink-0',
                copied && '!border-emerald-500 !text-emerald-600',
              ]"
              @click="copy"
            >
              {{ copied ? "Copied ✓" : "Copy" }}
            </button>
          </div>
        </div>
        <h3 class="mb-1 mt-5 text-sm font-semibold text-muted">Active links</h3>
        <ul class="divide-y divide-line text-sm">
          <li
            v-for="l in links"
            :key="l.id"
            class="flex items-center justify-between gap-2 py-2"
          >
            <span
              >{{ left(l.expires_at) }} min left<span
                v-if="l.allow_download"
                class="text-muted"
              >
                · downloads allowed</span
              ></span
            ><button class="btn btn-d !h-9" :disabled="busy" @click="revoke(l)">
              Revoke
            </button>
          </li>
          <li v-if="!links.length" class="py-3 text-muted">No active links.</li>
        </ul>
      </template>
    </div>
  </div>
</template>
