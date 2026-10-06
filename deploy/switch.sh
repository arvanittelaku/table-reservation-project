#!/bin/bash
# One-time switch of production from Supabase's API to this backend.
# Run on the server, in deploy/, after `docker compose up -d --build` works
# and `preflight` says READY (except the schema stage). See deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose"
set -a; . ./.env.production; set +a

echo "== 1/6 preflight"
$DC run --rm backend python manage.py preflight || { echo "fix the FAIL lines first"; exit 1; }

echo "== 2/6 backup of the database (custom format, restore with pg_restore)"
mkdir -p backups
F="backups/before-switch-$(date +%Y%m%d-%H%M%S).dump"
docker run --rm -e PGPASSWORD="$DB_PASSWORD" postgres:17-alpine \
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner \
  -n public -n auth > "$F"
[ -s "$F" ] || { echo "backup is empty, stopping"; exit 1; }
echo "saved $F ($(du -h "$F" | cut -f1))"

read -r -p "From here the old app stops working until the new web app is deployed. Type SWITCH to continue: " a
[ "$a" = "SWITCH" ] || { echo "stopped, nothing changed"; exit 1; }

echo "== 3/6 database: record the current schema, add the new parts, remove the old SQL logic"
$DC run --rm backend python manage.py migrate ejb 0001 --fake
$DC run --rm backend python manage.py migrate

echo "== 4/6 restart the backend"
$DC up -d

echo "== 5/6 copy profile photos from Supabase Storage"
if [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
  $DC run --rm -e SUPABASE_URL=https://upxxfhvgbmddhyebaiug.supabase.co -e SUPABASE_SERVICE_KEY \
    backend python manage.py import_supabase_avatars
else
  echo "SUPABASE_SERVICE_KEY not set: run later with"
  echo "  SUPABASE_SERVICE_KEY=... $DC run --rm -e SUPABASE_URL=https://upxxfhvgbmddhyebaiug.supabase.co -e SUPABASE_SERVICE_KEY backend python manage.py import_supabase_avatars"
fi

echo "== 6/6 preflight again"
$DC run --rm backend python manage.py preflight
echo "Now deploy the web app built with VITE_API_URL=$API_URL (deploy/README.md, step 6)."
