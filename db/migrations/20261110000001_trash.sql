-- Trash: permanent deletion and scheduled cleanup helpers.
-- Member: permanently remove their own trashed albums (the API deletes the stored files of their photos first).
create function app.purge_albums(p_ids uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_active_member() then raise exception 'Account is not active'; end if;
  delete from public.albums where id = any(p_ids) and owner_id = app.uid() and deleted_at is not null;
  get diagnostics n = row_count; return n;
end $$;

-- Service (scheduled cleanup)
create function app.purge_due_albums() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.albums where deleted_at is not null and purge_after <= now();
  get diagnostics n = row_count; return n;
end $$;
create function app.stale_pending_photos(p_hours int default 24) returns table (id uuid, owner_id text, original_key text)
language sql stable security definer set search_path = '' as
$$ select p.id, p.owner_id, p.original_key from public.photos p where p.status in ('pending', 'failed') and p.created_at < now() - make_interval(hours => p_hours) $$;
create function app.cleanup_reservations() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.upload_reservations where not completed and expires_at < now();
  get diagnostics n = row_count; return n;
end $$;

revoke all on function app.purge_albums(uuid[]), app.purge_due_albums(), app.stale_pending_photos(int), app.cleanup_reservations() from public;
grant execute on function app.purge_albums(uuid[]) to album_app;
grant execute on function app.purge_due_albums(), app.stale_pending_photos(int), app.cleanup_reservations() to album_service;
