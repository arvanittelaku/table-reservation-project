# ejaBashkohu backend (Django)

Replaces Supabase's API, Auth, Storage, Realtime and Edge Functions. The web
app (`../hajde`) talks only to this backend; Postgres stays the database.

| Area | Endpoint | Replaces |
|---|---|---|
| Accounts, sessions, email links, Google/Apple | `/auth/v1/*` | Supabase Auth |
| Table queries and database functions | `/rest/v1/query`, `/rest/v1/rpc/<fn>` | PostgREST |
| Avatar upload, signed URLs | `/storage/v1/*` (local folder or S3/R2) | Supabase Storage |
| Live updates | `ws /realtime/v1/websocket` | Supabase Realtime |
| Server functions, emails, account deletion | `/functions/v1/*` + job worker | Edge Functions, pg_net |
| API reference for the mobile apps | `/api/docs`, `/api/openapi.json`, [`API.md`](API.md) | — |
| Database admin (Django staff users) | `/django-admin/` | Supabase dashboard |

## How it is built

Everything the database used to do in SQL now runs in Python (`ejb/`); Postgres
only stores data. `MIGRATION_CHECKLIST.md` maps every old SQL function, trigger
and policy to its Python replacement.

- **Schema:** Django models and migrations (`ejb/models.py`, `ejb/migrations/`).
  `0001` is production's current schema, `0002` adds everything since (tables,
  columns, reference rows, backfills), `0003` removes the old SQL functions,
  triggers and policies.
- **Server functions** (`/rest/v1/rpc/<name>`): `ejb/services/*.py`, same
  names, arguments, results and error messages as the SQL functions.
- **Access rules** (who reads/writes which rows): `ejb/policies.py`, applied by
  the query engine `ejb/query.py` (ORM, no SQL generation).
- **Triggers:** model hooks in `ejb/hooks.py` (run on every `save()`/`delete()`).
- **Accounts** stay in `auth.users` with the same ids and bcrypt hashes
  (`core/accounts.py`, `core/passwords.py`); existing users sign in unchanged.
- **Live updates:** each change is sent to Channels groups after commit; every
  subscriber's row is re-checked with their own access rules (`core/realtime.py`).
- **Jobs and schedule:** emails, account deletion and the hourly Wednesday
  grouping run in the server's background tasks (`core/jobs.py`, `core/realtime.py`).
- **Files:** `core/storage.py`, `STORAGE_BACKEND=local` (folder `STORAGE_ROOT`) or
  `s3` (any S3-compatible bucket: Cloudflare R2, Hetzner, AWS, MinIO) through a
  small client (`core/s3.py`) and our own SigV4 signing (`core/sigv4.py`, checked
  against AWS's test vectors). With S3, signed URLs are presigned GET URLs of the
  bucket (`S3_SIGNED_URL_MODE=presigned`, default); alternatively an API URL that
  redirects to one (`redirect`) or streams the file (`proxy`).
- **Video lessons:** `core/jitsi.py`, chosen by `VIDEO_PROVIDER`. `jaas`: 8x8 JaaS room
  (`8x8.vc`, `<appId>/<room>`) and a per-participant RS256 JWT; `jitsi`: own server
  (deploy/jitsi/) with an HS256 JWT (aud/iss/sub/room). Tutor = moderator, token valid
  until the room closes (lesson end + 30 min). Neither configured: plain room on
  `JITSI_DOMAIN` (meet.jit.si, dev only), `jwt` null. Tests: `dev/test_video_tokens.py`.
- **Django admin:** `/django-admin/` (`core/admin_site.py`, `ejb/admin.py`). Sign-in
  with Django's own staff users (`public.auth_user`, create one with
  `python manage.py createsuperuser`); app accounts (`auth.users`) cannot sign in
  there. Staff users are managed under *Authentication* in the admin. Rows are
  read-only (accounts, payments, subscriptions, audit log never change here); bans, Premium, reports, tables, orders,
  tutors, plans and restaurants change through the same server functions as the
  app's admin console (audit log, notifications, live updates included). Those
  actions run as the app admin account with the **same email** as the staff
  user (`core/admin_auth.py`); without such an active app admin they are refused.
- **API docs:** `API.md` (guide), `API_REFERENCE.md` and `openapi.yaml`
  (generated: `python3 dev/gen_api_docs.py`; a unit test fails when they are stale).

## Run locally

Needs Python 3.12+, PostgreSQL, Redis.

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env       # the one project-wide .env (repo root); adjust DB_* if needed
dev/rebuild_db.sh                  # local DB: manage.py migrate + manage.py seed_dev
python manage.py serve             # http://localhost:8000  (HTTP + websockets + jobs)
```

Seed accounts (local only): `support@ejabashkohu.com` (admin) and
`<first>.<last>@gmail.com`, password `Test1234!`.

Web app: `VITE_API_URL=http://localhost:8000` is already in the same root `.env`; run `npm run dev` in `hajde/`.

### Configuration added for production

| Variable | What |
|---|---|
| `VIDEO_PROVIDER` | `jaas`, `jitsi` (own server, HS256) or `public`; empty = auto (see `core/jitsi.py`). Explicit but incomplete: rooms refuse with 503 |
| `JAAS_APP_ID`, `JAAS_API_KEY_ID` (old name `JAAS_KEY_ID`), `JAAS_PRIVATE_KEY` (or `JAAS_PRIVATE_KEY_FILE`) | 8x8 JaaS video rooms (jaas.8x8.vc → API Keys) |
| `JITSI_APP_ID`, `JITSI_APP_SECRET` | own Jitsi (deploy/jitsi/) JWT issuer and HS256 secret |
| `JAAS_DOMAIN` | default `8x8.vc` |
| `JITSI_DOMAIN` | self-hosted Jitsi without JaaS (default `meet.jit.si`: calls end after ~5 min, dev only) |
| `STORAGE_BACKEND` | `local` (default) or `s3` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | S3 bucket (R2: `https://<account>.r2.cloudflarestorage.com`, region `auto`) |
| `S3_KEY_PREFIX`, `S3_SIGNED_URL_MODE` (`presigned` default / `redirect` / `proxy`), `S3_PRESIGN_TTL` | optional |
| `CSRF_TRUSTED_ORIGINS` | Django admin forms behind HTTPS (default `API_URL`) |
| `ADMIN_SESSION_AGE` | admin session length in seconds (default 8 h) |

Moving existing photos from the local folder to S3: set the `S3_*` variables and
`STORAGE_BACKEND=s3`, run `python manage.py copy_storage_to_s3`, restart.

## Tests

- `python3 -m unittest discover -s core/tests -t .` (from `backend/`): SigV4 against
  the AWS test suite (38 cases × header/query) and AWS's S3 examples; S3 storage,
  presigned URLs and `import_supabase_avatars` against `dev/fake_s3.py`; JaaS JWTs
  decoded with a test key pair; Django admin sign-in, pages, actions, CSRF;
  OpenAPI document. Uses the dev DB inside rolled-back transactions.
- `dev/difftest.py`: runs every server function and direct table rule twice on
  the same data, once through the old SQL implementation and once through
  Python, and compares results and every row changed (130 cases). Needs the
  legacy reference DB: `dev/rebuild_legacy_db.sh` (builds `ejb_legacy`).
- `dev/run_all_tests.sh`: rebuilds the dev DB with Django and runs the
  end-to-end suites against the real stack (browser suites need the web app
  served on :5173):

| Suite | Checks |
|---|---|
| `dev/e2e_backend.py` | sign-up + confirmation email, login, refresh rotation, logout, password reset, existing bcrypt accounts, row rules, admin guards, storage rules + signed URLs, strike emails + 3rd-strike deletion, email-domain check, Google sign-in (fake Google) |
| `dev/e2e_realtime.mjs` | live delivery, filters, per-user row permission, token changes |
| `dev/e2e_app/s1_accounts.mjs` | browser: sign-up, confirmation link, onboarding, photo upload, Google onboarding, reset |
| `dev/e2e_app/s2_tables.mjs` | browser: Basic city lock, browse, create table, live arrival, join → approve → seat, notifications, share links, limits, sports |
| `dev/e2e_app/s3_lessons_plans_admin.mjs` | browser: lessons, Premium orders, admin grant/revoke, Wednesday groups, admin console |
| `dev/e2e_app/r4_video_room.mjs` | browser: lesson video room, self-hosted Jitsi and 8x8 JaaS (JWT to the External API, hang-up back to the app, camera/fatal errors, script fallback) |
| `dev/e2e_backend_s3.sh` | `e2e_backend.py` against a second server with `STORAGE_BACKEND=s3` (fake S3) |
| `dev/test_s3_signing.py` | SigV4 presigned URL vs the AWS docs example (AKIAIOSFODNN7EXAMPLE), then the storage endpoints against a signature-checking fake S3 on a spare port |

## Switching production from Supabase to this backend

Production's database is at the schema of migration `0001` (the SQL migrations
from 2026-10-03 on were never applied there; they are superseded by `0002`).

1. Back up the database.
2. Deploy this backend (a long-lived Python process, Redis, a persistent volume
   for `STORAGE_ROOT`, `pip install -r requirements.txt` incl. `bcrypt`).
   Environment: see `.env.example` in the repo root; `DB_*` from Supabase → Database → connection
   string (user `postgres`).
3. At the switch:
   ```bash
   python manage.py migrate ejb 0001 --fake   # production already has this schema
   python manage.py migrate                   # 0002: new tables/columns + data; 0003: drop old SQL logic
   ```
   After `0003` Supabase's API can no longer read or write app data (RLS stays
   on with no policies); only this backend can. The same `migrate` also creates
   the Django admin tables (`auth_*`, `django_*`, from Django's own apps) and runs
   `0004`, which turns RLS on for them and revokes Supabase's `anon` /
   `authenticated` grants. **A server that was switched before this release:**
   run `python manage.py migrate` once (adds only those tables).
4. Copy profile photos once:
   `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python manage.py import_supabase_avatars`
5. Google/Apple: set the redirect URI to `<API_URL>/auth/v1/callback` and fill `GOOGLE_*` / `APPLE_*`.
   Video: fill `JAAS_*`. Photos on R2/Hetzner: `STORAGE_BACKEND=s3` + `S3_*` before step 4
   (the import then writes straight into the bucket).
6. Build the web app with `VITE_API_URL=<API_URL>` and deploy it
   (`--branch production`). Users sign in once more with their existing passwords.
