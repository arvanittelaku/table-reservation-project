#!/bin/bash
# e2e_backend.py against a second backend on :8001 that stores files in S3
# (dev/fake_s3.py on :9010, SigV4-checked). Background jobs stay with the
# main backend on :8000 (RUN_BACKGROUND=0 here).
cd "$(dirname "$0")/.."
python3 dev/fake_s3.py --port 9010 --access e2e-access --secret e2e-secret > var/fake_s3.log 2>&1 &
S3PID=$!
RUN_BACKGROUND=0 STORAGE_BACKEND=s3 S3_ENDPOINT=http://127.0.0.1:9010 S3_BUCKET=ejb-e2e \
  S3_ACCESS_KEY_ID=e2e-access S3_SECRET_ACCESS_KEY=e2e-secret S3_REGION=auto API_URL=http://localhost:8001 \
  MSGPACK_PUREPYTHON=1 python3 manage.py serve --port 8001 > var/server_s3.log 2>&1 &
APIPID=$!
for i in $(seq 1 100); do curl -s -o /dev/null localhost:8001/health && break; sleep 0.3; done
cd dev && API=http://localhost:8001 python3 e2e_backend.py
RC=$?
STATS=$(curl -s localhost:9010/__stats)
echo "fake S3: $STATS"
kill $APIPID $S3PID 2>/dev/null
# the upload and the signed-URL download must have gone through S3
echo "$STATS" | grep -q '"put": [1-9]' && echo "$STATS" | grep -q '"presigned_get": [1-9]' || RC=1
exit $RC
