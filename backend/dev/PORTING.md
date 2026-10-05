# Porting a SQL function to Python (brief for each porter)

Goal: every SQL function the app calls via `/rest/v1/rpc/<name>` becomes a Python
function with the SAME name, argument names, defaults, result shape, error
messages (exact Albanian text) and error codes, and the SAME effects on the
database. Behaviour must be identical; only the implementation moves to Django.

## Where things are
- Original SQL: `/tmp/claude-0/s/legacy/functions.sql` (all functions, the current
  versions; `grep -n "FUNCTION public.<name>(" ` to find one). Signatures and
  who may call them (anon/authenticated): `/tmp/claude-0/s/rpc_sigs.txt`
  (columns: name|anon|authenticated|args|result). Functions with authenticated=f
  are internal helpers: port them as plain Python functions (no @rpc).
- Models: `backend/ejb/models.py` (db_table = the SQL table; FK attname = SQL column,
  e.g. `host_id`; Profile pk is `user` → `Profile.objects.filter(pk=uid)`;
  Connection FKs `a`/`b` → `a_id`/`b_id`).
- Framework (read these first, do NOT edit them):
  - `ejb/rpc.py` — `@rpc('name', anon=False)`; argument conversion from annotations.
  - `ejb/context.py` — `context.uid()` (= auth.uid()), `context.actor().is_admin`,
    `context.now()` (= now(), fixed per transaction).
  - `ejb/errors.py` — `fail(message, code='P0001')` = RAISE EXCEPTION.
  - `ejb/services/common.py` — the shared former helpers: require_uid, admin_guard,
    require_onboarded_me, admin_log, user_label, premium_until, is_premium,
    next_wednesday_dinner, kosovo_now, month_start, add_months, distance_km,
    new_share_code, notify (insert notification), fmt_local, BELGRADE ...
  - `ejb/hooks.py` — the former triggers. They run automatically on `obj.save()` /
    `obj.delete()` (Django signals). So when the SQL function did `INSERT INTO
    requests`, do `Request(...).save()` and the trigger effects (notifications,
    plan checks, activity_at, realtime) happen exactly as the SQL triggers did.
    NEVER use `QuerySet.update()` / `bulk_create()` / `QuerySet.delete()` on models
    that have hooks (Profile, Table, Request, Waitlist, Membership, Notification,
    Payment, Rating, ConnectionPick, Tutor, Lesson, LessonParticipant, Message,
    AuthUser) — iterate and save()/delete() each object instead. On other models
    queryset update/delete is fine.
  - `ejb/jobs.py` — `jobs.enqueue(kind, payload)` replaces
    `net.http_post(url := '.../functions/v1/<kind>', body := ...)`; kind = last
    URL segment, payload = the body (headers are irrelevant).
- Services run like SECURITY DEFINER functions: no row-level security; do the
  checks the SQL function did.

## How to write one
- Module `ejb/services/<group>.py` (it is auto-imported). Example: `ejb/services/basics.py`.
- `@rpc('name', anon=<True if rpc_sigs says anon=t>)`; parameters named exactly
  like the SQL args, with defaults matching the SQL defaults (None for NULL).
  Annotations: `UUID`, `int`, `float`, `bool`, `str`, `datetime` (timestamptz),
  `list[str]` (text[]), `dict` (jsonb).
- Return: scalar → the value; `jsonb` → dict/list built like `jsonb_build_object`
  (keys and value types identical: timestamps stay datetime objects (serialized
  for you), numbers as int/float/Decimal, NULLs as None, missing vs null keys as
  in SQL); `RETURNS TABLE(...)`/SETOF → list of dicts with exactly those columns
  in that order; void → None.
- Error messages: copy the exact text; `USING ERRCODE = 'xxxxx'` → `fail(msg, 'xxxxx')`.
  Postgres raising on its own (e.g. a CHECK constraint, unique violation, invalid
  cast of a text arg) may happen naturally through the ORM (IntegrityError is
  turned into the same error); for invalid input syntax inside SQL logic, mimic it
  with fail(..., '22P02') if needed.
- SQL details to mirror carefully: NULL semantics (`x <> y` with NULL, COALESCE,
  string `||` with NULL → NULL), `count(*)` ints, `round(...,2)` numerics,
  ordering of results (`ORDER BY` incl. tie-breaks — if SQL order is undefined
  for ties, any order is acceptable but keep the specified keys), `LIMIT/OFFSET`,
  `ILIKE '%'||q||'%'` (case-insensitive contains; use `__icontains`, note SQL
  special chars `%`/`_` in q act as wildcards in ILIKE — mirror with `__iregex`
  if you want exactness), `date_trunc`, time zones ('Europe/Belgrade'),
  `FOUND` / `GET DIAGNOSTICS ROW_COUNT`, `ON CONFLICT DO NOTHING/UPDATE`,
  `FOR UPDATE` row locks → `select_for_update()`.

## Verify with differential tests (mandatory)
- Write `dev/difftests/<group>.py` with `CASES` (format: docstring of
  `dev/difftest.py`). Cover every function: happy path(s), each error branch,
  permission cases (other user, signed out, non-admin), edge cases. Chain steps
  to create the state you need (e.g. apply as tutor → admin approves → book).
- Run against YOUR OWN database copy (never `ejb_legacy` or `ejb_dev`):
  `cd backend && DB_NAME=ejb_dev_<x> MSGPACK_PUREPYTHON=1 python3 dev/difftest.py <group>`
  Both sides run in rolled-back transactions; the DB is never changed.
- Every case must report `ok`. If a difference is caused by a genuine bug or
  nondeterminism in the SQL side (e.g. random order), explain it in a comment
  in the case and make the test compare something deterministic instead
  (e.g. `'unordered': True`, or `ignore_tables`).
- Do not edit shared files (ejb/*.py outside your module, dev/difftest.py). If a
  shared helper is wrong or missing, write a local helper in your module and
  report the issue in your final message.

## Final message
List: functions ported (all from your list), number of cases and that all pass,
any behavioural notes / suspected bugs in the original SQL, any shared-file
issues found.
