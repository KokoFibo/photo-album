-- Guest links that allow downloads now hand out the original file instead of the preview size.
-- The function still returns no metadata, no GPS and no filename.
drop function app.guest_photos(text);

create function app.guest_photos(p_hash text) returns table (id uuid, width int, height int, small_key text, large_key text, original_key text, mime_type text)
language sql stable security definer set search_path = '' as
$$ select p.id, p.width, p.height,
     (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'small'),
     (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'large'),
     p.original_key, p.mime_type
   from public.share_links l join public.albums a on a.id = l.album_id join public.album_photos ap on ap.album_id = a.id join public.photos p on p.id = ap.photo_id
   where l.token_hash = p_hash and l.revoked_at is null and l.expires_at > now() and a.deleted_at is null and p.deleted_at is null and p.status = 'ready'
   order by ap.position, p.taken_at, p.id limit 1000 $$;

revoke all on function app.guest_photos(text) from public;
grant execute on function app.guest_photos(text) to album_service;
