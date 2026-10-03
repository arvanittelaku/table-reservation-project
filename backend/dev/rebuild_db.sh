#!/bin/bash
# Rebuild the local development database from scratch:
#   Supabase-compatible bootstrap -> original schema -> every migration -> seed.
# Usage: backend/dev/rebuild_db.sh [dbname]   (default: ejb_dev)
set -e
DB=${1:-ejb_dev}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PGHOST=${PGHOST:-/tmp}; PGPORT=${PGPORT:-54329}; PGUSER=${PGUSER:-postgres}
P="psql -h $PGHOST -p $PGPORT -U $PGUSER -v ON_ERROR_STOP=1 -q"
# stop the backend first (it holds connections), then recreate
if [ -f "$ROOT/backend/var/server.pid" ] && kill "$(cat "$ROOT/backend/var/server.pid")" 2>/dev/null; then
  for i in $(seq 1 50); do kill -0 "$(cat "$ROOT/backend/var/server.pid")" 2>/dev/null || break; sleep 0.1; done
fi
$P -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
Q="$P -d $DB"
quiet() { grep -viE "notice|hint|wal_level|^$" || true; }
$Q -f "$ROOT/backend/dev/bootstrap.sql" 2>&1 | quiet
$Q -f "$ROOT/hajde-backend/schema.sql" 2>&1 | quiet
for f in $(ls "$ROOT"/hajde/supabase/migrations/*.sql | sort); do
  # pg_net is a Supabase extension; the bootstrap provides a stand-in.
  sed 's/create extension if not exists pg_net;//I' "$f" | $Q 2>&1 | quiet | sed "s|^|[$(basename "$f")] |"
done
$Q -f "$ROOT/backend/dev/seed.sql" 2>&1 | quiet
echo "rebuilt $DB"
