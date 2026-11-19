<script setup lang="ts">
import { ref } from "vue";
defineProps<{ label: string; modelValue: string; autocomplete?: string }>();
defineEmits<{ "update:modelValue": [string] }>();
const show = ref(false);
</script>
<template>
  <label class="block text-sm font-medium">{{ label }}
    <div class="relative mt-1.5">
      <input class="field pr-12" :type="show ? 'text' : 'password'" :value="modelValue" :autocomplete="autocomplete" required
             @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
      <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted" :aria-label="show ? 'Hide password' : 'Show password'" @click="show = !show">
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path v-if="show" d="M4 4l16 16" /></svg>
      </button>
    </div>
  </label>
</template>
