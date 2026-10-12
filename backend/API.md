# ejaBashkohu API — guide for the mobile apps

Base URL: `https://api.ejabashkohu.com` (locally `http://localhost:8000`).
Full reference, generated from the code: **[API_REFERENCE.md](API_REFERENCE.md)**
(every endpoint, server function with arguments and results, access rules per
table, realtime protocol), **`/api/docs`** (readable) and
**`/api/openapi.json`** = [openapi.yaml](openapi.yaml) (OpenAPI 3.1, usable with code generators such as
openapi-generator or Swift OpenAPI Generator). This page explains how the
pieces fit together.

The web app talks to exactly the same endpoints. They keep the request and
response shapes of Supabase (Auth, PostgREST, Storage, Realtime), so a
Supabase client library can be pointed at this server for auth, functions and
storage; only table queries (`/rest/v1/query`) and the websocket protocol are
our own.

## 1. Accounts and sessions

All requests are JSON. When signed in, send

```
Authorization: Bearer <access_token>
```

A **session** is `{access_token, token_type: "bearer", expires_in, expires_at, refresh_token, user}`.
The access token is a JWT valid for 1 hour (`expires_at` = unix seconds); the
refresh token is valid for 30 days and **single-use**.

| Step | Request |
|---|---|
| Sign up | `POST /auth/v1/signup` `{email, password, options: {data: {first_name, last_name, age}, emailRedirectTo}}` → `{user, session: null}` and a confirmation email |
| Confirm email | the link opens `/auth/v1/verify?...` in a browser, which redirects to `emailRedirectTo` with the session in the URL fragment (see 1.2) |
| Sign in | `POST /auth/v1/token?grant_type=password` `{email, password}` → session |
| Refresh | `POST /auth/v1/token?grant_type=refresh_token` `{refresh_token}` → **new** session (store the new refresh token; the old one stops working) |
| Who am I | `GET /auth/v1/user` → user (`user_metadata`, `app_metadata.provider`, `identities`) |
| Change password / metadata | `PUT /auth/v1/user` `{password}` or `{data: {...}}` |
| Forgot password | `POST /auth/v1/recover` `{email, redirect_to}` → email with a link (same redirect flow, `type=recovery`; then `PUT /auth/v1/user {password}`) |
| Resend confirmation | `POST /auth/v1/resend` `{type: "signup", email, options: {emailRedirectTo}}` |
| Sign out | `POST /auth/v1/logout` (revokes all refresh tokens of the account) |
| Enabled methods | `GET /auth/v1/settings` → `{external: {email, google, apple}}` |

Errors: `{message, msg, code, error}` with HTTP 400/401/403/422/429, e.g.
`invalid_credentials`, `email_not_confirmed`, `user_banned`,
`refresh_token_not_found`, `user_already_exists`, `bad_jwt`,
`over_request_rate_limit` (auth endpoints are limited per IP: 20/min, 5/min
for recover/resend).

### 1.1 Keeping the session alive

- Refresh shortly before `expires_at` (e.g. 60 s before) and whenever a call
  returns **401** with `JWT expired`; then retry the call once.
- Refresh tokens rotate: if two refreshes race, the second one fails with
  `refresh_token_not_found`. Serialize refreshes in one place of the app.
- A failed refresh (400) means signed out: show the sign-in screen.
- Store the refresh token in the Keychain / Android Keystore, never in plain
  preferences.

### 1.2 Links and Google / Apple sign-in on mobile

Email links and social sign-in end with a redirect to your app carrying the
session in the fragment:

```
<redirect>#access_token=…&refresh_token=…&expires_in=3600&expires_at=…&token_type=bearer&type=signup|recovery
<redirect>#error=access_denied&error_code=otp_expired&error_description=…
```

- Use a deep link / universal link as `redirect_to` / `emailRedirectTo`, e.g.
  `ejabashkohu://auth` or `https://ejabashkohu.com/app-auth`. **It must be listed
  in the server's `AUTH_REDIRECT_ALLOWLIST`** (comma-separated), otherwise the
  server falls back to the web app (`SITE_URL`).
- Google / Apple: open
  `GET /auth/v1/authorize?provider=google|apple&redirect_to=ejabashkohu://auth`
  in `ASWebAuthenticationSession` (iOS) or a Custom Tab (Android), not in a
  WebView (Google blocks WebViews). Parse the fragment of the final redirect.
- New accounts (also via Google/Apple) must finish onboarding before they can
  create or join anything: `rpc/complete_onboarding`.

## 2. Server functions (`/rest/v1/rpc/<name>`)

Everything with business rules (joining tables, booking lessons, plans,
Wednesday dinners, admin actions) is a server function:

```
POST /rest/v1/rpc/request_join
Authorization: Bearer …
{"p_table": "5d0c…"}
→ 200 {"data": "<request id>"}
```

- Arguments are named (`p_…`) exactly as in `/api/docs`, which lists every
  function with its argument types, which ones are optional and whether it can
  be called signed out ("works signed out"). Unknown or missing arguments give
  404 `PGRST202`.
- Types: UUIDs and timestamps as strings (`2026-10-14T18:00:00+02:00`),
  arrays as JSON arrays.
- Errors: `{message, code, details, hint}` (HTTP 400/401/403/404). Business
  rules fail with code `P0001` and an Albanian `message` meant for the user
  (e.g. "Dhoma hapet 15 minuta para mësimit"); show it as is. `42501` = not
  allowed.

## 3. Reading and changing tables (`/rest/v1/query`)

Plain data (tables list, profiles, messages, notifications, …) is read with one
JSON request in PostgREST style; the server applies the same per-user row rules
as the web app:

```json
POST /rest/v1/query
{"table": "tables", "action": "select",
 "select": "id, title, starts_at, host:profiles!tables_host_id_fkey(id, first_name, photo_path)",
 "filters": [{"col": "city", "op": "eq", "value": "Prishtinë"},
             {"or": "status.eq.open,status.eq.full"}],
 "order": [{"col": "starts_at", "ascending": true}],
 "limit": 50}
→ {"data": [...], "count": null}
```

- `action`: select, insert, upsert, update, delete (`values`, `onConflict`,
  `returning: true` to get the written rows back). Updates and deletes need
  at least one filter.
- Filter ops: eq, neq, gt, gte, lt, lte, like, ilike, is, in, cs, cd, ov;
  `negate: true` for NOT.
- `single: true` → one object (406 `PGRST116` if not exactly one row),
  `maybeSingle: true` → object or null, `count: "exact"` → total in `count`.
- Row shapes of every table: section *Schemas → Table rows* in `/api/docs`.

## 4. Profile photos (`/storage/v1`)

- Upload: `POST /storage/v1/object/avatars/<your user id>/avatar.jpg` with the
  raw image as body, `Content-Type: image/jpeg|png|webp`, max 5 MB, header
  `x-upsert: true` to replace. Only your own folder is writable. Save the path
  (`<uid>/avatar.jpg`) in `profiles.photo_path`.
- Show photos: `POST /storage/v1/object/sign/avatars`
  `{"paths": ["<uid>/avatar.jpg", …], "expiresIn": 3600}` → `[{path, signedUrl, error}]`.
  Load `signedUrl` without an Authorization header; cache it until it expires.
  The URL may point straight at the object store (S3/R2 presigned URL) or
  redirect (302) to it — treat it as opaque and let the image loader follow it.
- Delete: `DELETE /storage/v1/object/avatars` `{"prefixes": ["<uid>/avatar.jpg"]}`.

## 5. Live updates (websocket)

```
wss://api.ejabashkohu.com/realtime/v1/websocket?token=<access_token>
```

JSON text frames:

```jsonc
// subscribe (event: "*", "INSERT", "UPDATE" or "DELETE"; filter optional)
{"type": "subscribe", "id": "s1", "table": "messages", "event": "INSERT", "filter": "table_id=eq.5d0c…"}
← {"type": "subscribed", "id": "s1"}
← {"type": "change", "id": "s1", "payload": {"schema": "public", "table": "messages",
     "eventType": "INSERT", "new": {…row…}, "old": {}, "commit_timestamp": "…"}}
{"type": "unsubscribe", "id": "s1"}
{"type": "ping"}            ← {"type": "pong"}
{"type": "auth", "token": "<new access token>"}
```

- Live tables: `tables`, `requests`, `memberships`, `messages`,
  `notifications`, `lessons`, `lesson_participants`.
- Filters: `column=op.value` with eq, neq, lt, lte, gt, gte, in (`in.(a,b)`).
- You only receive rows you are allowed to read, checked per event. A row
  that stops being visible to you (e.g. a table you were removed from) arrives
  as `DELETE`; `DELETE` events carry only the primary key in `old`.
- After every token refresh send `{"type": "auth", "token": …}` on the open
  socket. Send a ping every ~25 s; on disconnect, reconnect with backoff
  (1, 2, 5, 10 s), re-subscribe, and reload the screen's data once (events
  sent while you were offline are not replayed). Max 50 subscriptions per
  connection.

## 6. Video lessons

`rpc/get_lesson_room {p_lesson}` works from 15 minutes before an online
lesson until 30 minutes after its end, for the tutor and confirmed students.

```json
{"room": "ejaBashkohu-…", "starts_at": "…", "duration_min": 60,
 "provider": "jaas", "domain": "8x8.vc",
 "room_name": "vpaas-magic-cookie-…/ejaBashkohu-…",
 "jwt": "<participant token>", "jwt_expires_at": "…",
 "script_url": "https://8x8.vc/vpaas-magic-cookie-…/external_api.js",
 "moderator": false, "display_name": "Arta Krasniqi"}
```

Use the Jitsi Meet SDK (iOS / Android / React Native) with
`serverURL = https://<domain>`, `room = room_name` and `token = jwt`. The token
is personal (the tutor's makes them moderator); request it each time the user
enters. Without JaaS on the server, `provider` is `"jitsi"`, `jwt` is null and
`room_name` is a plain room on `domain`.

## 7. Other

- `POST /functions/v1/check-email-domain {email}` → `{valid, reason}` (MX check
  before sign-up).
- `GET /health` → `ok`.
- Times are stored in UTC; business rules use Kosovo time (Europe/Belgrade).
