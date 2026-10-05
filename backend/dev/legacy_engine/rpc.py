"""LEGACY (dev only, for dev/difftest.py): the old SQL-generating engine."""
"""Calling the database's functions (what PostgREST's /rpc did).

Arguments are passed by name and cast to the declared types; the call runs as
the signed-in user, so EXECUTE grants, auth.uid() and SECURITY DEFINER checks
inside the functions decide everything, as before. Results keep PostgREST's
shapes: a scalar/json value, an object for a single composite, a list for
set-returning / RETURNS TABLE functions, null for void.
"""
from .catalog import get_catalog
from core.db import DbError
from .query import Ctx, qi


def pick_function(cat, name, args):
    candidates = cat.functions.get(name) or []
    keys = set(args)
    for fn in candidates:
        names = [a[0] for a in fn.args]
        if not keys <= set(names):
            continue
        if not set(names[:fn.required]) <= keys:
            continue
        return fn
    raise DbError(
        f'Could not find the function public.{name}({", ".join(sorted(keys))}) in the schema cache',
        'PGRST202', status=404)


def call(cur, name, args):
    if not isinstance(args, dict):
        raise DbError('Function arguments must be an object', 'PGRST102', status=400)
    cat = get_catalog(cur)
    fn = pick_function(cat, name, args)
    ctx = Ctx()
    passed = []
    for arg_name, arg_type in fn.args:
        if arg_name in args:
            passed.append(f'{qi(arg_name)} => {ctx.param(args[arg_name], arg_type)}')
    call_sql = f'public.{qi(name)}({", ".join(passed)})'
    if fn.returns_set:
        sql = f"SELECT COALESCE(json_agg(r), '[]'::json) FROM {call_sql} r"
    elif fn.return_kind == 'void':
        cur.execute(f'SELECT {call_sql}', ctx.params)
        return None
    elif fn.return_kind == 'composite':
        sql = f'SELECT to_json(r) FROM {call_sql} r'
    else:
        sql = f'SELECT to_json({call_sql})'
    cur.execute(sql, ctx.params)
    row = cur.fetchone()
    return row[0] if row else None
