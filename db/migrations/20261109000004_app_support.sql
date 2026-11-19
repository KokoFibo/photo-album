-- Support functions for the API (service role) and last-activity tracking.
create function app.find_pending_duplicate(p_owner text, p_sha text) returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as
$$ select p.id, p.created_at from public.photos p where p.owner_id = p_owner and p.sha256 = p_sha and p.deleted_at is null and p.status = 'pending' $$;

create function app.member_object_keys(p_user text) returns setof text language sql stable security definer set search_path = '' as
$$ select p.original_key from public.photos p where p.owner_id = p_user
   union all select v.object_key from public.photo_variants v join public.photos p on p.id = v.photo_id where p.owner_id = p_user $$;

revoke all on function app.find_pending_duplicate(text, text), app.member_object_keys(text) from public;
grant execute on function app.find_pending_duplicate(text, text), app.member_object_keys(text) to album_service;
grant update (last_active_at) on public.profiles to album_app;
