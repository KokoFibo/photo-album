-- Run as the PostgreSQL superuser after `bash db/migrate.sh`:
--   psql -U postgres -d album -v ON_ERROR_STOP=1 -f db/tests/sharing.sql
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
insert into public.auth_user (id, name, email) values ('alice-1', 'Alice', 'alice@test.dev'), ('bob-1', 'Bob', 'bob@test.dev'), ('carol-1', 'Carol', 'carol@test.dev');
insert into public.profiles (id, email, display_name) values ('alice-1', 'alice@test.dev', 'Alice'), ('bob-1', 'bob@test.dev', 'Bob'), ('carol-1', 'carol@test.dev', 'Carol');
insert into public.photos (id, owner_id, filename, mime_type, size_bytes, original_key, status, deleted_at) values
  ('11111111-0000-0000-0000-000000000001', 'alice-1', 'ready.jpg',   'image/jpeg', 10, 'users/alice-1/1.jpg', 'ready',   null),
  ('11111111-0000-0000-0000-000000000002', 'alice-1', 'trashed.jpg', 'image/jpeg', 10, 'users/alice-1/2.jpg', 'ready',   now()),
  ('11111111-0000-0000-0000-000000000003', 'alice-1', 'pending.jpg', 'image/jpeg', 10, 'users/alice-1/3.jpg', 'pending', null);
insert into public.photo_variants values ('11111111-0000-0000-0000-000000000001', 'small', 'k/small', 5), ('11111111-0000-0000-0000-000000000001', 'large', 'k/large', 5);
insert into public.photo_locations values ('11111111-0000-0000-0000-000000000001', 48.85, 2.35);
insert into public.albums (id, owner_id, name) values ('22222222-0000-0000-0000-000000000001', 'alice-1', 'Shared album');
insert into public.album_photos (album_id, photo_id) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'), ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'), ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003');

-- members
select t.as_member('bob-1');
select t.ok('before sharing, Bob sees nothing', (select count(*) from public.albums) = 0);
select t.fails('only the owner can share', $q$ select app.share_album('22222222-0000-0000-0000-000000000001', 'carol@test.dev', 'viewer') $q$);
select t.as_member('alice-1');
select t.ok('owner shares by email', app.share_album('22222222-0000-0000-0000-000000000001', 'bob@test.dev', 'viewer') = 'Bob');
select t.fails('unknown email is refused', $q$ select app.share_album('22222222-0000-0000-0000-000000000001', 'nobody@test.dev', 'viewer') $q$);
select t.fails('owner cannot share with herself', $q$ select app.share_album('22222222-0000-0000-0000-000000000001', 'alice@test.dev', 'viewer') $q$);
select t.ok('owner can list the people', (select count(*) from app.album_share_members('22222222-0000-0000-0000-000000000001')) = 1);
select t.ok('download is off by default', not (select can_download from app.album_share_members('22222222-0000-0000-0000-000000000001') where user_id = 'bob-1'));
select t.as_member('bob-1');
select t.ok('Bob now sees the album', (select count(*) from public.albums) = 1);
select t.ok('Bob sees the ready photo', (select count(*) from public.photos where status = 'ready') = 1);
select t.ok('Bob never sees trashed photos', not exists (select 1 from public.photos where deleted_at is not null));
select t.ok('Bob cannot read private GPS', (select count(*) from public.photo_locations) = 0);
select t.ok('Bob sees who owns the album', app.album_owner_name('22222222-0000-0000-0000-000000000001') = 'Alice');
select t.ok('Shared with Me lists the album', (select count(*) from app.shared_with_me()) = 1 and (select photo_count from app.shared_with_me()) = 1);
select t.fails('a viewer cannot add photos', $q$ insert into public.album_photos values ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $q$);
select t.ok('a viewer cannot list the other people', (select count(*) from app.album_share_members('22222222-0000-0000-0000-000000000001')) = 0 and (select count(*) from public.album_members where user_id <> 'bob-1') = 0);
do $$ declare n int; begin update public.album_members set can_download = true where user_id = 'bob-1'; get diagnostics n = row_count; perform t.ok('a member cannot grant themselves download', n = 0 and not app.can_download_photo('11111111-0000-0000-0000-000000000001')); end $$;
select t.as_member('alice-1');
update public.album_members set can_download = true where album_id = '22222222-0000-0000-0000-000000000001' and user_id = 'bob-1';
select t.as_member('bob-1');
select t.ok('a member with permission downloads ready photos only', app.can_download_photo('11111111-0000-0000-0000-000000000001') and not app.can_download_photo('11111111-0000-0000-0000-000000000002') and not app.can_download_photo('11111111-0000-0000-0000-000000000003'));
select t.as_member('carol-1');
select t.ok('Carol (not shared) sees nothing', (select count(*) from public.albums) = 0 and (select count(*) from public.photos) = 0);
select t.as_member('alice-1');
update public.album_members set role = 'editor' where user_id = 'bob-1';
select t.as_member('bob-1');
update public.albums set name = 'Renamed by editor' where id = '22222222-0000-0000-0000-000000000001';
select t.ok('an editor can edit album details', (select name from public.albums where id = '22222222-0000-0000-0000-000000000001') = 'Renamed by editor');
select t.fails('an editor still cannot add photos', $q$ insert into public.album_photos values ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $q$);
delete from public.album_members where user_id = 'bob-1';
select t.ok('a member can leave the album', (select count(*) from public.albums) = 0);

-- guest links: no password, valid until they expire or are revoked
select t.as_super();
insert into public.share_links (album_id, token_hash, allow_download, expires_at, revoked_at) values
  ('22222222-0000-0000-0000-000000000001', encode(sha256(convert_to('good', 'UTF8')), 'hex'),    true,  now() + interval '1 hour',  null),
  ('22222222-0000-0000-0000-000000000001', encode(sha256(convert_to('expired', 'UTF8')), 'hex'), false, now() - interval '1 minute', null),
  ('22222222-0000-0000-0000-000000000001', encode(sha256(convert_to('revoked', 'UTF8')), 'hex'), false, now() + interval '1 hour',  now());
select t.as_service();
select t.ok('a valid link opens', (select count(*) from app.guest_link(encode(sha256(convert_to('good', 'UTF8')), 'hex'))) = 1);
select t.ok('an expired link is refused', (select count(*) from app.guest_link(encode(sha256(convert_to('expired', 'UTF8')), 'hex'))) = 0);
select t.ok('a revoked link is refused', (select count(*) from app.guest_link(encode(sha256(convert_to('revoked', 'UTF8')), 'hex'))) = 0);
select t.ok('an unknown link is refused', (select count(*) from app.guest_link('deadbeef')) = 0);
select t.ok('guests only get ready, active photos', (select count(*) from app.guest_photos(encode(sha256(convert_to('good', 'UTF8')), 'hex'))) = 1);
select t.ok('guest photos include the original key for downloads', (select count(*) from app.guest_photos(encode(sha256(convert_to('good', 'UTF8')), 'hex')) where original_key is not null) = 1);
select t.ok('guest photos carry no GPS or metadata columns', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'guest_photos' and pg_get_function_result(p.oid) ~* 'exif|latitude|longitude|filename'));
select t.as_super();
update public.albums set deleted_at = now() where id = '22222222-0000-0000-0000-000000000001';
select t.as_service();
select t.ok('a link stops working when the album is deleted', (select count(*) from app.guest_link(encode(sha256(convert_to('good', 'UTF8')), 'hex'))) = 0);
select t.as_member('bob-1');
select t.fails('members cannot call guest functions', $q$ select * from app.guest_link('x') $q$);
reset role;
rollback;
\echo
\echo 'Sharing checks passed. Test data rolled back.'
