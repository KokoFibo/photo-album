# Cutover: PostgreSQL + Better Auth (no Supabase)

Prerequisite: the db/ layer is installed and green (DB_POSTGRES.md: setup.sql, migrate.sh, tests/two_accounts.sql).
Use `localhost` (not 127.0.0.1) for both the app and the API so the login cookie is shared.

1. Apply the new database support migration:       bash db/migrate.sh
2. Packages (project root):                         npm uninstall @supabase/supabase-js && npm install better-auth
   Worker packages:                                 cd worker && npm install && cd ..
3. Delete the old files:                            rm -f src/lib/supabase.ts worker/src/photos.ts
4. Root .env  ->  only this (no Supabase keys):
       PUBLIC_API_URL=http://localhost:8787
5. worker/.dev.vars  ->  remove the Supabase lines and add the database and secrets (keep MEDIA_SIGNING_SECRET if present):
       sed -i '/^SUPABASE_/d' worker/.dev.vars
       set -a; . <(tr -d '\r' < db/.env); set +a
       { echo "DATABASE_URL=$DATABASE_URL"; echo "DATABASE_SERVICE_URL=$DATABASE_SERVICE_URL";
         echo "BETTER_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"; } >> worker/.dev.vars
       grep -q '^MEDIA_SIGNING_SECRET=' worker/.dev.vars || node -e "console.log('MEDIA_SIGNING_SECRET='+require('crypto').randomBytes(32).toString('hex'))" >> worker/.dev.vars
6. Start (two terminals):   npm run dev      and      cd worker && npm run dev
7. First admin:  http://localhost:4321/register?bootstrap=1  (the email you put in db/seed.sql)
   Verification emails are not sent in development: open http://localhost:8787/dev/mail and click the link.
8. Login, then /admin/invitations to invite a member (the invitation link is shown on screen), and try Add Photos.

Supabase is no longer used: `npx supabase stop` and, when you are happy, delete the supabase/ folder and SUPABASE_* variables.
