-- Run ONCE as the PostgreSQL superuser:
--   psql -U postgres -v owner_pw=... -v app_pw=... -v svc_pw=... -f db/setup.sql
-- album_owner : owns the tables, runs migrations
-- album_app   : runtime role for the API and Better Auth (Row Level Security applies)
-- album_service : runtime role for server-only operations (uploads, purge, signup grants)
\set ON_ERROR_STOP on
select format('create role album_owner login password %L', :'owner_pw') where not exists (select from pg_roles where rolname = 'album_owner') \gexec
select format('create role album_app login password %L nosuperuser nobypassrls', :'app_pw') where not exists (select from pg_roles where rolname = 'album_app') \gexec
select format('create role album_service login password %L nosuperuser nobypassrls', :'svc_pw') where not exists (select from pg_roles where rolname = 'album_service') \gexec
select 'create database album owner album_owner' where not exists (select from pg_database where datname = 'album') \gexec
revoke connect on database album from public;
grant connect on database album to album_app, album_service;
\c album
grant usage on schema public to album_app, album_service;
\echo 'Done. Next: copy db/.env.example to db/.env, then run: bash db/migrate.sh'
