# Plain PostgreSQL (Windows) — database layer

The app code still talks to Supabase until the next step (Better Auth + API). Keep the Supabase stack and the `supabase/` folder for now.

1. Install PostgreSQL 15 or newer (EDB installer). Remember the `postgres` password. Default port 5432.
   Check:  psql --version   and   psql -U postgres -c "show server_encoding"   (must be UTF8)
2. Create the roles and the `album` database (once). Use simple passwords, letters and digits only:
     psql -U postgres -v owner_pw=OWNERPASS -v app_pw=APPPASS -v svc_pw=SVCPASS -f db/setup.sql
3. Connection settings:   cp db/.env.example db/.env     then put the same three passwords in the three URLs.
4. First admin email:     cp db/seed.example.sql db/seed.sql     then replace you@example.com with your email.
5. Apply the schema:      bash db/migrate.sh
6. Run the checks:        psql -U postgres -d album -v ON_ERROR_STOP=1 -f db/tests/two_accounts.sql
   Every line should say PASS and the script ends with "All checks passed".
Do not commit db/.env. To start over: psql -U postgres -c "drop database album" then repeat steps 2 and 5.
