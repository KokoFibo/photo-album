-- Identity comes from the API: each request runs in a transaction that starts with
--   select set_config('app.user_id', '<user id>', true);
create function app.uid() returns text language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create function app.is_super_admin() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.profiles where id = app.uid() and role = 'super_admin' and status = 'active') $$;
create function app.is_active_member() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.profiles where id = app.uid() and status = 'active') $$;
create function app.owns_album(a uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select app.is_active_member() and exists (select 1 from public.albums where id = a and owner_id = app.uid()) $$;
create function app.can_view_album(a uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select app.is_active_member() and exists (select 1 from public.albums al where al.id = a and al.deleted_at is null
   and (al.owner_id = app.uid() or exists (select 1 from public.album_members m where m.album_id = a and m.user_id = app.uid()))) $$;
create function app.can_edit_album(a uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select app.is_active_member() and exists (select 1 from public.albums al where al.id = a and al.deleted_at is null
   and (al.owner_id = app.uid() or exists (select 1 from public.album_members m where m.album_id = a and m.user_id = app.uid() and m.role = 'editor'))) $$;

-- Albums may only hold photos owned by the album owner.
create function app.enforce_album_photo_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.albums where id = new.album_id) is distinct from (select owner_id from public.photos where id = new.photo_id) then
    raise exception 'Album can only contain photos owned by the album owner';
  end if;
  return new;
end $$;
create trigger album_photo_owner before insert or update on public.album_photos for each row execute function app.enforce_album_photo_owner();

-- Members may only change display_name and avatar_key. Role, status and quota are Super Admin only. Server-side jobs (no user) are exempt.
create function app.guard_profile_update() returns trigger language plpgsql as $$
begin
  if app.uid() is null then return new; end if;
  if not app.is_super_admin() and (new.role, new.status, new.quota_bytes, new.used_bytes, new.id, new.email) is distinct from (old.role, old.status, old.quota_bytes, old.used_bytes, old.id, old.email) then
    raise exception 'You can only edit your display name and profile photo';
  end if;
  if old.id = app.uid() and (new.role, new.status) is distinct from (old.role, old.status) then raise exception 'You cannot change your own role or status'; end if;
  return new;
end $$;
create trigger guard_profile_update before update on public.profiles for each row execute function app.guard_profile_update();

-- ---- Invitation-only signup, enforced in the database ------------------------------------------------
create function app.bootstrap_allowed(p_email text) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.app_settings where key = 'bootstrap_admin_email' and lower(value) = lower(p_email))
       and not exists (select 1 from public.profiles where role = 'super_admin') $$;

-- Called by the API (service role) after it hashed the raw token. Raw tokens never reach the database.
create function app.begin_signup(p_hash text, p_email text) returns void language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations where token_hash = p_hash for update;
  if not found or inv.status <> 'pending' or inv.expires_at <= now() or lower(inv.email) <> lower(p_email) then
    raise exception 'This invitation is invalid, expired or was issued for another email address';
  end if;
  insert into public.signup_grants (email, invitation_id, expires_at) values (lower(p_email), inv.id, now() + interval '15 minutes')
  on conflict (email) do update set invitation_id = excluded.invitation_id, expires_at = excluded.expires_at;
end $$;

create function app.lookup_invitation(p_hash text) returns table (email text, quota_bytes bigint) language sql stable security definer set search_path = '' as
$$ select i.email, i.quota_bytes from public.invitations i where i.token_hash = p_hash and i.status = 'pending' and i.expires_at > now() $$;

create function app.validate_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.bootstrap_allowed(new.email) then return new; end if;
  if not exists (select 1 from public.signup_grants where email = lower(new.email) and expires_at > now()) then
    raise exception 'Registration requires an invitation';
  end if;
  return new;
end $$;
create trigger trg_00_validate_signup before insert on public.auth_user for each row execute function app.validate_signup();

create function app.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.signup_grants; inv public.invitations;
begin
  if app.bootstrap_allowed(new.email) then
    insert into public.profiles (id, email, display_name, role, quota_bytes) values (new.id, new.email, left(new.name, 80), 'super_admin', 107374182400);
    return new;
  end if;
  select * into g from public.signup_grants where email = lower(new.email) and expires_at > now();
  select * into inv from public.invitations where id = g.invitation_id for update;
  insert into public.profiles (id, email, display_name, quota_bytes) values (new.id, new.email, left(new.name, 80), inv.quota_bytes);
  update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = new.id where id = inv.id;   -- single use
  delete from public.signup_grants where email = g.email;
  insert into public.audit_logs (actor_id, action, target) values (new.id, 'invitation.accepted', inv.id::text);
  return new;
end $$;
create trigger trg_10_handle_new_user after insert on public.auth_user for each row execute function app.handle_new_user();

create function app.sync_profile_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.profiles set email = new.email where id = new.id; return new; end $$;
create trigger trg_20_sync_profile_email after update of email on public.auth_user for each row execute function app.sync_profile_email();

-- ---- Row Level Security. The Super Admin sees accounts and invitations only: NO policy gives admin photos, albums, GPS or Trash.
alter table public.profiles enable row level security;       alter table public.invitations enable row level security;
alter table public.photos enable row level security;         alter table public.photo_locations enable row level security;
alter table public.photo_variants enable row level security; alter table public.albums enable row level security;
alter table public.album_photos enable row level security;   alter table public.album_members enable row level security;
alter table public.favorites enable row level security;      alter table public.share_links enable row level security;
alter table public.upload_reservations enable row level security; alter table public.audit_logs enable row level security;
alter table public.signup_grants enable row level security;  alter table public.app_settings enable row level security;   -- no policies: closed to album_app

create policy profiles_select on public.profiles for select using (id = app.uid() or app.is_super_admin());
create policy profiles_update_self on public.profiles for update using (id = app.uid());
create policy profiles_update_admin on public.profiles for update using (app.is_super_admin());
create policy invitations_admin on public.invitations for all using (app.is_super_admin()) with check (app.is_super_admin());
create policy photos_owner on public.photos for select using (owner_id = app.uid() and app.is_active_member());
create policy photos_shared_read on public.photos for select using (deleted_at is null and exists (select 1 from public.album_photos ap where ap.photo_id = photos.id and app.can_view_album(ap.album_id)));
create policy locations_owner on public.photo_locations for select using (exists (select 1 from public.photos p where p.id = photo_id and p.owner_id = app.uid()));
create policy variants_read on public.photo_variants for select using (exists (select 1 from public.photos p where p.id = photo_id and (p.owner_id = app.uid() or (p.deleted_at is null and exists (select 1 from public.album_photos ap where ap.photo_id = p.id and app.can_view_album(ap.album_id))))));
create policy albums_read on public.albums for select using (owner_id = app.uid() or app.can_view_album(id));
create policy albums_insert on public.albums for insert with check (owner_id = app.uid() and app.is_active_member());
create policy albums_update on public.albums for update using ((owner_id = app.uid() and app.is_active_member()) or app.can_edit_album(id)) with check (owner_id = (select a.owner_id from public.albums a where a.id = albums.id));
create policy album_photos_read on public.album_photos for select using (app.can_view_album(album_id));
create policy album_photos_write on public.album_photos for all using (app.owns_album(album_id)) with check (app.owns_album(album_id));   -- only the owner adds or removes photos
create policy members_read on public.album_members for select using (user_id = app.uid() or app.owns_album(album_id));
create policy members_owner_write on public.album_members for all using (app.owns_album(album_id)) with check (app.owns_album(album_id));
create policy favorites_own on public.favorites for all using (user_id = app.uid()) with check (user_id = app.uid());
create policy links_owner on public.share_links for all using (app.owns_album(album_id)) with check (app.owns_album(album_id));
create policy reservations_own on public.upload_reservations for select using (user_id = app.uid());
create policy audit_admin on public.audit_logs for select using (app.is_super_admin());
