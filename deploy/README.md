# Running ejaBashkohu on your own server

What runs on the server: the Django backend, Redis, and Caddy (HTTPS with
automatic certificates). The database stays at Supabase; the web app stays on
Cloudflare Pages.

## 1. Server
- Any Linux VPS with 1 GB RAM or more (Ubuntu 24.04 recommended), ports 80 and 443 open.
- Install Docker: `curl -fsSL https://get.docker.com | sh`
- DNS: an **A record** `api.ejabashkohu.com` → the server's IP address.

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

## 3. Start and check (nothing changes for users yet)
```bash
docker compose up -d --build
docker compose run --rm backend python manage.py preflight
curl https://api.ejabashkohu.com/health      # -> ok
```
`preflight` should say OK everywhere; "schema stage: before the switch" is expected.

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

## Day to day
- Update: `git pull && docker compose up -d --build` (run `docker compose run --rm backend python manage.py migrate` only when a release says so).
- Logs: `docker compose logs -f backend`
- Back up the `storage` volume (profile photos) together with database backups.
- Undo the switch (only right after it): restore `deploy/backups/<file>.dump` with
  `pg_restore --clean` and redeploy the previous web app.
