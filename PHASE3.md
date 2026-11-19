# Phase 3 setup (real authentication, invitations, Worker API)

1. Dependencies
   npm install @supabase/supabase-js
   cd worker && npm install && cd ..
2. Keys: `npx supabase status` (use the anon/publishable key and the service_role/secret key)
   cp .env.example .env                      -> fill PUBLIC_SUPABASE_ANON_KEY
   cp worker/.dev.vars.example worker/.dev.vars -> fill both keys
3. supabase/config.toml: set these (edit the existing sections)
     [auth]
     site_url = "http://localhost:4321"
     additional_redirect_urls = ["http://localhost:4321/verify-email", "http://localhost:4321/reset-password"]
     minimum_password_length = 10
     [auth.email]
     enable_confirmations = true
     [auth.captcha]
     enabled = true
     provider = "turnstile"
     secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"
   supabase/.env  ->  SUPABASE_AUTH_CAPTCHA_SECRET=1x0000000000000000000000000000000AA   (Cloudflare's always-pass test secret)
   (To skip Turnstile while debugging: captcha enabled = false and leave PUBLIC_TURNSTILE_SITE_KEY empty.)
4. First admin: copy supabase/seed.sql.example to supabase/seed.sql, put your email in it.
5. npx supabase stop && npx supabase start && npx supabase db reset   (applies the new migration + seed)
   psql -v ON_ERROR_STOP=1 ... -f supabase/tests/two_accounts.sql      (must stay green)
6. Run:  terminal 1: npm run dev     terminal 2: cd worker && npm run dev
7. Flow: /register?bootstrap=1 -> confirmation email in http://127.0.0.1:54324 (Inbucket) -> /login -> /admin/invitations
   -> create invitation (dev mode shows the link instead of sending mail) -> open it in a private window -> register -> confirm email -> login.
