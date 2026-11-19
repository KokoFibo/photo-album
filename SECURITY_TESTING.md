# Security testing

## 1. Automatic tests (run after every change)
Database rules (Row Level Security, roles, guest links, admin privacy):
    export PGPASSWORD=<postgres password>
    bash db/tests/run-all.sh                       -> must end with: ALL DATABASE TESTS PASSED

API tests (needs the Worker running: cd worker && npm run dev):
    cp tests/.env.example tests/.env               -> fill in a TEST member and the admin; also DATABASE_ADMIN_URL from db/.env
    node --env-file=tests/.env tests/security.mjs  -> must end with: N passed, 0 failed
The script uploads a few fake photos into the member's library, tries to attack them from the other account,
and removes everything again. Do not run it against a production account.

## 2. Things the scripts cannot check (do these by hand)
- Real expiry: create a guest link, wait 61 minutes, open it in a private window -> "This link has expired".
- Cookies in production (after deploy): DevTools > Application > Cookies: the session cookie must be Secure, HttpOnly, SameSite=Lax.
- Turnstile: with TURNSTILE_SECRET set, sign-in without solving the check must fail.
- /dev/mail, /dev/r2 must answer 404 in production (ENVIRONMENT = "production").
- R2: the bucket must have NO public access and NO custom public domain. Opening a raw R2 object URL must fail.
- Phones (Android and iPhone): do these on the staging site over HTTPS. A phone cannot use the local dev server, because the
  browser only allows the hashing API (crypto.subtle) on HTTPS or localhost.
    * Add Photos > choose several photos from the gallery > progress > photos appear.
    * Take Photo with the camera.
    * Open a guest link on the phone; swipe between photos.
    * Sign in, sign out, theme switch, bottom navigation.

## 3. Known limits to fix before going live
- Rate limiter is in memory per Worker instance: switch to Cloudflare's Rate Limiting binding in production.
- Production needs: ENVIRONMENT=production, new random BETTER_AUTH_SECRET and MEDIA_SIGNING_SECRET, Resend key, Turnstile keys.
- `npm audit --omit=dev` in the project root and in worker/: read the report, update packages that have fixes. Do not use --force blindly.
- Backups: enable automatic backups for the managed PostgreSQL; R2 has no automatic backup of deleted objects.
