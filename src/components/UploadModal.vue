<script setup lang="ts">
import { ref, computed } from "vue";
import { uploads, enqueue, retry, cancel, remove, clearFinished } from "../lib/uploads";
const props = defineProps<{ albumId?: string }>();
defineEmits<{ close: [] }>();
const drag = ref(false), note = ref("");
const n = (...s: string[]) => uploads.items.filter((i) => s.includes(i.status)).length;
const total = computed(() => (uploads.items.filter((i) => ["queued", "preparing", "uploading"].includes(i.status)).reduce((s, i) => s + i.file.size, 0) / 1048576).toFixed(1));
const add = (fs: FileList | null) => { if (!fs) return; const bad = enqueue(fs, props.albumId); note.value = bad.length ? `${bad.length} file(s) skipped. Only JPEG, PNG and WebP are supported (HEIC is not supported yet).` : ""; };
const label = (i: any) => ({ queued: "Waiting…", preparing: "Preparing…", uploading: `Uploading ${i.progress}%`, done: "Uploaded", failed: i.error, duplicate: i.error, canceled: "Canceled" } as any)[i.status];
</script>
<template>
  <div class="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" @click.self="$emit('close')">
    <div class="max-h-[92vh] w-full max-w-xl overflow-auto rounded-3xl bg-surface p-6 shadow-2xl">
      <div class="flex justify-between"><h2 class="text-2xl font-semibold">Add Photos</h2><button aria-label="Close" @click="$emit('close')">✕</button></div>
      <p v-if="albumId" class="mt-1 text-sm text-muted">New photos will also be added to this album.</p>
      <div :class="['my-5 rounded-2xl border-2 border-dashed p-8 text-center text-muted', drag ? 'border-accent bg-accent-soft' : 'border-line']"
           @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="drag = false; add($event.dataTransfer?.files ?? null)">
        <p class="font-medium text-ink">Drag and drop photos here</p>
        <p class="text-sm">JPEG, PNG or WebP · originals are kept untouched</p>
        <label class="btn btn-p mr-2 mt-3 cursor-pointer">Select Photos<input hidden type="file" accept="image/*" multiple @change="add(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" /></label>
        <label class="btn mt-3 cursor-pointer">Take Photo<input hidden type="file" accept="image/*" capture="environment" @change="add(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" /></label>
      </div>
      <p v-if="note" class="mb-3 text-sm text-amber-600" role="status">{{ note }}</p>
      <template v-if="uploads.items.length">
        <p class="text-sm text-muted">{{ uploads.items.length }} photos · {{ total }} MB left to upload · {{ n('done') }} uploaded<span v-if="n('failed', 'duplicate')"> · {{ n('failed', 'duplicate') }} need attention</span></p>
        <div v-for="i in uploads.items" :key="i.id" class="flex items-center gap-3 py-2 text-sm">
          <img :src="i.preview" class="size-11 rounded-lg object-cover" alt="" />
          <div class="min-w-0 flex-1"><b class="block truncate font-medium">{{ i.file.name }}</b>
            <div class="mt-1 h-1.5 rounded-full bg-line"><div :class="['h-full rounded-full', i.status === 'failed' ? 'bg-red-500' : 'bg-accent']" :style="{ width: (i.status === 'done' || i.status === 'failed' ? 100 : i.progress) + '%' }" /></div>
            <span :class="['text-xs', i.status === 'failed' ? 'text-red-600' : 'text-muted']">{{ label(i) }}</span></div>
          <button v-if="i.status === 'failed'" class="btn !h-8" @click="retry(i.id)">Retry</button>
          <button v-if="['queued', 'preparing', 'uploading'].includes(i.status)" class="btn !h-8" @click="cancel(i.id)">Cancel</button>
          <button v-else aria-label="Remove" @click="remove(i.id)">✕</button>
        </div>
        <div class="mt-4 flex justify-end gap-2"><button class="btn" @click="clearFinished">Clear finished</button><button class="btn btn-p" @click="$emit('close')">Done</button></div>
      </template>
    </div>
  </div>
</template>
