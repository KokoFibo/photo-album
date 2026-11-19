-- Run as the PostgreSQL superuser after `bash db/migrate.sh`:
--   psql -U postgres -d album -v ON_ERROR_STOP=1 -f db/tests/admin.sql
begin;
create schema t; grant usage on schema t to public;
create function t.ok(label text, cond boolean) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function t.fails(label text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then raise notice 'PASS: % (%)', label, sqlerrm; return; end; raise exception 'FAIL: % (an error was expected)', label; end $$;
create function t.as_member(u text) returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', u, true); set local role album_app; end $$;
create function t.as_service() returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', '', true); set local role album_service; end $$;
create function t.as_super() returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', '', true); end $$;

alter table public.auth_user disable trigger user;   -- fixtures only
insert into public.auth_user (id, name, email) values ('admin-1', 'Admin', 'admin@test.dev'), ('alice-1', 'Alice', 'alice@test.dev');
insert into public.profiles (id, email, display_name, role, used_bytes, quota_bytes) values ('admin-1', 'admin@test.dev', 'Admin', 'super_admin', 0, 1000), ('alice-1', 'alice@test.dev', 'Alice', 'member', 400, 1000);
insert into public.photos (owner_id, filename, mime_type, size_bytes, original_key, status) values
  ('alice-1', 'secret-name.jpg', 'image/jpeg', 400, 'users/alice-1/a.jpg', 'ready'), ('alice-1', 'broken.jpg', 'image/jpeg', 10, 'users/alice-1/b.jpg', 'failed');

select t.as_member('admin-1');
select t.ok('admin sees the overview totals', (select members from app.admin_overview()) = 2 and (select photos from app.admin_overview()) = 1 and (select failed_uploads from app.admin_overview()) = 1);
select t.ok('admin sees per-member storage', (select count(*) from app.admin_storage()) = 2 and (select used_bytes from app.admin_storage() where id = 'alice-1') = 400);
select t.ok('upload activity covers the requested days', (select count(*) from app.admin_upload_activity(14)) = 14);
select t.ok('admin still cannot read photos directly', (select count(*) from public.photos) = 0);
select t.ok('operational functions expose no names, keys or GPS', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname like 'admin\_%' and pg_get_function_result(p.oid) ~* 'filename|object_key|original_key|exif|latitude|longitude|album_name'));
select app.admin_set_settings(30, 14);
select t.ok('settings round-trip', (select default_quota_gb from app.admin_get_settings()) = 30 and (select invite_expiry_days from app.admin_get_settings()) = 14);
select t.fails('invalid settings are refused', $q$ select app.admin_set_settings(0, 7) $q$);

select t.as_member('alice-1');
select t.ok('members get nothing from admin overview', (select count(*) from app.admin_overview()) = 0);
select t.ok('members get nothing from admin storage', (select count(*) from app.admin_storage()) = 0);
select t.ok('members get nothing from job pages', (select count(*) from app.admin_job_runs(10)) = 0 and (select count(*) from app.admin_job_backlog()) = 0);
select t.fails('members cannot change platform settings', $q$ select app.admin_set_settings(500, 7) $q$);
select t.fails('members cannot write job runs', $q$ select app.record_job_run('cleanup', now(), true, '{}', null) $q$);
select t.fails('members cannot read the job table', $q$ select * from public.job_runs $q$);

select t.as_service();
select app.record_job_run('cleanup', now() - interval '1 second', true, '{"photos": 2}', null);
select t.as_member('admin-1');
select t.ok('admin sees recorded job runs', (select count(*) from app.admin_job_runs(10)) = 1 and (select (summary ->> 'photos')::int from app.admin_job_runs(10)) = 2);
reset role;
rollback;
\echo
\echo 'Admin checks passed. Test data rolled back.'
