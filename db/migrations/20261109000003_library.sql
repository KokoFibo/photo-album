-- Quota reservations: the row lock on the profile serialises concurrent uploads.
create function app.reserve_upload(p_bytes bigint) returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; reserved bigint; rid uuid;
begin
  select * into me from public.profiles where id = app.uid() for update;
  if not found or me.status <> 'active' then raise exception 'Account is not active'; end if;
  select coalesce(sum(bytes), 0) into reserved from public.upload_reservations where user_id = me.id and not completed and expires_at > now();
  if me.used_bytes + reserved + p_bytes > me.quota_bytes then raise exception 'Not enough storage space'; end if;
  insert into public.upload_reservations (user_id, bytes) values (me.id, p_bytes) returning id into rid;
  return rid;
end $$;

-- Server-only upload steps (album_service). Clients never write photos directly.
create function app.create_pending_photo(p_owner text, p_id uuid, p_filename text, p_mime text, p_size bigint, p_width int, p_height int,
  p_sha text, p_taken timestamptz, p_exif jsonb, p_key text, p_reservation uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.photos (id, owner_id, filename, mime_type, size_bytes, width, height, sha256, taken_at, exif, original_key, status)
  values (p_id, p_owner, p_filename, p_mime, p_size, p_width, p_height, p_sha, p_taken, p_exif, p_key, 'pending');
  update public.upload_reservations set photo_id = p_id where id = p_reservation and user_id = p_owner;
end $$;
create function app.abort_reservation(p_id uuid) returns void language sql security definer set search_path = '' as
$$ delete from public.upload_reservations where id = p_id and not completed $$;

create function app.finalize_upload(p_photo uuid, p_variants jsonb, p_total bigint, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare ph public.photos; res public.upload_reservations;
begin
  select * into ph from public.photos where id = p_photo and status = 'pending' for update;
  if not found then raise exception 'Upload not found'; end if;
  select * into res from public.upload_reservations where photo_id = p_photo and not completed and expires_at > now() for update;
  if not found then raise exception 'Upload reservation expired'; end if;
  if p_total > res.bytes then raise exception 'Upload is larger than reserved'; end if;
  insert into public.photo_variants (photo_id, kind, object_key, size_bytes)
    select p_photo, v ->> 'kind', v ->> 'key', (v ->> 'size')::bigint from jsonb_array_elements(p_variants) v;
  if p_lat is not null and p_lng is not null then insert into public.photo_locations values (p_photo, p_lat, p_lng); end if;
  update public.profiles set used_bytes = used_bytes + p_total where id = ph.owner_id;
  update public.photos set status = 'ready' where id = p_photo;
  update public.upload_reservations set completed = true where id = res.id;
end $$;
create function app.abort_upload(p_photo uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.photos where id = p_photo and status in ('pending', 'failed');
  delete from public.upload_reservations where photo_id = p_photo and not completed;
end $$;

-- Trash rules. Member-facing; ownership is checked inside each function.
create function app.trash_photos(p_ids uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_active_member() then raise exception 'Account is not active'; end if;
  update public.photos set deleted_at = now(), purge_after = now() + interval '30 days'
   where id = any(p_ids) and owner_id = app.uid() and deleted_at is null;
  get diagnostics n = row_count; return n;
end $$;

-- delete-orphans: trash the album, plus photos that are in no other active album. Relationships are preserved.
create function app.delete_album(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me text := app.uid();
begin
  if not app.is_active_member() or not exists (select 1 from public.albums where id = p_id and owner_id = me and deleted_at is null) then raise exception 'Album not found'; end if;
  update public.photos p set deleted_at = now(), deleted_by_album_id = p_id, purge_after = now() + interval '30 days'
   where p.owner_id = me and p.deleted_at is null
     and exists (select 1 from public.album_photos ap where ap.album_id = p_id and ap.photo_id = p.id)
     and not exists (select 1 from public.album_photos ap join public.albums a on a.id = ap.album_id
                     where ap.photo_id = p.id and ap.album_id <> p_id and a.deleted_at is null);
  update public.albums set deleted_at = now(), purge_after = now() + interval '30 days' where id = p_id;
end $$;
create function app.restore_album(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me text := app.uid();
begin
  if not app.is_active_member() or not exists (select 1 from public.albums where id = p_id and owner_id = me and deleted_at is not null) then raise exception 'Album not found in Trash'; end if;
  update public.albums set deleted_at = null, purge_after = null where id = p_id;
  update public.photos set deleted_at = null, purge_after = null, deleted_by_album_id = null where deleted_by_album_id = p_id and owner_id = me;
end $$;
create function app.restore_photos(p_ids uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_active_member() then raise exception 'Account is not active'; end if;
  update public.photos set deleted_at = null, purge_after = null, deleted_by_album_id = null where id = any(p_ids) and owner_id = app.uid() and deleted_at is not null;
  get diagnostics n = row_count; return n;
end $$;

-- Purge helpers (album_service). Quota is freed only after the object store confirms deletion.
create function app.photos_due_for_purge(p_limit int default 100) returns table (id uuid, owner_id text, original_key text, variant_keys text[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.owner_id, p.original_key, coalesce(array(select object_key from public.photo_variants v where v.photo_id = p.id), '{}')
  from public.photos p where p.deleted_at is not null and p.purge_after <= now() order by p.purge_after limit p_limit $$;
create function app.finalize_purge(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare freed bigint; ow text;
begin
  select p.size_bytes + coalesce((select sum(size_bytes) from public.photo_variants v where v.photo_id = p.id), 0), p.owner_id into freed, ow
    from public.photos p where p.id = p_id and p.deleted_at is not null;
  if freed is null then return; end if;
  update public.profiles set used_bytes = greatest(0, used_bytes - freed) where id = ow;
  delete from public.photos where id = p_id;
end $$;

-- Super Admin: delete a member account (cascades to their library rows; the API removes their stored files first).
create function app.delete_member(p_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Not allowed'; end if;
  if p_id = app.uid() then raise exception 'You cannot delete your own account'; end if;
  if exists (select 1 from public.profiles where id = p_id and role = 'super_admin') then raise exception 'Super Admin accounts cannot be deleted here'; end if;
  delete from public.auth_user where id = p_id;
  insert into public.audit_logs (actor_id, action, target) values (app.uid(), 'member.deleted', p_id);
end $$;
create function app.audit(p_actor text, p_action text, p_target text) returns void language sql security definer set search_path = '' as
$$ insert into public.audit_logs (actor_id, action, target) values (p_actor, p_action, p_target) $$;

create function app.touch_album() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.albums set updated_at = now() where id = coalesce(new.album_id, old.album_id); return null; end $$;
create trigger album_photos_touch after insert or delete on public.album_photos for each row execute function app.touch_album();

-- ---- Grants: nothing is open by default --------------------------------------------------------------
revoke all on all functions in schema app from public;
grant usage on schema app to album_app, album_service;
grant execute on function app.uid(), app.is_super_admin(), app.is_active_member(), app.owns_album(uuid), app.can_view_album(uuid), app.can_edit_album(uuid) to album_app, album_service;
grant execute on function app.reserve_upload(bigint), app.trash_photos(uuid[]), app.delete_album(uuid), app.restore_album(uuid), app.restore_photos(uuid[]), app.delete_member(text) to album_app;
grant execute on function app.begin_signup(text, text), app.lookup_invitation(text), app.create_pending_photo(text, uuid, text, text, bigint, int, int, text, timestamptz, jsonb, text, uuid),
  app.abort_reservation(uuid), app.finalize_upload(uuid, jsonb, bigint, double precision, double precision), app.abort_upload(uuid),
  app.photos_due_for_purge(int), app.finalize_purge(uuid), app.audit(text, text, text) to album_service;

grant select on all tables in schema public to album_app;
revoke all on public.schema_migrations, public.signup_grants, public.app_settings from album_app;
grant insert, update, delete on public.auth_user, public.auth_session, public.auth_account, public.auth_verification to album_app;   -- Better Auth
grant insert, update, delete on public.invitations to album_app;                                 -- Super Admin only, by policy
grant insert, update on public.albums to album_app;
grant insert, update, delete on public.album_photos, public.album_members, public.favorites, public.share_links to album_app;
grant update (display_name, avatar_key, status, quota_bytes) on public.profiles to album_app;
-- photos, photo_locations, photo_variants, upload_reservations, audit_logs: read-only for album_app; writes go through functions
