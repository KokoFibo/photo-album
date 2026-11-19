# Private Photo Album — Phase 1 (frontend prototype)
Astro + Vue + TypeScript + Tailwind v4. Mock data only: no backend yet.

```bash
npm install
npm run dev      # http://localhost:4321
```
Dark mode is the default; Light mode is a toggle. The choice is saved in localStorage.
Photos in `src/data/mock.ts` are remote demo images; replace them when real storage is connected (Phase 4).
Next: Phase 2 (database + RLS), then auth, upload/R2, sharing/trash, ZIP import, admin.

## Phase 1b — auth, profile, settings and admin screens (mock only)
`/login /accept-invitation /register /verify-email /forgot-password /reset-password /change-password /profile /settings /admin/*`
Demo: sign in with an email starting `suspended` to see the suspended state; password `wrong` shows errors and the rate-limit message after 5 tries.

## Phase 2 — database (local Supabase)
```bash
npx supabase init        # once; creates supabase/config.toml (keep the existing migrations folder)
npx supabase start       # needs Docker Desktop
npx supabase db reset    # applies supabase/migrations/*
psql -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/two_accounts.sql
```
First Super Admin: `alter database postgres set app.bootstrap_admin_email = 'you@example.com';` then register that email once (no invitation needed, only while no Super Admin exists).
