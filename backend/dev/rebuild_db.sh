#!/bin/bash
# Rebuild the local development database from scratch with Django:
#   empty database -> schemas -> `manage.py migrate` -> `manage.py seed_dev`.
# Usage: backend/dev/rebuild_db.sh [dbname]   (default: $DB_NAME or ejb_dev)
# (dev/rebuild_legacy_db.sh builds the old SQL implementation for dev/difftest.py.)
set -e
cd "$(dirname "$0")/.."
DB=${1:-${DB_NAME:-ejb_dev}}
PGHOST=${PGHOST:-/tmp}; PGPORT=${PGPORT:-54329}; PGUSER=${PGUSER:-postgres}
P="psql -h $PGHOST -p $PGPORT -U $PGUSER -v ON_ERROR_STOP=1 -q"
# stop the backend first (it holds connections), then recreate
if [ -f var/server.pid ] && kill "$(cat var/server.pid)" 2>/dev/null; then
  for i in $(seq 1 50); do kill -0 "$(cat var/server.pid)" 2>/dev/null || break; sleep 0.1; done
fi
$P -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
# what Supabase provides around the app's tables: the auth schema (accounts live
# in auth.users), and pgcrypto (password fallback when the bcrypt package is missing)
$P -d "$DB" -c "CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;"
export DB_NAME=$DB MSGPACK_PUREPYTHON=1
python3 manage.py migrate --verbosity 0
DEBUG=1 python3 manage.py seed_dev
echo "rebuilt $DB"
