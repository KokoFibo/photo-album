#!/usr/bin/env bash
# Applies db/migrations/*.sql in order (each file in one transaction), then db/seed.sql if present.
set -euo pipefail
cd "$(dirname "$0")/.."
PRESET="${DATABASE_ADMIN_URL:-}"   # a URL given on the command line wins over db/.env (used by the test runner)
[ -f db/.env ] && { set -a; . <(tr -d '\r' < db/.env); set +a; }
[ -n "$PRESET" ] && DATABASE_ADMIN_URL="$PRESET"
: "${DATABASE_ADMIN_URL:?Set DATABASE_ADMIN_URL in db/.env}"
run() { psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q "$@"; }
run -c "create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now());"
for f in db/migrations/*.sql; do
  v=$(basename "$f" .sql)
  if [ -z "$(run -tA -c "select 1 from public.schema_migrations where version = '$v'")" ]; then
    echo "applying $v"
    run -1 -f "$f" -c "insert into public.schema_migrations (version) values ('$v')"
  fi
done
[ -f db/seed.sql ] && [ -z "${SKIP_SEED:-}" ] && { echo "applying seed"; run -f db/seed.sql; }
echo "database is up to date"
