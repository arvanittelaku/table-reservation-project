# Running ejaBashkohu on your own server

What runs on the server: the Django backend, Redis, Caddy (HTTPS with
automatic certificates). Video lessons use 8x8 JaaS or an optional self-hosted
Jitsi Meet (`jitsi/`, separate stack, see "Video lessons" below). The database stays at
Supabase; the web app stays on Cloudflare Pages.

## 1. Server
- A Linux VPS (Ubuntu 24.04 recommended), ports 80 and 443 TCP open
  (`ufw allow 80,443/tcp`, plus the provider's cloud firewall). Backend alone: 1 GB is enough.
- Install Docker: `curl -fsSL https://get.docker.com | sh`
- DNS: **A record** `api.ejabashkohu.com` → the server's IP address.

## 2. Configure
```bash
git clone <this repo> && cd <repo>/deploy
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production                        # secrets, database, SMTP, Google
echo "API_DOMAIN=api.ejabashkohu.com" > .env
```
- **Database:** Supabase → Project Settings → Database → Connection string →
  *Session pooler* (host, user `postgres.upxxfhvgbmddhyebaiug`, password).
- **Email:** a Gmail account with an app password (or any SMTP service).
- **Google sign-in:** in Google Cloud Console set the redirect URI to
  `https://api.ejabashkohu.com/auth/v1/callback`.
- **Video lessons:** set `VIDEO_PROVIDER` and the keys, see [Video lessons](#video-lessons).
- **Profile photos on object storage (optional, instead of the `storage` volume):**
  Cloudflare R2 → create a private bucket (e.g. `ejabashkohu-avatars`) → *Manage R2
  API tokens* → token with *Object Read & Write* on that bucket. Set
  `STORAGE_BACKEND=s3`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`.
  Hetzner Object Storage works the same (`https://fsn1.your-objectstorage.com`,
  region `fsn1`). No CORS setup is needed: the app loads photos as images.

## 3. Start and check (nothing changes for users yet)
```bash
docker compose up -d --build
docker compose run --rm backend python manage.py preflight
curl https://api.ejabashkohu.com/health      # -> ok
```
`preflight` should say OK everywhere; "schema stage: before the switch" is expected.
It also checks that the storage (folder or bucket) is writable and that the JaaS key can sign.

## 4. Switch (a few minutes of downtime)
```bash
SUPABASE_SERVICE_KEY=<Supabase -> Settings -> API -> service_role key> ./switch.sh
```
It backs up the database to `deploy/backups/`, upgrades it, removes the old
SQL logic, restarts the backend and copies the profile photos.

## 5. Deploy the web app right after
On your computer, in `hajde/`:
```bash
echo "VITE_API_URL=https://api.ejabashkohu.com" > .env.production.local
echo "VITE_SUPPORT_WHATSAPP=<support number, digits only>" >> .env.production.local
npm run build && npx wrangler pages deploy dist --branch production
```
Users sign in again once, with their existing passwords.

## Admin and API docs
- Database admin: `https://api.ejabashkohu.com/django-admin/` — sign in with a
  Django staff user (separate from app accounts). Create one once:
  `docker compose run --rm backend python manage.py createsuperuser`, and give it the
  **same email as your app admin account** so the actions below can run as you. Everything is visible;
  bans, Premium, reports, tables, orders, tutors, plans and restaurants are changed
  with the actions in each list (they run the same checks and send the same
  notifications as the app's admin console).
- API reference for the mobile team: `https://api.ejabashkohu.com/api/docs`
  (OpenAPI file: `/api/openapi.json`, guide: `backend/API.md`, generated reference: `backend/API_REFERENCE.md`, `backend/openapi.yaml`). For app sign-in
  links add the app's deep link (e.g. `ejabashkohu://auth`) to `AUTH_REDIRECT_ALLOWLIST`.

## Day to day
- Update: `git pull && docker compose up -d --build` (run `docker compose run --rm backend python manage.py migrate` only when a release says so).
  **This release (Django admin) says so if the switch already happened:** run `migrate` once;
  it adds the admin tables and locks them like the others (`switch.sh` does it by itself).
- Moving photos from the volume to R2 later: add the `S3_*` settings with
  `STORAGE_BACKEND=s3`, then `docker compose run --rm backend python manage.py copy_storage_to_s3`
  and `docker compose up -d`.
- Logs: `docker compose logs -f backend`
- Back up the `storage` volume (profile photos) together with database backups
  (with `STORAGE_BACKEND=s3` the photos are in the bucket instead).
- Database backups: `deploy/backup.sh` dumps the `public` and `auth` schemas
  (`pg_dump` in a `postgres:17-alpine` container) to `deploy/backups/db-<time>.sql.gz`
  and keeps 14 days (`BACKUP_KEEP_DAYS`). With `BACKUP_S3=1` in `.env.production` it also
  uploads each file to the S3 bucket under `backups/` (add a lifecycle rule there to expire
  old ones). Daily at 03:15 via `crontab -e` (adjust the path):
  ```
  15 3 * * * cd /opt/ejabashkohu/deploy && ./backup.sh >> backups/backup.log 2>&1
  ```
  Restore: `gunzip -c backups/<file>.sql.gz | psql "<connection string>"`.
- Admin CSS/JS: the backend copies them (`collectstatic`) into the `static` volume at every
  start and Caddy serves `/django-admin/static/` from it.
- Undo the switch (only right after it): restore `deploy/backups/<file>.dump` with
  `pg_restore --clean` and redeploy the previous web app.

## Video lessons
The app embeds the room with the Jitsi IFrame API (`external_api.js` from the provider's
domain). `get_lesson_room` only answers the tutor and confirmed students, from 15 minutes
before the start until 30 minutes after the end, and hands each of them their own signed
JWT for that one room: tutor = moderator, students = participants, expiry = lesson end +
30 min, name and photo in the token, recording / streaming / transcription off.

**Do not use the public meet.jit.si in production** (that is what happens when
`VIDEO_PROVIDER` is empty and no keys are set; `preflight` reports it): embedded
meet.jit.si calls are cut after 5 minutes (since May 2023), the first participant must sign
in with Google/GitHub/Facebook (since 2023), and since 9 Oct 2026 every meet.jit.si meeting
ends at 95 minutes.

### Option A: 8x8 JaaS (simplest, recommended to start)
No server to run. Pricing (checked Oct 2026, jaas.8x8.vc): free *Developer* plan with 25
monthly active users (MAU), then Basic 300 MAU $99/month, Standard 1.5K MAU $499/month,
$0.99 per extra MAU. Every tutor/student who joins a call in a month counts as one MAU, so
the free plan only fits testing / a handful of lessons.
1. Sign up at https://jaas.8x8.vc, then *API Keys* → *Add API key* → *Generate API key pair*
   and download the private key (`.pk`, shown only once).
2. In `.env.production`: `VIDEO_PROVIDER=jaas`, `JAAS_APP_ID=vpaas-magic-cookie-…`,
   `JAAS_API_KEY_ID=` the key id shown next to the key (`vpaas-magic-cookie-…/abc123`), and
   `JAAS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----"`
   (one line, newlines as `\n`; or mount the file and set `JAAS_PRIVATE_KEY_FILE`).
3. `docker compose run --rm backend python manage.py preflight` shows
   `video lessons (8x8 JaaS, JWT RS256)` OK. Rooms run at `https://8x8.vc/<appId>/<room>`.

### Option B: own Jitsi server (`jitsi/`, no per-user cost)
Official `jitsi/web`, `prosody`, `jicofo`, `jvb` images with JWT auth (`AUTH_TYPE=jwt`,
guests off, no welcome page, no recording). Use a **separate VPS with 4 GB+ RAM / 2+ vCPU**
(the video bridge forwards every stream: plan ~1 Mbit/s up+down per participant; ~10
parallel group lessons want 4 vCPU / 8 GB). Ports **80, 443 TCP and 10000 UDP** open.
1. DNS: A record `meet.ejabashkohu.com` → the Jitsi server (plain DNS, not proxied).
2. On that server:
   ```bash
   cd deploy/jitsi && cp .env.example .env && chmod 600 .env
   nano .env      # JITSI_DOMAIN, JITSI_APP_SECRET=$(openssl rand -hex 32), JITSI_PUBLIC_IP,
                  # LETSENCRYPT_EMAIL, JICOFO_AUTH_PASSWORD / JVB_AUTH_PASSWORD (openssl rand -hex 16)
   ufw allow 80,443/tcp && ufw allow 10000/udp
   docker compose up -d
   ```
3. In the backend's `.env.production`: `VIDEO_PROVIDER=jitsi` and the same `JITSI_DOMAIN`,
   `JITSI_APP_ID`, `JITSI_APP_SECRET`. Restart the backend; preflight shows
   `video lessons (own Jitsi, JWT HS256)` OK.
4. Check: `https://meet.ejabashkohu.com/` shows no welcome page, `…/test` without a token
   asks for authentication. Connected but no video: UDP 10000 blocked or `JITSI_PUBLIC_IP`
   wrong (`docker compose logs jvb`). Images are pinned via `JITSI_IMAGE_VERSION`; update all
   four together.
(Same host as the backend is possible only if Jitsi does not need 80/443 there, e.g. by
proxying it through Caddy yourself; the separate server is the supported setup.)

