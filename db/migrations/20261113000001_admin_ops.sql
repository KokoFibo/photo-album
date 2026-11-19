-- Operational pages for the Super Admin. Everything here returns counts, sizes and job results only:
-- never filenames, object keys, metadata, GPS, album names or Trash contents.
create table public.job_runs (
  id bigint generated always as identity primary key, job text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, ok boolean, summary jsonb not null default '{}', error text
);
alter table public.job_runs enable row level security;   -- no policies and no grants: reached only through the functions below

create function app.record_job_run(p_job text, p_started timestamptz, p_ok boolean, p_summary jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_runs (job, started_at, finished_at, ok, summary, error) values (p_job, p_started, now(), p_ok, coalesce(p_summary, '{}'), p_error);
  delete from public.job_runs where id < (select max(id) - 200 from public.job_runs);
end $$;

create function app.admin_overview() returns table (members bigint, active bigint, inactive bigint, pending_invites bigint, used_bytes bigint, quota_bytes bigint,
  photos bigint, albums bigint, uploads_7d bigint, failed_uploads bigint) language sql stable security definer set search_path = '' as
$$ select (select count(*) from public.profiles), (select count(*) from public.profiles where status = 'active'), (select count(*) from public.profiles where status <> 'active'),
     (select count(*) from public.invitations where status = 'pending' and expires_at > now()),
     (select coalesce(sum(used_bytes), 0)::bigint from public.profiles), (select coalesce(sum(quota_bytes), 0)::bigint from public.profiles),
     (select count(*) from public.photos where status = 'ready' and deleted_at is null), (select count(*) from public.albums where deleted_at is null),
     (select count(*) from public.photos where status = 'ready' and created_at > now() - interval '7 days'),
     (select count(*) from public.photos where status = 'failed' or (status = 'pending' and created_at < now() - interval '1 hour'))
   where app.is_super_admin() $$;

create function app.admin_storage() returns table (id text, display_name text, email text, status public.member_status, used_bytes bigint, quota_bytes bigint, photos bigint)
language sql stable security definer set search_path = '' as
$$ select p.id, p.display_name, p.email, p.status, p.used_bytes, p.quota_bytes,
     (select count(*) from public.photos x where x.owner_id = p.id and x.status = 'ready' and x.deleted_at is null)
   from public.profiles p where app.is_super_admin() order by p.used_bytes desc, p.display_name $$;

create function app.admin_upload_activity(p_days int) returns table (day date, uploads bigint, bytes bigint, failed bigint)
language sql stable security definer set search_path = '' as
$$ select d::date, count(p.id) filter (where p.status = 'ready'), coalesce(sum(p.size_bytes) filter (where p.status = 'ready'), 0)::bigint,
     count(p.id) filter (where p.status = 'failed' or (p.status = 'pending' and p.created_at < now() - interval '1 hour'))
   from generate_series(current_date - (least(greatest(p_days, 1), 90) - 1), current_date, interval '1 day') d
   left join public.photos p on p.created_at::date = d::date
   where app.is_super_admin() group by d order by d $$;

create function app.admin_job_backlog() returns table (photos_due bigint, albums_due bigint, stale_uploads bigint, stale_reservations bigint, in_trash bigint)
language sql stable security definer set search_path = '' as
$$ select (select count(*) from public.photos where deleted_at is not null and purge_after <= now()),
     (select count(*) from public.albums where deleted_at is not null and purge_after <= now()),
     (select count(*) from public.photos where status in ('pending', 'failed') and created_at < now() - interval '24 hours'),
     (select count(*) from public.upload_reservations where not completed and expires_at < now()),
     (select count(*) from public.photos where deleted_at is not null)
   where app.is_super_admin() $$;

create function app.admin_job_runs(p_limit int default 30) returns table (id bigint, job text, started_at timestamptz, finished_at timestamptz, ok boolean, summary jsonb, error text)
language sql stable security definer set search_path = '' as
$$ select r.id, r.job, r.started_at, r.finished_at, r.ok, r.summary, r.error from public.job_runs r where app.is_super_admin() order by r.id desc limit least(greatest(p_limit, 1), 100) $$;

-- Platform settings (defaults for new invitations)
create function app.admin_get_settings() returns table (default_quota_gb int, invite_expiry_days int) language sql stable security definer set search_path = '' as
$$ select coalesce((select value::int from public.app_settings where key = 'default_quota_gb'), 20), coalesce((select value::int from public.app_settings where key = 'invite_expiry_days'), 7)
   where app.is_super_admin() $$;
create function app.admin_set_settings(p_quota int, p_days int) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Not allowed'; end if;
  if p_quota not between 1 and 1000 then raise exception 'The default quota must be between 1 and 1000 GB'; end if;
  if p_days not between 1 and 30 then raise exception 'Invitations must expire within 1 to 30 days'; end if;
  insert into public.app_settings (key, value) values ('default_quota_gb', p_quota::text), ('invite_expiry_days', p_days::text) on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor_id, action, target) values (app.uid(), 'settings.updated', 'defaults');
end $$;

revoke all on function app.record_job_run(text, timestamptz, boolean, jsonb, text), app.admin_overview(), app.admin_storage(), app.admin_upload_activity(int),
  app.admin_job_backlog(), app.admin_job_runs(int), app.admin_get_settings(), app.admin_set_settings(int, int) from public;
grant execute on function app.record_job_run(text, timestamptz, boolean, jsonb, text) to album_service;
grant execute on function app.admin_overview(), app.admin_storage(), app.admin_upload_activity(int), app.admin_job_backlog(), app.admin_job_runs(int),
  app.admin_get_settings(), app.admin_set_settings(int, int) to album_app;
