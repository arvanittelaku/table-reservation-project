# ejaBashkohu backend (Django)

Replaces Supabase's API, Auth, Storage, Realtime and Edge Functions. The web
app (`../hajde`) talks only to this backend; Postgres stays the database.

| Area | Endpoint | Replaces |
|---|---|---|
| Accounts, sessions, email links, Google/Apple | `/auth/v1/*` | Supabase Auth |
| Table queries and database functions | `/rest/v1/query`, `/rest/v1/rpc/<fn>` | PostgREST |
| Avatar upload, signed URLs | `/storage/v1/*` | Supabase Storage |
| Live updates | `ws /realtime/v1/websocket` | Supabase Realtime |
| Server functions, emails, account deletion | `/functions/v1/*` + job worker | Edge Functions, pg_net |

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

## Run locally

Needs Python 3.12+, PostgreSQL, Redis.

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env               # adjust DB_* if needed
dev/rebuild_db.sh                  # local DB: manage.py migrate + manage.py seed_dev
python manage.py serve             # http://localhost:8000  (HTTP + websockets + jobs)
```

Seed accounts (local only): `support@ejabashkohu.com` (admin) and
`<first>.<last>@gmail.com`, password `Test1234!`.

Web app: in `../hajde/.env` set `VITE_API_URL=http://localhost:8000`, then `npm run dev`.

## Tests

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

## Switching production from Supabase to this backend

Production's database is at the schema of migration `0001` (the SQL migrations
from 2026-10-03 on were never applied there; they are superseded by `0002`).

1. Back up the database.
2. Deploy this backend (a long-lived Python process, Redis, a persistent volume
   for `STORAGE_ROOT`, `pip install -r requirements.txt` incl. `bcrypt`).
   Environment: see `.env.example`; `DB_*` from Supabase → Database → connection
   string (user `postgres`).
3. At the switch:
   ```bash
   python manage.py migrate ejb 0001 --fake   # production already has this schema
   python manage.py migrate                   # 0002: new tables/columns + data; 0003: drop old SQL logic
   ```
   After `0003` Supabase's API can no longer read or write app data (RLS stays
   on with no policies); only this backend can.
4. Copy profile photos once:
   `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python manage.py import_supabase_avatars`
5. Google/Apple: set the redirect URI to `<API_URL>/auth/v1/callback` and fill `GOOGLE_*` / `APPLE_*`.
6. Build the web app with `VITE_API_URL=<API_URL>` and deploy it
   (`--branch production`). Users sign in once more with their existing passwords.
