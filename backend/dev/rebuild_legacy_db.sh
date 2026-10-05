#!/bin/bash
# Rebuild the LEGACY reference database (the old SQL implementation) used by
# dev/difftest.py to compare the Python port against the original:
#   Supabase-compatible bootstrap -> original schema -> every SQL migration -> seed.
# Usage: backend/dev/rebuild_legacy_db.sh [dbname]   (default: ejb_legacy)
set -e
DB=${1:-ejb_legacy}
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
# the interim SQL glue of the first Django version (jobs table, http_post -> jobs, realtime triggers)
$Q -f "$ROOT/backend/dev/legacy_django_backend.sql" 2>&1 | quiet
# production also has this trigger (created in the dashboard, not in a migration)
$Q -c "CREATE TRIGGER trg_email_request AFTER INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION public.email_on_request()"
$Q -f "$ROOT/backend/dev/seed.sql" 2>&1 | quiet
echo "rebuilt $DB"
