<script setup lang="ts">
defineProps<{ photo: any; loc: { latitude: number; longitude: number } | null; mine: boolean }>();
const meta = (p: any) => p.exif ?? {};
const expo = (v: number) => (v && v < 1 ? `1/${Math.round(1 / v)}s` : `${v}s`);
</script>
<template>
  <h2 class="break-words text-lg font-semibold">{{ photo.filename }}</h2>
  <p class="mb-4 text-sm text-muted">{{ new Date(photo.taken_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }) }}</p>
  <div v-if="meta(photo).aperture || meta(photo).exposure || meta(photo).iso" class="mb-4 grid grid-cols-3 gap-2 text-center text-sm font-medium">
    <div class="rounded-xl bg-surface2 p-2">{{ meta(photo).aperture ? "ƒ/" + meta(photo).aperture : "–" }}<small class="block font-normal text-muted">Aperture</small></div>
    <div class="rounded-xl bg-surface2 p-2">{{ meta(photo).exposure ? expo(meta(photo).exposure) : "–" }}<small class="block font-normal text-muted">Shutter</small></div>
    <div class="rounded-xl bg-surface2 p-2">{{ meta(photo).iso || "–" }}<small class="block font-normal text-muted">ISO</small></div></div>
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    <dt class="text-muted">Camera</dt><dd class="text-right">{{ [meta(photo).make, meta(photo).model].filter(Boolean).join(" ") || "–" }}</dd>
    <dt class="text-muted">Lens</dt><dd class="text-right">{{ meta(photo).lens || "–" }}</dd>
    <dt class="text-muted">Focal length</dt><dd class="text-right">{{ meta(photo).focalLength ? meta(photo).focalLength + " mm" : "–" }}</dd>
    <dt class="text-muted">Size</dt><dd class="text-right">{{ photo.width }} × {{ photo.height }} · {{ (photo.size_bytes / 1048576).toFixed(1) }} MB</dd>
    <template v-if="loc"><dt class="text-muted">Location</dt><dd class="text-right">{{ loc.latitude.toFixed(4) }}, {{ loc.longitude.toFixed(4) }}</dd></template></dl>
  <p v-if="mine" class="mt-5 text-xs text-muted">Location is private to you. Shared copies never include GPS data.</p>
</template>
