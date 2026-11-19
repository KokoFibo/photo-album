-- Album sharing: members (viewer/editor) and guest links (no password, always 1 hour).
create policy members_leave on public.album_members for delete using (user_id = app.uid());   -- a member may leave an album shared with them

-- Owner shares by the email of a registered member. Only the owner can call this.
create function app.share_album(p_album uuid, p_email text, p_role public.share_role) returns text
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  if not app.owns_album(p_album) or not exists (select 1 from public.albums where id = p_album and deleted_at is null) then raise exception 'Album not found'; end if;
  select * into target from public.profiles where lower(email) = lower(trim(p_email)) and status = 'active';
  if not found then raise exception 'No member with that email address'; end if;
  if target.id = app.uid() then raise exception 'You already own this album'; end if;
  insert into public.album_members (album_id, user_id, role) values (p_album, target.id, p_role)
    on conflict (album_id, user_id) do update set role = excluded.role;
  update public.albums set updated_at = now() where id = p_album;
  return target.display_name;
end $$;

create function app.album_share_members(p_album uuid) returns table (user_id text, display_name text, email text, role public.share_role)
language sql stable security definer set search_path = '' as
$$ select m.user_id, p.display_name, p.email, m.role from public.album_members m join public.profiles p on p.id = m.user_id
   where m.album_id = p_album and app.owns_album(p_album) order by p.display_name $$;

create function app.album_owner_name(p_album uuid) returns text language sql stable security definer set search_path = '' as
$$ select o.display_name from public.albums a join public.profiles o on o.id = a.owner_id where a.id = p_album and app.can_view_album(p_album) $$;

create function app.shared_with_me() returns table (id uuid, name text, description text, updated_at timestamptz, owner_name text, role public.share_role,
  photo_count bigint, cover_photo_id uuid, first_photo_id uuid) language sql stable security definer set search_path = '' as
$$ select a.id, a.name, a.description, a.updated_at, o.display_name, m.role,
     (select count(*) from public.album_photos ap join public.photos p on p.id = ap.photo_id where ap.album_id = a.id and p.deleted_at is null and p.status = 'ready'),
     (select p.id from public.photos p where p.id = a.cover_photo_id and p.deleted_at is null and p.status = 'ready'),
     (select ap.photo_id from public.album_photos ap join public.photos p on p.id = ap.photo_id where ap.album_id = a.id and p.deleted_at is null and p.status = 'ready' order by ap.position, ap.added_at limit 1)
   from public.album_members m join public.albums a on a.id = m.album_id join public.profiles o on o.id = a.owner_id
   where m.user_id = app.uid() and a.deleted_at is null and app.is_active_member() order by a.updated_at desc $$;

-- Guest links (service role only). A link works until it expires or is revoked. Photos are returned WITHOUT metadata or GPS.
create function app.guest_link(p_hash text) returns table (album_id uuid, name text, description text, allow_download boolean, expires_at timestamptz)
language sql stable security definer set search_path = '' as
$$ select a.id, a.name, a.description, l.allow_download, l.expires_at from public.share_links l join public.albums a on a.id = l.album_id
   where l.token_hash = p_hash and l.revoked_at is null and l.expires_at > now() and a.deleted_at is null $$;

create function app.guest_photos(p_hash text) returns table (id uuid, width int, height int, small_key text, large_key text)
language sql stable security definer set search_path = '' as
$$ select p.id, p.width, p.height,
     (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'small'),
     (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = 'large')
   from public.share_links l join public.albums a on a.id = l.album_id join public.album_photos ap on ap.album_id = a.id join public.photos p on p.id = ap.photo_id
   where l.token_hash = p_hash and l.revoked_at is null and l.expires_at > now() and a.deleted_at is null and p.deleted_at is null and p.status = 'ready'
   order by ap.position, p.taken_at, p.id limit 1000 $$;

create function app.cleanup_share_links() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.share_links where expires_at < now() - interval '7 days';
  get diagnostics n = row_count; return n;
end $$;

revoke all on function app.share_album(uuid, text, public.share_role), app.album_share_members(uuid), app.album_owner_name(uuid), app.shared_with_me(),
  app.guest_link(text), app.guest_photos(text), app.cleanup_share_links() from public;
grant execute on function app.share_album(uuid, text, public.share_role), app.album_share_members(uuid), app.album_owner_name(uuid), app.shared_with_me() to album_app;
grant execute on function app.guest_link(text), app.guest_photos(text), app.cleanup_share_links() to album_service;
