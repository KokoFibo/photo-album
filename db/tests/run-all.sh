#!/usr/bin/env bash
# Runs every database test in a throw-away copy of the database (album_test), so your real data never gets in the way.
# Needs db/.env and the postgres superuser password:   export PGPASSWORD=<postgres password>
set -uo pipefail
cd "$(dirname "$0")/../.."
set -a; . <(tr -d '\r' < db/.env); set +a
TEST_URL="${DATABASE_ADMIN_URL%/*}/album_test"
P() { psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

P -d postgres -c "drop database if exists album_test" -c "create database album_test owner album_owner" || { echo "could not create album_test"; exit 1; }
P -d album_test -c "revoke connect on database album_test from public" -c "grant connect on database album_test to album_app, album_service" -c "grant usage on schema public to album_app, album_service" || exit 1
DATABASE_ADMIN_URL="$TEST_URL" SKIP_SEED=1 bash db/migrate.sh > /dev/null || { echo "the migrations failed in album_test"; exit 1; }

bad=0
for f in two_accounts trash sharing admin; do
  echo "== $f"
  out=$(psql -U postgres -d album_test -v ON_ERROR_STOP=1 -q -f "db/tests/$f.sql" 2>&1)
  echo "$out" | grep -E "FAIL|ERROR|passed" | sort -u || echo "(no result lines)"
  if echo "$out" | grep -qE "FAIL|ERROR"; then bad=1; fi
done
P -d postgres -c "drop database album_test" > /dev/null 2>&1
[ $bad -eq 0 ] && echo "ALL DATABASE TESTS PASSED" || { echo "SOME DATABASE TESTS FAILED"; exit 1; }
