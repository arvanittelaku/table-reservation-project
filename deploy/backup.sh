#!/bin/bash
# Daily database backup: pg_dump of the public + auth schemas (plain SQL, gzip)
# into deploy/backups/, keeps the last ${BACKUP_KEEP_DAYS:-14} days. With
# BACKUP_S3=1 (and the S3_* settings in .env.production) the file is also
# uploaded to the bucket under backups/ (private, signed with the backend's SigV4 client).
#   cron: 15 3 * * * cd /opt/ejabashkohu/deploy && ./backup.sh >> backups/backup.log 2>&1
# Restore: gunzip -c backups/<file>.sql.gz | psql "<connection string>"
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env.production; set +a
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="backups/db-$STAMP.sql.gz"

docker run --rm -e PGPASSWORD="$DB_PASSWORD" -e PGSSLMODE="${DB_SSLMODE:-prefer}" postgres:17-alpine \
  pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
  --schema=public --schema=auth --no-owner --no-privileges \
  | gzip -9 > "$FILE.part"
# an empty/broken dump must not replace good ones
[ "$(gzip -dc "$FILE.part" | head -c 100 | wc -c)" -gt 0 ] || { echo "backup failed: empty dump" >&2; rm -f "$FILE.part"; exit 1; }
mv "$FILE.part" "$FILE"
echo "$(date -u +%FT%TZ) wrote $FILE ($(du -h "$FILE" | cut -f1))"

if [ "${BACKUP_S3:-0}" = "1" ]; then
  docker compose run --rm -T -v "$PWD/backups:/backups:ro" backend python -c "
import sys, django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); django.setup()
from django.conf import settings
from core.s3 import S3Client
c = S3Client(settings.S3_ENDPOINT_URL, settings.S3_BUCKET, settings.S3_ACCESS_KEY_ID,
             settings.S3_SECRET_ACCESS_KEY, settings.S3_REGION)
name = sys.argv[1]
c.put_object(settings.S3_KEY_PREFIX + 'backups/' + name, open('/backups/' + name, 'rb').read(), 'application/gzip')
print('uploaded', name)
" "$(basename "$FILE")"
  # bucket copies: delete them with a lifecycle rule in the bucket (R2/Hetzner: expire prefix backups/ after N days)
fi

find backups -maxdepth 1 -name 'db-*.sql.gz' -mtime +"$((KEEP - 1))" -print -delete
