"""Differential tests: old SQL implementation vs the Python one, same data.

Each case is a list of steps run twice on the legacy database ejb_legacy (rebuilt with
dev/rebuild_legacy_db.sh, which still has the SQL functions/policies/triggers):

  SQL side:    steps run as the user through the old engine (SET ROLE, RLS,
               SQL functions and triggers) - core/query.py + core/rpc.py.
  Python side: same steps through ejb.query / ejb.rpc with every SQL trigger
               disabled (ALTER TABLE ... DISABLE TRIGGER USER, rolled back),
               so only the Python hooks act.

Both sides are rolled back. Compared: each step's result (or error message +
code) and the net change to every table (added / removed / changed rows), with
values that are naturally different between runs normalised: new uuids,
timestamps from "now", random codes.

Case format (Python dicts in dev/difftests/*.py, list CASES):
  {'name': 'request_join happy path',
   'steps': [
      {'as': 'ana.krasniqi@gmail.com', 'rpc': 'request_join', 'args': {'p_table': '$tbl:Kafe'}},
      {'as': 'admin', 'query': {'table': 'requests', 'action': 'select', 'filters': [...]}},
      {'as': None, 'rpc': 'table_share_preview', 'args': {...}},          # signed out
      {'as': '...', 'rpc': 'x', 'args': {'p_id': '$0.id'}},               # value from step 0's result
      {'sql': "update public.tables set ..."},                            # raw setup (both sides)
  {..., 'expect_diff': 'why'}   # run both, do not compare this step's result (intentional change)
   ],
   'unordered': False,          # top-level result lists compared without order
   'deep_unordered': False}     # all lists at any depth compared without order

Placeholders in args: '$<n>' / '$<n>.<key>' (result of step n on that side),
'$user:<email>' (user id), '$tbl:<title prefix>' (table id), '$now+<days>d'
(ISO time), '$sql:<select>' (first column of the first row, evaluated at that
step on that side). 'as': 'admin' = support@ejabashkohu.com.

Run: python dev/difftest.py [module ...]    (modules in dev/difftests/)
"""
import datetime
import importlib
import json
import os
import re
import sys
import traceback
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ.setdefault('MSGPACK_PUREPYTHON', '1')
os.environ.setdefault('DB_NAME', 'ejb_legacy')   # built by dev/rebuild_legacy_db.sh
import django  # noqa: E402

django.setup()

from django.db import connection, transaction  # noqa: E402

from core.db import DbError  # noqa: E402
from dev.legacy_engine import query as old_query, rpc as old_rpc  # noqa: E402
from dev.legacy_engine.db import _parse_json, as_user  # noqa: E402
from ejb import context, query as new_query, rpc as new_rpc  # noqa: E402
from ejb.context import Actor  # noqa: E402

import ejb.services  # noqa: E402,F401  (registers functions)

RANDOM_COLS = {'share_code', 'ticket_code', 'code', 'room_key', 'provider_ref'}
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
TS_RE = re.compile(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$')


class Rollback(Exception):
    pass


CASE_T0 = [datetime.datetime.now(datetime.timezone.utc)]


def tables(cur):
    cur.execute("select tablename from pg_tables where schemaname='public' and tablename <> 'django_migrations' order by 1")
    return [r[0] for r in cur.fetchall()]


def snapshot(cur):
    snap = {}
    for t in tables(cur):
        cur.execute(f'select to_jsonb(x) from public."{t}" x')
        snap[t] = [r[0] for r in cur.fetchall()]
    cur.execute('select jsonb_build_object(\'kind\', kind, \'payload\', payload) from backend.jobs')
    snap['backend.jobs'] = [r[0] for r in cur.fetchall()]
    cur.execute('select jsonb_build_object(\'id\', id, \'email\', email, \'banned_until\', banned_until) from auth.users')
    snap['auth.users'] = [r[0] for r in cur.fetchall()]
    return snap


def key_of(table, row):
    for k in ('id',):
        if k in row:
            return (k, row[k])
    pks = {'affinity': ('user_id', 'category'), 'badges': ('user_id', 'badge_id'),
           'blocks': ('blocker_id', 'blocked_id'), 'connections': ('a', 'b'),
           'memberships': ('table_id', 'user_id'), 'waitlist': ('table_id', 'user_id'),
           'connection_picks': ('table_id', 'picker_id', 'picked_id'),
           'lesson_participants': ('lesson_id', 'student_id'), 'lesson_rooms': ('lesson_id',),
           'taste_profiles': ('user_id',), 'tutors': ('user_id',), 'notification_badge_labels': ('label',),
           'wednesday_participants': ('group_id', 'user_id'), 'wednesday_signups': ('user_id', 'dinner_date')}
    cols = pks.get(table)
    if cols:
        return tuple(row.get(c) for c in cols)
    return json.dumps(row, sort_keys=True)


class Norm:
    def __init__(self, base_snap, t0):
        self.known = set()
        for rows in base_snap.values():
            for r in rows:
                self._collect(r)
        self.t0 = t0

    def _collect(self, v):
        if isinstance(v, dict):
            for x in v.values():
                self._collect(x)
        elif isinstance(v, list):
            for x in v:
                self._collect(x)
        elif isinstance(v, str) and UUID_RE.match(v):
            self.known.add(v)

    def __call__(self, v, col=None):
        if isinstance(v, dict):
            return {k: self(x, k) for k, x in sorted(v.items())}
        if isinstance(v, list):
            return [self(x, col) for x in v]
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, str):
            if col in RANDOM_COLS and v:
                return '<rand>'
            if UUID_RE.match(v) and v not in self.known:
                return '<new-uuid>'
            if TS_RE.match(v):
                try:
                    dt = datetime.datetime.fromisoformat(v.replace(' ', 'T').replace('Z', '+00:00'))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    if abs((dt - self.t0).total_seconds()) < 300:
                        return '<now>'
                    return dt.astimezone(datetime.timezone.utc).isoformat()
                except ValueError:
                    pass
        return v


def diff(base, after):
    out = {}
    for t in sorted(set(base) | set(after)):
        b = {key_of(t, r): r for r in base.get(t, [])}
        a = {key_of(t, r): r for r in after.get(t, [])}
        added = [a[k] for k in a if k not in b]
        removed = [b[k] for k in b if k not in a]
        changed = [{'before': b[k], 'after': a[k]} for k in a if k in b and a[k] != b[k]]
        if added or removed or changed:
            out[t] = {'added': added, 'removed': removed, 'changed': changed}
    return out


def canon(x):
    return json.dumps(x, sort_keys=True, ensure_ascii=False, default=str)


def norm_diff(d, norm):
    out = {}
    for t, v in d.items():
        out[t] = {k: sorted((canon(norm(r)) for r in rows)) for k, rows in v.items()}
    return out


# ───────────── placeholders ─────────────

def lookup_ids(cur):
    cur.execute('select lower(email), id::text from auth.users')
    users = dict(cur.fetchall())
    users['admin'] = users.get('support@ejabashkohu.com')
    cur.execute('select title, id::text from public.tables order by created_at')
    tbls = cur.fetchall()
    return users, tbls


def resolve(v, results, users, tbls):
    if isinstance(v, dict):
        return {k: resolve(x, results, users, tbls) for k, x in v.items()}
    if isinstance(v, list):
        return [resolve(x, results, users, tbls) for x in v]
    if not isinstance(v, str) or not v.startswith('$'):
        return v
    if v.startswith('$sql:'):
        with connection.cursor() as c:
            c.execute(v[5:])
            row = c.fetchone()
        return None if row is None else (str(row[0]) if isinstance(row[0], uuid.UUID) else row[0])
    if v.startswith('$user:'):
        return users[v[6:].lower()]
    if v.startswith('$tbl:'):
        for title, tid in tbls:
            if title.startswith(v[5:]):
                return tid
        raise KeyError(v)
    m = re.match(r'^\$now([+-]\d+)([dhm])$', v)
    if m:
        n = int(m.group(1))
        delta = {'d': datetime.timedelta(days=n), 'h': datetime.timedelta(hours=n),
                 'm': datetime.timedelta(minutes=n)}[m.group(2)]
        return (CASE_T0[0] + delta).replace(microsecond=0).isoformat()
    m = re.match(r'^\$(\d+)(?:\.(.+))?$', v)
    if m:
        r = results[int(m.group(1))]
        if m.group(2):
            for part in m.group(2).split('.'):
                r = r[int(part)] if isinstance(r, list) else r[part]
        return r
    return v


def claims_for(who, users):
    if who is None:
        return None
    uid = users[who.lower()] if not UUID_RE.match(who) else who
    return {'sub': uid, 'role': 'authenticated', 'email': who}


def outcome(fn):
    try:
        return {'ok': fn()}
    except DbError as e:
        return {'error': e.message, 'code': e.code}


# ───────────── the two sides ─────────────

def sequences(cur):
    cur.execute("select schemaname||'.'||sequencename, last_value from pg_sequences"
                " where schemaname in ('public','backend')")
    return cur.fetchall()


def reset_sequences(cur, seqs):
    """Sequences survive rollbacks; give both sides the same starting ids."""
    for name, last in seqs:
        if last is None:
            cur.execute('select setval(%s, 1, false)', [name])
        else:
            cur.execute('select setval(%s, %s, true)', [name, last])


def run_sql_side(case, users, tbls, seqs):
    results, outs = [], []
    with transaction.atomic():
        with connection.cursor() as cur:
            _parse_json(cur)
            reset_sequences(cur, seqs)
            for st in case['steps']:
                if 'sql' in st:
                    cur.execute(st['sql'])
                    results.append(None)
                    outs.append(None)
                    continue
                claims = claims_for(resolve(st.get('as'), results, users, tbls), users)
                args = resolve(st.get('args') or {}, results, users, tbls)
                q = resolve(st.get('query'), results, users, tbls) if 'query' in st else None

                def go():
                    sid = transaction.savepoint()
                    try:
                        with as_user(claims) as c:
                            if q is not None:
                                data, count = old_query.run(c, q)
                                r = {'data': data, 'count': count}
                            else:
                                r = old_rpc.call(c, st['rpc'], args)
                        transaction.savepoint_commit(sid)
                        return r
                    except Exception:
                        transaction.savepoint_rollback(sid)
                        raise
                o = outcome(go)
                with connection.cursor() as c2:
                    c2.execute('reset role')
                results.append(o.get('ok'))
                outs.append(o)
            after = snapshot(cur)
        transaction.set_rollback(True)
    return outs, after


def run_py_side(case, users, tbls, seqs):
    results, outs = [], []
    with transaction.atomic():
        with connection.cursor() as cur:
            _parse_json(cur)
            reset_sequences(cur, seqs)
            for t in tables(cur) + ['auth.users']:
                name = t if '.' in t else f'public."{t}"'
                cur.execute(f'alter table {name} disable trigger user')
            for st in case['steps']:
                if 'sql' in st:
                    cur.execute(st['sql'])
                    results.append(None)
                    outs.append(None)
                    continue
                claims = claims_for(resolve(st.get('as'), results, users, tbls), users)
                args = resolve(st.get('args') or {}, results, users, tbls)
                q = resolve(st.get('query'), results, users, tbls) if 'query' in st else None

                def go():
                    sid = transaction.savepoint()
                    try:
                        with context.acting(Actor.from_claims(claims), direct=q is not None):
                            if q is not None:
                                data, count = new_query.run(q)
                                r = {'data': data, 'count': count}
                            else:
                                r = new_rpc.call(st['rpc'], args)
                        transaction.savepoint_commit(sid)
                        return json.loads(json.dumps(r, default=str))
                    except Exception:
                        transaction.savepoint_rollback(sid)
                        raise
                results_o = outcome(go)
                results.append(results_o.get('ok'))
                outs.append(results_o)
            after = snapshot(cur)
        transaction.set_rollback(True)
    return outs, after


def deep_unorder(v):
    if isinstance(v, dict):
        return {k: deep_unorder(x) for k, x in v.items()}
    if isinstance(v, list):
        return sorted((deep_unorder(x) for x in v), key=canon)
    return v


def unorder(o):
    ok = o.get('ok')
    if isinstance(ok, list):
        return {'ok': sorted(canon(x) for x in ok)}
    if isinstance(ok, dict) and isinstance(ok.get('data'), list):
        return {'ok': dict(ok, data=sorted(canon(x) for x in ok['data']))}
    return o


def run_case(case):
    t0 = datetime.datetime.now(datetime.timezone.utc)
    CASE_T0[0] = t0
    with connection.cursor() as cur:
        _parse_json(cur)
        users, tbls = lookup_ids(cur)
        base = snapshot(cur)
        seqs = sequences(cur)
    norm = Norm(base, t0)
    try:
        return _run_case(case, users, tbls, seqs, base, norm)
    finally:
        with connection.cursor() as cur:
            reset_sequences(cur, seqs)


def _run_case(case, users, tbls, seqs, base, norm):
    sql_outs, sql_after = run_sql_side(case, users, tbls, seqs)
    py_outs, py_after = run_py_side(case, users, tbls, seqs)
    problems = []
    for i, (a, b) in enumerate(zip(sql_outs, py_outs)):
        if a is None or case['steps'][i].get('expect_diff'):
            continue
        na, nb = norm(a), norm(b)
        if case.get('unordered'):
            na, nb = unorder(na), unorder(nb)
        if case.get('deep_unordered'):       # every list, at any depth, compared as a set
            na, nb = deep_unorder(na), deep_unorder(nb)
        if canon(na) != canon(nb):
            problems.append(f'step {i} result differs:\n   SQL: {canon(na)[:1500]}\n   PY : {canon(nb)[:1500]}')
    da = norm_diff(diff(base, sql_after), norm)
    db = norm_diff(diff(base, py_after), norm)
    for t in sorted(set(da) | set(db)):
        if t in case.get('ignore_tables', ()):
            continue
        if da.get(t) != db.get(t):
            problems.append(f'table {t} changes differ:\n   SQL: {canon(da.get(t))[:2500]}\n   PY : {canon(db.get(t))[:2500]}')
    return problems


def main(mods):
    if not mods:
        mods = sorted(f[:-3] for f in os.listdir(os.path.join(os.path.dirname(__file__), 'difftests'))
                      if f.endswith('.py') and not f.startswith('_'))
    total = failed = 0
    for mod in mods:
        cases = importlib.import_module(f'dev.difftests.{mod}').CASES
        for case in cases:
            total += 1
            try:
                problems = run_case(case)
            except Exception:
                problems = ['crashed:\n' + traceback.format_exc()]
            if problems:
                failed += 1
                print(f'FAIL {mod}: {case["name"]}')
                for p in problems:
                    print('  - ' + p)
            else:
                print(f'ok   {mod}: {case["name"]}')
    print(f'\n{total - failed}/{total} cases match')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
