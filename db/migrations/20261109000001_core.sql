do $$ begin
  if current_setting('server_version_num')::int < 150000 then raise exception 'PostgreSQL 15 or newer is required'; end if;
  if current_setting('server_encoding') <> 'UTF8' then raise exception 'The database must use UTF8 encoding'; end if;
end $$;
alter default privileges revoke execute on functions from public;   -- functions are private until explicitly granted
create schema if not exists app;

create type public.app_role as enum ('super_admin', 'member');
create type public.member_status as enum ('active', 'suspended', 'disabled');
create type public.invite_status as enum ('pending', 'accepted', 'expired', 'revoked');
create type public.share_role as enum ('viewer', 'editor');
create type public.processing_status as enum ('pending', 'processing', 'ready', 'failed');

-- Better Auth core tables (snake_case; the API maps Better Auth's field names to these columns)
create table public.auth_user (
  id text primary key, name text not null, email text not null unique, email_verified boolean not null default false,
  image text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.auth_session (
  id text primary key, expires_at timestamptz not null, token text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  ip_address text, user_agent text, user_id text not null references public.auth_user(id) on delete cascade
);
create index auth_session_user on public.auth_session (user_id);
create table public.auth_account (
  id text primary key, account_id text not null, provider_id text not null,
  user_id text not null references public.auth_user(id) on delete cascade,
  access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index auth_account_user on public.auth_account (user_id);
create table public.auth_verification (
  id text primary key, identifier text not null, value text not null, expires_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index auth_verification_identifier on public.auth_verification (identifier);

create table public.profiles (
  id text primary key references public.auth_user(id) on delete cascade,
  email text,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_key text,
  role public.app_role not null default 'member',
  status public.member_status not null default 'active',
  quota_bytes bigint not null default 21474836480 check (quota_bytes >= 0),   -- 20 GB
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);
create index profiles_email_idx on public.profiles (lower(email));

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,                 -- sha256 hex of the raw token; the raw token is never stored
  quota_bytes bigint not null check (quota_bytes > 0),
  status public.invite_status not null default 'pending',
  invited_by text not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text references public.profiles(id) on delete set null,
  revoked_at timestamptz
);
create unique index one_pending_invite_per_email on public.invitations (lower(email)) where status = 'pending';

-- A signup is only possible after the API has validated an invitation (see app.begin_signup)
create table public.signup_grants (
  email text primary key, invitation_id uuid not null references public.invitations(id) on delete cascade, expires_at timestamptz not null
);
create table public.app_settings (key text primary key, value text not null);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.profiles(id) on delete cascade,      -- permanent owner
  filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes bigint not null check (size_bytes > 0),
  width int, height int, sha256 text,
  taken_at timestamptz,
  exif jsonb not null default '{}'::jsonb,       -- never contains GPS; see photo_locations
  status public.processing_status not null default 'pending',
  original_key text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_album_id uuid,
  purge_after timestamptz
);
create unique index photos_owner_sha on public.photos (owner_id, sha256) where sha256 is not null and deleted_at is null;
create index photos_owner_taken on public.photos (owner_id, taken_at desc) where deleted_at is null;
create index photos_purge on public.photos (purge_after) where deleted_at is not null;

create table public.photo_locations (            -- private GPS, owner-only
  photo_id uuid primary key references public.photos on delete cascade,
  latitude double precision not null, longitude double precision not null
);
create table public.photo_variants (
  photo_id uuid not null references public.photos on delete cascade,
  kind text not null check (kind in ('thumbnail', 'small', 'medium', 'large')),
  object_key text not null unique, size_bytes bigint not null,
  primary key (photo_id, kind)
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  cover_photo_id uuid references public.photos on delete set null,
  hero_photo_id uuid references public.photos on delete set null,
  cover_focal_x real not null default 0.5, cover_focal_y real not null default 0.5, overlay_strength real not null default 0.4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, purge_after timestamptz
);
alter table public.photos add foreign key (deleted_by_album_id) references public.albums(id) on delete set null;

create table public.album_photos (
  album_id uuid not null references public.albums on delete cascade,
  photo_id uuid not null references public.photos on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (album_id, photo_id)
);
create index album_photos_photo on public.album_photos (photo_id);
create table public.album_members (
  album_id uuid not null references public.albums on delete cascade,
  user_id text not null references public.profiles on delete cascade,
  role public.share_role not null default 'viewer',
  primary key (album_id, user_id)
);
create table public.favorites (
  user_id text not null references public.profiles on delete cascade,
  photo_id uuid not null references public.photos on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, photo_id)
);
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums on delete cascade,
  token_hash text not null unique, password_hash text,
  allow_download boolean not null default false,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.upload_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles on delete cascade,
  photo_id uuid,
  bytes bigint not null check (bytes > 0),
  expires_at timestamptz not null default now() + interval '1 hour',
  completed boolean not null default false
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id text, action text not null, target text, meta jsonb not null default '{}', created_at timestamptz not null default now()
);

-- Active photo count per album (excludes Trash). security_invoker keeps Row Level Security in force.
create view public.albums_with_counts with (security_invoker = true) as
select a.*, (select count(*) from public.album_photos ap join public.photos p on p.id = ap.photo_id
             where ap.album_id = a.id and p.deleted_at is null) as photo_count
from public.albums a where a.deleted_at is null;
