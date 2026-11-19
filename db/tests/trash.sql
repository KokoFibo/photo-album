-- Run as the PostgreSQL superuser after `bash db/migrate.sh`:
--   psql -U postgres -d album -v ON_ERROR_STOP=1 -f db/tests/trash.sql
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

alter table public.auth_user disable trigger user;   -- fixtures only: create accounts without invitations
insert into public.auth_user (id, name, email) values ('alice-1', 'Alice', 'alice@test.dev'), ('bob-1', 'Bob', 'bob@test.dev');
insert into public.profiles (id, email, display_name, used_bytes) values ('alice-1', 'alice@test.dev', 'Alice', 3000), ('bob-1', 'bob@test.dev', 'Bob', 0);
insert into public.photos (id, owner_id, filename, mime_type, size_bytes, original_key, status, deleted_at, purge_after) values
  ('11111111-0000-0000-0000-000000000001', 'alice-1', 'due.jpg',   'image/jpeg', 2000, 'users/alice-1/due.jpg',   'ready', now() - interval '31 days', now() - interval '1 day'),
  ('11111111-0000-0000-0000-000000000002', 'alice-1', 'later.jpg', 'image/jpeg', 500,  'users/alice-1/later.jpg', 'ready', now(),                        now() + interval '30 days');
insert into public.photo_variants values ('11111111-0000-0000-0000-000000000001', 'small', 'users/alice-1/v/due-small.webp', 1000);
insert into public.photos (id, owner_id, filename, mime_type, size_bytes, original_key, status, created_at) values
  ('11111111-0000-0000-0000-000000000003', 'alice-1', 'stuck.jpg', 'image/jpeg', 10, 'users/alice-1/stuck.jpg', 'pending', now() - interval '2 days');
insert into public.albums (id, owner_id, name, deleted_at, purge_after) values
  ('22222222-0000-0000-0000-000000000001', 'alice-1', 'Gone album', now() - interval '31 days', now() - interval '1 day'),
  ('22222222-0000-0000-0000-000000000002', 'alice-1', 'Fresh trashed album', now(), now() + interval '30 days');

select t.as_service();
select t.ok('only expired photos are due for purge', (select count(*) from app.photos_due_for_purge(100)) = 1);
select t.ok('due photo lists its variant keys', (select cardinality(variant_keys) from app.photos_due_for_purge(100)) = 1);
select t.ok('abandoned uploads are found', (select count(*) from app.stale_pending_photos(24)) = 1);
select app.finalize_purge('11111111-0000-0000-0000-000000000001');
select t.as_super();
select t.ok('purge frees original plus variant bytes', (select used_bytes from public.profiles where id = 'alice-1') = 0);
select t.ok('purged photo row is gone', not exists (select 1 from public.photos where id = '11111111-0000-0000-0000-000000000001'));
select t.as_service();
select t.ok('expired albums are removed by the job', app.purge_due_albums() = 1);
select t.as_super();
select t.ok('fresh trashed album stays', exists (select 1 from public.albums where id = '22222222-0000-0000-0000-000000000002'));

select t.as_member('bob-1');
select t.ok('another member cannot purge Alice''s album', app.purge_albums(array['22222222-0000-0000-0000-000000000002'::uuid]) = 0);
select t.fails('members cannot call the purge job functions', $q$ select app.finalize_purge('11111111-0000-0000-0000-000000000002') $q$);
select t.as_member('alice-1');
select t.ok('owner can purge her trashed album', app.purge_albums(array['22222222-0000-0000-0000-000000000002'::uuid]) = 1);
reset role;
rollback;
\echo
\echo 'Trash checks passed. Test data rolled back.'
