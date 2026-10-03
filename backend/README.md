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

## How it keeps behaviour identical

- **Every request runs as the signed-in user.** Django sets the same request
  settings Supabase's API set (`request.jwt.claims`) and switches to the
  `authenticated` / `anon` role inside a transaction. `auth.uid()`, every
  row-level policy, the Basic/Premium rules, Wednesday matching and all
  admin functions in the database work exactly as before (`core/db.py`).
- **Accounts stay in `auth.users`** with the same ids, emails and bcrypt
  hashes. Passwords are checked and hashed inside Postgres with `pgcrypto`
  (same `$2a$` format), so existing users sign in unchanged and the profile
  trigger keeps firing (`core/accounts.py`).
- **Email links and Google/Apple** return to the app with the session in the
  URL fragment (`#access_token=…&type=signup|recovery`) or `#error_code=otp_expired`,
  the format the app already handles (`core/views_auth.py`).
- **Live updates:** a trigger on every table in the `supabase_realtime`
  publication sends `NOTIFY realtime`; one backend process (Redis lock)
  forwards it to Channels groups; each subscriber's row is re-read as that
  user before sending, so people only receive rows they may see (`core/realtime.py`).
- **Jobs:** the database queues work in `backend.jobs` (the old
  `net.http_post` calls to Edge Functions are rewritten to do this); the
  worker sends emails and deletes accounts (`core/jobs.py`).

Database pieces for all of this: migration
`../hajde/supabase/migrations/20261004000000_django_backend.sql`.

## Run locally

Needs Python 3.12+, PostgreSQL, Redis.

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env               # adjust DB_* if needed
dev/rebuild_db.sh                  # local DB: Supabase-like bootstrap + schema + all migrations + seed
python manage.py serve             # http://localhost:8000  (HTTP + websockets + jobs)
```

Seed accounts (local only): `support@ejabashkohu.com` (admin) and
`<first>.<last>@gmail.com`, password `Test1234!`.

Web app: in `../hajde/.env` set `VITE_API_URL=http://localhost:8000`, then `npm run dev`.

## Tests

`dev/run_all_tests.sh` rebuilds the dev database and runs everything against
the real stack (needs the web app served on :5173):

| Suite | Checks |
|---|---|
| `dev/e2e_backend.py` | sign-up + confirmation email, login, refresh rotation, logout, password reset, existing bcrypt accounts, row rules, admin guards, storage rules + signed URLs, strike emails + 3rd-strike deletion, email-domain check, Google sign-in (fake Google) |
| `dev/e2e_realtime.mjs` | live delivery, filters, per-user row permission, token changes |
| `dev/e2e_app/s1_accounts.mjs` | browser: sign-up, confirmation link, onboarding, photo upload (compressed), password field, Google onboarding, reset |
| `dev/e2e_app/s2_tables.mjs` | browser: Basic city lock, browse modes, create table, live arrival, join → approve → €2 seat, notifications language, share links (signed out / other city), monthly limit, sports filters, WhatsApp, startup requests |
| `dev/e2e_app/s3_lessons_plans_admin.mjs` | browser: teacher applies → admin approves → book → accept → confirm → video room, Premium order → paid → all cities, admin grant/revoke, Wednesday Premium-first groups, admin console + CSV |

## Switching production from Supabase to this backend

1. Apply the database migrations that are not live yet (check with
   `../hajde/supabase/check-migrations.sql`), including
   `20261004000000_django_backend.sql`. Apply that last one **at the switch**:
   from then on bans and join-request emails are queued for this backend's worker.
2. Deploy this backend (any host that runs a long-lived Python process, plus
   Redis and a persistent volume for `STORAGE_ROOT`). Environment: see
   `.env.example`; `DB_*` from Supabase → Database → connection string (user
   `postgres`, direct or session pooler).
3. Copy profile photos once:
   `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python manage.py import_supabase_avatars`
4. Google/Apple: set the redirect URI to `<API_URL>/auth/v1/callback` in the
   provider consoles and fill `GOOGLE_*` / `APPLE_*`.
5. Build the web app with `VITE_API_URL=<API_URL>` and deploy it
   (`--branch production`). Users stay signed out once (sessions are new) and
   sign in with their existing passwords.
