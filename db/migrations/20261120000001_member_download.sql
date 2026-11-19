-- Album owners can allow individual members (viewer or editor) to download the original photos. Off by default.
alter table public.album_members add column can_download boolean not null default false;

drop function app.album_share_members(uuid);
create function app.album_share_members(p_album uuid) returns table (user_id text, display_name text, email text, role public.share_role, can_download boolean)
language sql stable security definer set search_path = '' as
$$ select m.user_id, p.display_name, p.email, m.role, m.can_download from public.album_members m join public.profiles p on p.id = m.user_id
   where m.album_id = p_album and app.owns_album(p_album) order by p.display_name $$;

-- True when the signed-in member may download the original of this photo through an album that was shared with that permission.
create function app.can_download_photo(p_photo uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select app.is_active_member() and exists (
     select 1 from public.album_photos ap
       join public.album_members m on m.album_id = ap.album_id and m.user_id = app.uid() and m.can_download
       join public.albums a on a.id = ap.album_id and a.deleted_at is null
       join public.photos p on p.id = ap.photo_id and p.deleted_at is null and p.status = 'ready'
     where ap.photo_id = p_photo) $$;

revoke all on function app.album_share_members(uuid), app.can_download_photo(uuid) from public;
grant execute on function app.album_share_members(uuid), app.can_download_photo(uuid) to album_app;
