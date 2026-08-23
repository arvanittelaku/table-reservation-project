# Hajde! — Project Context Handoff

**Date:** 2026-08-02 (updated after notifications + live requests wiring)  
**Repo path:** `table-reservation-project/hajde/` + `table-reservation-project/hajde-backend/`  
**Purpose:** Give the next agent (Claude / Cursor) accurate context: what works, what doesn’t, and what to do next.

**Dev server:** `cd hajde && npm run dev` → http://localhost:5173/

---

## Status snapshot (current)

| Item | Status |
|------|--------|
| `hajde/.env` Vite keys | **DONE** — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` filled (anon only; never service role as `VITE_*`) |
| `schema.sql` / `storage.sql` applied | **DONE** — 16 tables, RLS, RPCs, Realtime, private `avatars` bucket |
| `profiles.user_preferences` jsonb | **DONE** |
| RPC params `p_table` / `p_request` | **DONE** — client uses these (not `table_id` / `request_id`) |
| Real UI ported | **DONE** — `hajde-web.html` → `src/HajdeApp.jsx` + `HajdeApp.css`; `main.jsx` mounts `<HajdeApp />` |
| Auth wired in UI | **DONE** — signup/signin/signout, email confirmation screen, password on step 1 |
| Tables feed from Supabase | **DONE** — `useTables` + create/join; skeleton while loading; refetch when session ready |
| Notifications wired | **DONE** — `useNotifications(authUser?.id)`, bell badge = real `unread`, open panel → `markRead()`, `pushNotif` inserts to DB |
| Live requests on open table | **DONE** — `useRequests(active, authUser?.id)`; approve/reject via hook RPCs; Realtime when sheet open |
| Notifications INSERT RLS | **DONE** — policy `notifications_insert_own` (client `pushNotif` + DB triggers) |
| Responsive shell (mobile / tablet frame / desktop sidebar) | **DONE** — `app-shell` + `app-sidebar` + `app-mobile-frame`; bottom nav/FAB hidden ≥1100px |
| Hero layout | **DONE** — full-width navy gradient, structured top/mid/bottom content, no hero SVG, clean CTA/fee/sign-in area |
| Mobile horizontal overflow | **DONE** — `min-width: 0` on the flex chain + `overflow-x: clip` containment; `.city-row` / `.cat-row` scroll internally. Verified 375px: `scrollWidth === clientWidth` |
| Auth errors in Albanian | **DONE** — `AUTH_ERRORS` map in `src/api/auth.js` for `signIn` / `signUp` / `signOut` |
| Wednesday Dinner banner gate | **DONE** — only when `tasteDone`; mutually exclusive with “Trego shijet e tua” |
| Onboarding photo step | **DONE** — face check is a warning, not a blocker; photo is kept on failure + “Vazhdo gjithsesi” fallback |
| E2E test accounts | **DONE** — confirmed, profiles ready (see below) |
| Two-account realtime E2E | **MANUAL TEST** — host opens table sheet → guest requests → host should see request + bell without refresh |
| Chat Realtime in UI | **NOT WIRED** — still local `localChat` in `HajdeApp`; hooks exist (`useChat`) |
| Avatars / photo upload in UI | **PARTIAL** — APIs/hooks exist; onboarding photo path may still be local blob |
| Payments | **STUB** — never call `confirm_paid_seat` from client |
| Edge Functions (`translate`, `notify-email`) | **NOT DEPLOYED** |

### E2E test accounts (permanent)

| Role | Email | Password | Profile |
|------|-------|----------|---------|
| Host | `host@hajde-test.com` | `HajdeTest2026!` | Test Host, 22 |
| Guest | `guest@hajde-test.com` | `HajdeTest2026!` | Test Guest, 25 |

Emails are pre-confirmed (`email_confirmed_at` set). Use these for all multi-user realtime tests.
| Auth email confirmation in Dashboard | **VERIFY MANUALLY** |

---

## Product summary

**Hajde!** — social table-sharing for Kosovo. Users open tables (cafes, pools, hikes, rides, trips); others request to join; host approves via photo/age; guests pay **€2** (rides free). Also “Darka e së Mërkurës” (Wednesday dinner with matched strangers).

Rules already encoded:
- Age **18+** in signup
- Passwords only via Supabase Auth
- **`confirm_paid_seat` never from client** (webhook only)
- Avatars: private bucket, signed URLs only
- Leave table = no refund

---

## Stack

| Layer | Choice |
|--------|--------|
| Frontend | Vite + React 19 (`hajde/`) |
| Backend | Supabase project `xjajhznpbzfpuigshlgh` |
| Payments | Stub (`startPayment`) |
| Email | Resend Edge Function `notify-email` — **not deployed** |
| Translate | Anthropic Edge Function `translate` — **not deployed**; UI may still call Anthropic directly in places |

**URL:** `https://xjajhznpbzfpuigshlgh.supabase.co`

---

## Naming conventions (easy to get wrong)

| Concept | Correct | Wrong / legacy |
|---------|---------|----------------|
| Auth session user in `HajdeApp` | `authUser` from `useAuth()` | Local form state is `user` (name, age, photo…) — **no** `.id` |
| Hook user id | `authUser?.id` | `user?.id` (undefined) |
| RPC args | `{ p_table }` / `{ p_request }` | `table_id` / `request_id` |
| Profile photo | `photo_path`, `rating` | `photo_url`, `stars` |
| Tables UI fields | mapped in `tables.js`: `cafe`, `host`, `joined`, `time`, `cat`, `requests[].rid` | raw DB `title`, `time_label`, `kind` |
| Notifications | `{ icon, body, read }` → UI maps `body` → `text` | no `title` column |

---

## What works (wired into HajdeApp)

### Auth
- `useAuth()` as `authUser`
- Loading spinner, email confirmation gate, sign-in from hero, header avatar → confirm → `signOut()`
- Profile rows created on signup (DB trigger)

### Tables
- `useTables(city, cat, tasteProfile \|\| dbProfile, affinity)` + `useProfile(authUser?.id)`
- No `SEED_TABLES` / local `setTables`
- Create / request join / waitlist / leave → real API/RPCs
- Auth race fix: refetch tables when `authUser` becomes available (RLS needs session)
- Verified earlier: feed can show real tables (e.g. “Soma Book Station”)

### Notifications (just wired)
```js
const { notifs, unread, markRead, pushNotif } = useNotifications(authUser?.id)
```
- Bell badge = `unread`
- Opening panel → `markRead()`
- DB trigger on `requests` still inserts host/guest notifications
- Client `pushNotif(text, icon)` → `insertNotification` (needs `notifications_insert_own` policy — applied)

### Requests (just wired)
```js
const { pendingRequests, approveRequest, rejectRequest } = useRequests(active, authUser?.id)
```
- Subscription **active when a table sheet is open** (`active` = table id)
- Detail sheet pending list uses live `pendingRequests`
- Approve/reject call hook → RPC → `refetchTables()`
- Local `myStatus(t)` function in `HajdeApp` still used for feed/sheet status (host/joined/pending/…) — do **not** confuse with hook’s `myStatus` string

---

## What does NOT work / not wired yet

| Area | Gap |
|------|-----|
| **Chat** | UI uses `localChat`; `useChat` / `messages` API not plugged into sheet |
| **Translate** | Edge Function not deployed; sheet may still hit Anthropic from browser |
| **Email on new request** | `notify-email` + `email-notifications.sql` / pg_net not production-ready |
| **Payments** | Stub only; no TEB/Raiffeisen/Paddle; no webhook → `confirm_paid_seat` |
| **Avatar in onboarding** | Storage helpers exist; full upload → `photo_path` flow may be incomplete in UI |
| **Wednesday dinner / connections / ratings / reports** | Mostly demo/local UI; not fully backend-backed |
| **Two-browser E2E** | Code ready; needs manual test with two accounts |

---

## Important schema facts (applied)

From `hajde-backend/schema.sql` + MCP apply:
- **16 tables** with RLS
- RPCs: `request_join`, `approve_request`, `reject_request`, `confirm_free_seat`, `confirm_paid_seat`, `leave_table`
- Realtime publication includes: `messages`, `requests`, `notifications`, `memberships`
- Trigger `notify_on_request` → inserts into `notifications`
- Affinity is per **category**: `{ user_id, category, score }`
- Requests SELECT: host of table **or** requester only

---

## File map (key)

```
hajde/
  src/
    main.jsx                 # mounts <HajdeApp />
    HajdeApp.jsx             # full UI (wired auth, tables, notifs, requests)
    HajdeApp.css
    supabaseClient.js
    api/
      auth.js, tables.js, requests.js, payments.js,
      messages.js, translate.js, storage.js, notifications.js
    hooks/
      useAuth, useProfile, useTables, useRequests,
      useNotifications, useChat, useTranslate, useAvatar, useOnboardingPhoto
    components/
      ProfileAvatar.jsx, NotificationPanel.jsx  # optional drop-ins; main UI is inline in HajdeApp
  .env                       # Vite anon keys — filled
hajde-backend/
  schema.sql, storage.sql, …
hajde-web.html               # original HTML source (ported; keep as reference)
```

---

## Recommended next steps (ordered)

1. **Manual two-account test** (realtime requests + bell):  
   Window A host → create table → keep sheet open → Window B request join → A sees request + notification without refresh.
2. **Wire `useChat`** into the table sheet (replace `localChat`).
3. **Deploy Edge Functions** (`translate`, `notify-email`) + secrets; finish email path.
4. **Onboarding photo** → `uploadAvatar` / `saveAvatarToProfile` so hosts see real photos on requests.
5. **Payment provider** + webhook calling `confirm_paid_seat` only on server.
6. Backend-back Wednesday dinner / ratings / connections if in scope.

---

## Suggested prompt for next agent

> Read `hajde/HANDOFF.md`. Auth, tables feed, notifications, and live join-requests are wired into `HajdeApp.jsx`. Chat, payments, Edge Functions, and full avatar upload are not. Prefer wiring the next gap (usually chat or two-account E2E verification) over redesigning UI. Use `authUser?.id` and RPC params `p_table` / `p_request`.

---

*Update this file whenever a major layer is wired or a blocker is cleared.*
