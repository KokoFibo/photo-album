import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [vue()],
  vite: {
    plugins: [tailwindcss()],
    // The Worker writes state files while it runs; the web dev server must not watch them
    server: { watch: { ignored: ['**/worker/**', '**/.wrangler/**', '**/db/**', '**/supabase/**', '**/node_modules/**'] } },
  },
});
