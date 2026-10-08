#!/bin/bash
# Full local test run against the real stack:
#   fresh dev DB -> Django backend -> fake Google -> backend, realtime and browser suites.
# Needs: Postgres (PGPORT 54329), Redis, the built app served on :5173 (see README).
cd "$(dirname "$0")"
set -o pipefail
FAIL=0
./rebuild_db.sh >/dev/null || exit 1   # Django: migrate + seed_dev
rm -rf ../var/mail ../var/storage
./serve.sh
( pgrep -f "serve_app.py" >/dev/null || nohup python3 serve_app.py >/dev/null 2>&1 & )
for p in $(pgrep -f "^python3 fake_google.py"); do kill "$p"; done
run() { echo; echo "════════ $1"; shift; "$@" 2>&1 | grep -vE "agent-proxy|connect_rejected|more$|For details|TUNNEL" ; [ "${PIPESTATUS[0]}" = 0 ] || FAIL=1; }
run "backend: auth, data, storage, jobs, Google" python3 e2e_backend.py
nohup python3 fake_google.py >/dev/null 2>&1 &
FG=$!
sleep 0.5
run "realtime (Channels + Redis)" node e2e_realtime.mjs
run "app: accounts" node e2e_app/s1_accounts.mjs
run "app: tables, live, join, share, limits, sports" node e2e_app/s2_tables.mjs
run "app: lessons, Premium, Wednesday, admin" node e2e_app/s3_lessons_plans_admin.mjs
run "requirements: admin console" node e2e_app/r1_admin.mjs
run "requirements: profile, notifications, photo, password, Google/Apple" node e2e_app/r2_profile.mjs
run "requirements: tables, sports, share links, live, Basic/Premium" node e2e_app/r3_tables.mjs
run "requirements: lessons, Premium packages, Wednesday" node e2e_app/r4_lessons_plans.mjs
kill $FG 2>/dev/null
echo; [ $FAIL = 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit $FAIL
