-- Copy to db/seed.sql and put YOUR email below. `bash db/migrate.sh` applies it.
-- That one email may register without an invitation, only while no Super Admin exists.
insert into public.app_settings (key, value) values ('bootstrap_admin_email', 'you@example.com')
on conflict (key) do update set value = excluded.value;
