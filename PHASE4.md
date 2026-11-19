# Phase 4 setup (photo library)

Run in the project root (Git Bash). Do NOT unzip over supabase/migrations: this patch only adds one new migration file.

1. Packages:                 npm install exifr
2. Remove stale files:       rm "src/pages/albums/[id].astro" src/components/PhotoGrid.vue src/components/AlbumCard.astro
3. Worker R2 binding + signing secret (appends; your port settings stay untouched):
     printf '\n[[r2_buckets]]\nbinding = "PHOTOS"\nbucket_name = "photo-album"\n' >> worker/wrangler.toml
     node -e "console.log('MEDIA_SIGNING_SECRET='+require('crypto').randomBytes(32).toString('hex'))" >> worker/.dev.vars
4. Database (keeps your admin account; do NOT use db reset here):
     npx supabase migration up
     psql -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:15322/postgres" -f supabase/tests/two_accounts.sql
5. Restart both servers (Ctrl+C, then):  npm run dev     and     cd worker && npm run dev
6. Test: Add Photos -> pick 2-3 JPEGs -> watch the tray -> Photos page -> open one -> Favorites -> New Album -> add photos -> reload the page.
