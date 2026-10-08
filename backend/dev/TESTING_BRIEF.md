# Brief for requirement testers

Goal: prove each assigned requirement works end to end in the real app (browser
+ Django backend + Postgres + Redis), including create / read / update / delete
of everything in your area, plus permission and error cases. Production-ready
means: works on a phone-sized screen (400x860) and desktop (1280x800), no page
errors, no failed API calls except the ones a test provokes, data really stored
(check with SQL), other users see what they should and nothing more.

## Stack (already running — do NOT rebuild the database, do NOT stop services)
- Web app: http://localhost:5173 (static build in hajde/dist, served by backend/dev/serve_app.py)
- Backend: http://localhost:8000 (restart only if you changed backend code: `backend/dev/serve.sh`)
- DB: `psql -h /tmp -p 54329 -U postgres -d ejb_dev` (seed users: <first>.<last>@gmail.com / Test1234!,
  admin support@ejabashkohu.com / Test1234!). Fake Google on :8765.
- Emails land in backend/var/mail.
- If Postgres/Redis are down: `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest_admin/data -o '-p 54329 -k /tmp' -l /tmp/pgtest_admin/log start"`, `redis-server --daemonize yes --save '' --appendonly no`.
- Rebuild the web app after frontend changes: `VITE_SUPPORT_WHATSAPP=38344123456 node backend/dev/build_app_offline.mjs` (from repo root).
- Python: `MSGPACK_PUREPYTHON=1` for manage.py.

## Writing tests
- Browser suites: backend/dev/e2e_app/<your file>.mjs using helpers in e2e_app/lib.mjs (launch, newPage,
  signIn, check, section, sql, api, token, waitMail, makeJpeg, bodyText, summary). Read s1–s3 as examples.
  Run: `cd backend/dev && node e2e_app/<file>.mjs`. End with `process.exit(summary() ? 1 : 0)`.
- Use ONLY the seed users assigned to you (other testers run at the same time on the same DB) or
  accounts you sign up yourself with unique emails. Make tests re-runnable (unique titles, cleanup or
  tolerate prior runs).
- App source: hajde/src (HajdeApp.jsx is the main screen; components/*, api/*). Albanian UI by default.
- Screenshots: save to /tmp/pgtest_admin/shots/real/<area>-*.png and LOOK at key ones (Read tool) for layout problems.

## When something is broken
- Fix it if the fix is small and clearly inside your area; use targeted Edit calls (others edit the
  same repo). Backend: ejb/services/*, core/*. Frontend: hajde/src/*. Re-run the related existing
  suites if you touch shared code. Never commit.
- If a requirement is not implemented at all or the fix is large/risky, do not build it: report it.

## Final message
Per requirement: what you tested (list of checks), result, bugs found + fixed (file + one line),
anything still failing or missing. Include the pass count of your suite.
