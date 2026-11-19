<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../lib/api";
const saved = ref({ defaultQuotaGB: 20, inviteExpiryDays: 7 }), quota = ref(20), days = ref(7), msg = ref(""), err = ref(""), busy = ref(false), ready = ref(false);
const dirty = computed(() => quota.value !== saved.value.defaultQuotaGB || days.value !== saved.value.inviteExpiryDays);
async function load() {
  try { const s = await api<{ default_quota_gb: number; invite_expiry_days: number }>("/api/admin/settings"); saved.value = { defaultQuotaGB: s.default_quota_gb, inviteExpiryDays: s.invite_expiry_days }; quota.value = s.default_quota_gb; days.value = s.invite_expiry_days; }
  catch (e: any) { err.value = e.message; }
  ready.value = true;
}
async function save() {
  busy.value = true; err.value = msg.value = "";
  try { await api("/api/admin/settings", { method: "PUT", body: { defaultQuotaGB: quota.value, inviteExpiryDays: days.value } }); msg.value = "Settings saved."; await load(); } catch (e: any) { err.value = e.message; }
  busy.value = false;
}
const cancel = () => { quota.value = saved.value.defaultQuotaGB; days.value = saved.value.inviteExpiryDays; err.value = msg.value = ""; };
onMounted(load);
</script>
<template>
  <div v-if="!ready" class="h-40 max-w-2xl animate-pulse rounded-2xl bg-surface2" />
  <div v-else class="grid max-w-2xl gap-5">
    <section class="card"><h2 class="mb-1 text-lg font-semibold">Invitation defaults</h2><p class="mb-4 text-sm text-muted">These values are pre-filled when you invite a new member. You can still change them for each invitation.</p>
      <div class="grid gap-4 sm:grid-cols-2"><label class="block text-sm font-medium">Initial storage quota (GB)<input v-model.number="quota" type="number" min="1" max="1000" class="field mt-1.5" /></label>
        <label class="block text-sm font-medium">Invitation expires after (days)<input v-model.number="days" type="number" min="1" max="30" class="field mt-1.5" /></label></div></section>
    <p v-if="err" class="text-sm text-red-600" role="alert">{{ err }}</p>
    <div class="flex items-center justify-end gap-2"><span v-if="msg" class="mr-auto text-sm text-emerald-600" role="status">{{ msg }}</span>
      <button class="btn" :disabled="!dirty || busy" @click="cancel">Cancel</button><button class="btn btn-p" :disabled="!dirty || busy" @click="save">{{ busy ? "Saving…" : "Save changes" }}</button></div>
  </div>
</template>
