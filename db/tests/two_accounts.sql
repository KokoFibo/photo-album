-- Run as the PostgreSQL superuser, after `bash db/migrate.sh`:
--   psql -U postgres -d album -v ON_ERROR_STOP=1 -f db/tests/two_accounts.sql
-- Everything is rolled back at the end. Any FAIL stops the script with an error.
begin;
create schema t;  grant usage on schema t to public;
create function t.ok(label text, cond boolean) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function t.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'PASS: % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL: % (an error was expected)', label;
end $$;
create function t.as_member(u text) returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', u, true); set local role album_app; end $$;
create function t.as_service() returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', '', true); set local role album_service; end $$;
create function t.as_super() returns void language plpgsql as $$
begin reset role; perform set_config('app.user_id', '', true); end $$;

-- 1. Bootstrap: only the configured email may register without an invitation, and only while no Super Admin exists
insert into public.app_settings values ('bootstrap_admin_email', 'admin@test.dev');
insert into public.auth_user (id, name, email, email_verified) values ('admin-1', 'Test Admin', 'admin@test.dev', true);
select t.ok('bootstrap creates the Super Admin', exists (select 1 from public.profiles where id = 'admin-1' and role = 'super_admin'));
delete from public.app_settings;

-- 2. Signup without an invitation is rejected, even by the application role
select t.as_member('');
select t.fails('signup without invitation is rejected', $q$ insert into public.auth_user (id, name, email) values ('x1', 'X', 'x@test.dev') $q$);

-- 3. Invitations: hashed tokens, validated through the service role, single use
select t.as_super();
insert into public.invitations (email, token_hash, quota_bytes, invited_by, expires_at) values
  ('alice@test.dev', encode(sha256(convert_to('alice-token', 'UTF8')), 'hex'), 10737418240, 'admin-1', now() + interval '7 days'),
  ('bob@test.dev',   encode(sha256(convert_to('bob-token', 'UTF8')), 'hex'),   10737418240, 'admin-1', now() + interval '7 days');
select t.as_service();
select t.fails('invitation is bound to its email', $q$ select app.begin_signup(encode(sha256(convert_to('alice-token', 'UTF8')), 'hex'), 'bob@test.dev') $q$);
select t.fails('unknown token is rejected', $q$ select app.begin_signup('deadbeef', 'alice@test.dev') $q$);
select app.begin_signup(encode(sha256(convert_to('alice-token', 'UTF8')), 'hex'), 'alice@test.dev');
select app.begin_signup(encode(sha256(convert_to('bob-token', 'UTF8')), 'hex'), 'bob@test.dev');
select t.as_member('');
insert into public.auth_user (id, name, email, email_verified) values ('alice-1', 'Alice', 'alice@test.dev', true), ('bob-1', 'Bob', 'bob@test.dev', true);
select t.as_super();
select t.ok('both members registered through invitations', (select count(*) from public.profiles where role = 'member') = 2);
select t.ok('invitations marked accepted', (select count(*) from public.invitations where status = 'accepted') = 2);
select t.as_member('');
select t.fails('an accepted invitation cannot be reused', $q$ insert into public.auth_user (id, name, email) values ('alice-2', 'Alice again', 'alice@test.dev') $q$);

-- 4. Fixtures (as superuser, bypassing Row Level Security): Alice owns two photos and two albums
select t.as_super();
insert into public.photos (id, owner_id, filename, mime_type, size_bytes, original_key, status) values
  ('11111111-0000-0000-0000-000000000001', 'alice-1', 'alice-private.jpg', 'image/jpeg', 1000, 'users/alice-1/p1.jpg', 'ready'),
  ('11111111-0000-0000-0000-000000000002', 'alice-1', 'alice-shared.jpg',  'image/jpeg', 2000, 'users/alice-1/p2.jpg', 'ready');
insert into public.albums (id, owner_id, name) values
  ('22222222-0000-0000-0000-000000000001', 'alice-1', 'Alice Album One'), ('22222222-0000-0000-0000-000000000002', 'alice-1', 'Alice Album Two');
insert into public.album_photos (album_id, photo_id) values   -- photo 1 only in album one; photo 2 in both
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002');

-- 5. Isolation between members, and the Super Admin sees accounts only
select t.as_member('alice-1');
select t.ok('Alice sees her photos', (select count(*) from public.photos) = 2);
select t.ok('Alice sees her albums', (select count(*) from public.albums) = 2);
select t.as_member('bob-1');
select t.ok('Bob sees none of Alice''s photos', (select count(*) from public.photos) = 0);
select t.ok('Bob sees none of Alice''s albums', (select count(*) from public.albums) = 0);
select t.as_member('admin-1');
select t.ok('Admin sees all profiles', (select count(*) from public.profiles) = 3);
select t.ok('Admin sees no photos', (select count(*) from public.photos) = 0);
select t.ok('Admin sees no albums', (select count(*) from public.albums) = 0);
select t.ok('Admin sees no GPS data', (select count(*) from public.photo_locations) = 0);

-- 6. Members cannot escalate or write around the rules
select t.as_member('bob-1');
select t.fails('member cannot change own quota', $q$ update public.profiles set quota_bytes = 999999999999 where id = 'bob-1' $q$);
select t.fails('member cannot make themselves admin', $q$ update public.profiles set role = 'super_admin' where id = 'bob-1' $q$);
select t.fails('Bob cannot add photos to Alice''s album', $q$ insert into public.album_photos values ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $q$);
select t.fails('members cannot insert photos directly', $q$ insert into public.photos (owner_id, filename, mime_type, size_bytes, original_key) values ('bob-1', 'x.jpg', 'image/jpeg', 1, 'users/bob-1/x.jpg') $q$);
select t.fails('members cannot read signup grants', $q$ select * from public.signup_grants $q$);
select t.fails('members cannot call service functions', $q$ select app.finalize_upload(gen_random_uuid(), '[]'::jsonb, 1, null, null) $q$);
select t.fails('members cannot read app settings', $q$ select 1 from public.app_settings $q$);
select t.as_member('admin-1');
update public.profiles set quota_bytes = 5368709120 where id = 'bob-1';
select t.as_super();
select t.ok('Super Admin can change a member quota', (select quota_bytes from public.profiles where id = 'bob-1') = 5368709120);
select t.as_member('admin-1');
select t.fails('Super Admin cannot delete themselves', $q$ select app.delete_member('admin-1') $q$);

-- 7. Quota reservation and the server-side upload flow
select t.as_member('alice-1');
select t.fails('reservation above the quota is refused', $q$ select app.reserve_upload(99999999999) $q$);
select set_config('t.res', app.reserve_upload(3000)::text, false);
select t.as_service();
select app.create_pending_photo('alice-1', '33333333-0000-0000-0000-000000000001', 'new.jpg', 'image/jpeg', 2000, 400, 300, repeat('a', 64), now(), '{}'::jsonb, 'users/alice-1/new.jpg', current_setting('t.res')::uuid);
select app.finalize_upload('33333333-0000-0000-0000-000000000001',
  '[{"kind":"thumbnail","key":"k-t","size":300},{"kind":"small","key":"k-s","size":300},{"kind":"medium","key":"k-m","size":200},{"kind":"large","key":"k-l","size":200}]'::jsonb, 3000, 48.85, 2.35);
select t.as_super();
select t.ok('finalize marks the photo ready and adds usage', (select status::text from public.photos where id = '33333333-0000-0000-0000-000000000001') = 'ready'
  and (select used_bytes from public.profiles where id = 'alice-1') = 3000);
select t.as_member('alice-1');
select t.ok('owner can read the private GPS row', (select count(*) from public.photo_locations) = 1);
select t.as_member('bob-1');
select t.ok('other members cannot read GPS', (select count(*) from public.photo_locations) = 0);

-- 8. Trash: delete-orphans and original restore
select t.as_member('alice-1');
select app.delete_album('22222222-0000-0000-0000-000000000001');
select t.as_super();
select t.ok('album moved to Trash', exists (select 1 from public.albums where id = '22222222-0000-0000-0000-000000000001' and deleted_at is not null));
select t.ok('album-only photo moved to Trash', exists (select 1 from public.photos where id = '11111111-0000-0000-0000-000000000001' and deleted_at is not null and deleted_by_album_id = '22222222-0000-0000-0000-000000000001'));
select t.ok('shared photo stays active', exists (select 1 from public.photos where id = '11111111-0000-0000-0000-000000000002' and deleted_at is null));
select t.as_member('bob-1');
select t.fails('another member cannot restore the album', $q$ select app.restore_album('22222222-0000-0000-0000-000000000001') $q$);
select t.as_member('alice-1');
select app.restore_album('22222222-0000-0000-0000-000000000001');
select t.as_super();
select t.ok('album restored', exists (select 1 from public.albums where id = '22222222-0000-0000-0000-000000000001' and deleted_at is null));
select t.ok('album-only photo restored', exists (select 1 from public.photos where id = '11111111-0000-0000-0000-000000000001' and deleted_at is null));

reset role;
rollback;
\echo
\echo 'All checks passed. Test data rolled back.'
