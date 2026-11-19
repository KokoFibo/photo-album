<script setup lang="ts">
import { onMounted, ref } from "vue";
const props = defineProps<{ siteKey: string }>();
const emit = defineEmits<{ token: [string] }>();
const el = ref<HTMLElement>();
let id: string | undefined;
const ts = () => (window as any).turnstile;
function render() {
  id = ts().render(el.value, { sitekey: props.siteKey, theme: "auto", callback: (t: string) => emit("token", t), "expired-callback": () => emit("token", "") });
}
onMounted(() => {
  if (ts()) return render();
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true; s.onload = render; document.head.appendChild(s);
});
defineExpose({ reset: () => { emit("token", ""); ts()?.reset(id); } });
</script>
<template><div ref="el" /></template>
