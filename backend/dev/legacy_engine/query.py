"""LEGACY (dev only, for dev/difftest.py): the old SQL-generating engine."""
"""Table queries for the app (what PostgREST did), run as the signed-in user.

A request describes one operation on one `public` table:

    {"table": "tables", "action": "select",
     "select": "*, host:profiles!tables_host_id_fkey(id, first_name)",
     "filters": [{"col": "city", "op": "eq", "value": "Prishtinë"}],
     "order": [{"col": "event_datetime", "ascending": true}],
     "limit": 50, "single": false, "maybeSingle": false, "count": null}

Every identifier is checked against the catalog and quoted; every value is a
bound parameter cast to the column's type. Row-level security decides which
rows exist for this user, exactly as before.
"""
import json
import re

from psycopg.types.json import Jsonb

from .catalog import get_catalog
from core.db import DbError

OPS = {'eq': '=', 'neq': '<>', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=',
       'like': 'LIKE', 'ilike': 'ILIKE', 'cs': '@>', 'cd': '<@', 'ov': '&&'}
ACTIONS = {'select', 'insert', 'upsert', 'update', 'delete'}
IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def qi(name):
    if not IDENT.match(name or ''):
        raise DbError(f'Invalid identifier "{name}"', 'PGRST100', status=400)
    return '"' + name + '"'


class Ctx:
    def __init__(self):
        self.params = []
        self.n = 0

    def alias(self):
        self.n += 1
        return f't{self.n}'

    def param(self, value, sql_type):
        self.params.append(adapt(value, sql_type))
        return f'%s::{sql_type}'


def adapt(value, sql_type):
    if value is None:
        return None
    t = sql_type.lower()
    if t in ('json', 'jsonb'):
        return Jsonb(value)
    if t.endswith('[]') and isinstance(value, str):
        return value  # already an array literal like {a,b}
    if isinstance(value, (dict, list)) and not t.endswith('[]'):
        return json.dumps(value)
    return value


# ───────────── select parsing ─────────────

def split_top(s, sep=','):
    parts, depth, cur, quote = [], 0, [], False
    for ch in s:
        if ch == '"':
            quote = not quote
        if not quote:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == sep and depth == 0:
                parts.append(''.join(cur).strip())
                cur = []
                continue
        cur.append(ch)
    if ''.join(cur).strip():
        parts.append(''.join(cur).strip())
    return parts


def parse_select(s):
    """Returns a list of items: ('star',) | ('col', name, alias) | ('embed', rel, alias, hint, inner, items)."""
    s = re.sub(r'\s+', ' ', (s or '*').strip())
    items = []
    for part in split_top(s):
        if part == '*':
            items.append(('star',))
            continue
        m = re.match(r'^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)((?:\s*![A-Za-z_][A-Za-z0-9_]*)*)\s*(?:\((.*)\))?$', part, re.S)
        if not m:
            raise DbError(f'Could not parse select "{part}"', 'PGRST100', status=400)
        alias, name, bangs, inner = m.group(1), m.group(2), m.group(3), m.group(4)
        hints = [b.strip() for b in bangs.split('!') if b.strip()] if bangs else []
        if inner is None and not hints:
            items.append(('col', name, alias or name))
        else:
            is_inner = 'inner' in hints
            hint = next((h for h in hints if h not in ('inner', 'left')), None)
            items.append(('embed', name, alias or name, hint, is_inner, parse_select(inner if inner is not None else '*')))
    return items


def find_relationship(cat, table, rel, hint):
    """('m2o' | 'o2m', fk, target_table) between `table` and `rel`."""
    found = []
    target = rel
    if rel not in cat.tables and rel in cat.tables[table].columns:  # embed by FK column name
        for fk in cat.fks:
            if fk.table == table and fk.columns == [rel]:
                found.append(('m2o', fk, fk.ref_table))
    for fk in cat.fks:
        if fk.table == table and fk.ref_table == target:
            found.append(('m2o', fk, target))
        if fk.table == target and fk.ref_table == table:
            found.append(('o2m', fk, target))
    if hint:
        found = [f for f in found if f[1].name == hint or f[1].columns == [hint]]
    if not found:
        raise DbError(f"Could not find a relationship between '{table}' and '{rel}' in the schema cache",
                      'PGRST200', status=400)
    if len(found) > 1:
        raise DbError(f"Could not embed because more than one relationship was found for '{table}' and '{rel}'",
                      'PGRST201', status=300)
    return found[0]


def select_list(cat, ctx, table, alias, items):
    out = []
    t = cat.tables[table]
    for it in items:
        if it[0] == 'star':
            out.append(f'{alias}.*')
        elif it[0] == 'col':
            if it[1] not in t.columns:
                raise DbError(f'column {table}.{it[1]} does not exist', '42703', status=400)
            out.append(f'{alias}.{qi(it[1])} AS {qi(it[2])}')
        else:
            _, rel, key, hint, _inner, sub = it
            kind, fk, target = find_relationship(cat, table, rel, hint)
            a = ctx.alias()
            inner_cols = select_list(cat, ctx, target, a, sub)
            if kind == 'm2o':
                cond = ' AND '.join(f'{a}.{qi(rc)} = {alias}.{qi(c)}' for c, rc in zip(fk.columns, fk.ref_columns))
                out.append(f'(SELECT row_to_json(e) FROM (SELECT {", ".join(inner_cols)} FROM public.{qi(target)} {a}'
                           f' WHERE {cond}) e) AS {qi(key)}')
            else:
                cond = ' AND '.join(f'{a}.{qi(c)} = {alias}.{qi(rc)}' for c, rc in zip(fk.columns, fk.ref_columns))
                out.append(f"COALESCE((SELECT json_agg(row_to_json(e)) FROM (SELECT {', '.join(inner_cols)}"
                           f" FROM public.{qi(target)} {a} WHERE {cond}) e), '[]'::json) AS {qi(key)}")
    return out


def inner_conditions(cat, table, alias, items):
    conds = []
    for it in items:
        if it[0] == 'embed' and it[4]:
            kind, fk, target = find_relationship(cat, table, it[1], it[3])
            pairs = zip(fk.columns, fk.ref_columns)
            cond = ' AND '.join((f'x.{qi(rc)} = {alias}.{qi(c)}' if kind == 'm2o' else f'x.{qi(c)} = {alias}.{qi(rc)}')
                                for c, rc in pairs)
            conds.append(f'EXISTS (SELECT 1 FROM public.{qi(target)} x WHERE {cond})')
    return conds


# ───────────── filters ─────────────

def _list_value(raw):
    if isinstance(raw, list):
        return raw
    s = str(raw).strip()
    if s.startswith('(') and s.endswith(')'):
        s = s[1:-1]
    return [v.strip().strip('"') for v in split_top(s)] if s else []


def condition(cat, ctx, table, alias, col, op, value, negate=False):
    t = cat.tables[table]
    if col not in t.columns:
        raise DbError(f'column {table}.{col} does not exist', '42703', status=400)
    typ = t.columns[col]
    c = f'{alias}.{qi(col)}'
    if op == 'is':
        v = str(value).lower() if value is not None else 'null'
        if v not in ('null', 'true', 'false', 'unknown'):
            raise DbError('Invalid "is" value', 'PGRST100', status=400)
        sql = f'{c} IS {v.upper()}'
    elif op == 'in':
        sql = f'{c} = ANY({ctx.param(_list_value(value), typ + "[]")})'
    elif op in ('cs', 'cd', 'ov'):
        if typ.endswith('[]') and isinstance(value, str) and not value.startswith('{'):
            value = _list_value(value)
        sql = f'{c} {OPS[op]} {ctx.param(value, typ)}'
    elif op in ('like', 'ilike'):
        sql = f'{c}::text {OPS[op]} {ctx.param(str(value).replace("*", "%"), "text")}'
    elif op in OPS:
        sql = f'{c} {OPS[op]} {ctx.param(value, typ)}'
    else:
        raise DbError(f'Unsupported operator "{op}"', 'PGRST100', status=400)
    return f'NOT ({sql})' if negate else sql


def parse_logic(cat, ctx, table, alias, expr, joiner='OR'):
    """PostgREST logic syntax: 'a.eq.1,b.gt.2,and(c.is.null,d.eq.x)'."""
    parts = []
    for p in split_top(expr):
        m = re.match(r'^(not\.)?(and|or)\((.*)\)$', p, re.S)
        if m:
            inner = parse_logic(cat, ctx, table, alias, m.group(3), m.group(2).upper())
            parts.append(f'NOT ({inner})' if m.group(1) else inner)
            continue
        bits = p.split('.', 2)
        if len(bits) < 3:
            raise DbError(f'Could not parse filter "{p}"', 'PGRST100', status=400)
        col, op, val = bits
        negate = False
        if op == 'not':
            negate = True
            op, val = val.split('.', 1)
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        parts.append(condition(cat, ctx, table, alias, col, op, val, negate))
    return '(' + f' {joiner} '.join(parts) + ')' if parts else 'TRUE'


def where_clause(cat, ctx, table, alias, filters):
    conds = []
    for f in filters or []:
        if 'or' in f:
            conds.append(parse_logic(cat, ctx, table, alias, f['or'], 'OR'))
        elif 'and' in f:
            conds.append(parse_logic(cat, ctx, table, alias, f['and'], 'AND'))
        else:
            if '.' in f.get('col', ''):
                raise DbError('Filtering embedded resources is not supported', 'PGRST100', status=400)
            conds.append(condition(cat, ctx, table, alias, f['col'], f['op'], f.get('value'), bool(f.get('negate'))))
    return conds


def order_clause(cat, table, alias, order):
    parts = []
    for o in order or []:
        col = o.get('col')
        if col not in cat.tables[table].columns:
            raise DbError(f'column {table}.{col} does not exist', '42703', status=400)
        s = f'{alias}.{qi(col)} {"ASC" if o.get("ascending", True) else "DESC"}'
        if o.get('nullsFirst') is True:
            s += ' NULLS FIRST'
        elif o.get('nullsFirst') is False:
            s += ' NULLS LAST'
        parts.append(s)
    return ('ORDER BY ' + ', '.join(parts)) if parts else ''


# ───────────── execution ─────────────

def _json_rows(cur, sql, params):
    cur.execute(sql, params)
    row = cur.fetchone()
    return (row[0] if row else None) or []


def run(cur, req):
    cat = get_catalog(cur)
    table = req.get('table')
    action = req.get('action', 'select')
    if action not in ACTIONS:
        raise DbError(f'Unsupported action "{action}"', 'PGRST100', status=400)
    if table not in cat.tables:
        raise DbError(f'relation "public.{table}" does not exist', '42P01', status=404)
    items = parse_select(req.get('select') or '*')
    ctx = Ctx()
    t = cat.tables[table]
    count = None

    if action == 'select':
        a = 't0'
        conds = where_clause(cat, ctx, table, a, req.get('filters')) + inner_conditions(cat, table, a, items)
        where = ('WHERE ' + ' AND '.join(conds)) if conds else ''
        if req.get('count') in ('exact', 'planned', 'estimated'):
            cparams = list(ctx.params)
            cur.execute(f'SELECT count(*) FROM public.{qi(table)} {a} {where}', cparams)
            count = cur.fetchone()[0]
        if req.get('head'):
            return None, count
        cols = select_list(cat, ctx, table, a, items)
        limit = ''
        if req.get('limit') is not None:
            limit += f' LIMIT {int(req["limit"])}'
        if req.get('offset'):
            limit += f' OFFSET {int(req["offset"])}'
        sql = (f'SELECT COALESCE(json_agg(row_to_json(q)), \'[]\'::json) FROM ('
               f'SELECT {", ".join(cols)} FROM public.{qi(table)} {a} {where} '
               f'{order_clause(cat, table, a, req.get("order"))}{limit}) q')
        rows = _json_rows(cur, sql, ctx.params)
        return shape(rows, req), count

    # mutations: the changed rows become CTE "t0" so the same select/embeds apply
    if action in ('insert', 'upsert'):
        values = req.get('values')
        rows = values if isinstance(values, list) else [values]
        if not rows or not all(isinstance(r, dict) for r in rows):
            raise DbError('Insert needs an object or a list of objects', 'PGRST102', status=400)
        cols = []
        for r in rows:
            for k in r:
                if k not in t.columns:
                    raise DbError(f"Could not find the '{k}' column of '{table}' in the schema cache", 'PGRST204', status=400)
                if k not in cols:
                    cols.append(k)
        tuples = []
        for r in rows:
            tuples.append('(' + ', '.join(ctx.param(r[c], t.columns[c]) if c in r else 'DEFAULT' for c in cols) + ')')
        sql_mut = f'INSERT INTO public.{qi(table)} ({", ".join(qi(c) for c in cols)}) VALUES {", ".join(tuples)}'
        if action == 'upsert':
            target = [x.strip() for x in (req.get('onConflict') or '').split(',') if x.strip()] or t.pk
            for c in target:
                if c not in t.columns:
                    raise DbError(f'column {table}.{c} does not exist', '42703', status=400)
            if req.get('ignoreDuplicates'):
                sql_mut += f' ON CONFLICT ({", ".join(qi(c) for c in target)}) DO NOTHING'
            else:
                updates = [c for c in cols if c not in target] or cols
                sql_mut += (f' ON CONFLICT ({", ".join(qi(c) for c in target)}) DO UPDATE SET '
                            + ', '.join(f'{qi(c)} = EXCLUDED.{qi(c)}' for c in updates))
        sql_mut += ' RETURNING *'
    elif action == 'update':
        values = req.get('values') or {}
        if not isinstance(values, dict) or not values:
            raise DbError('Update needs an object', 'PGRST102', status=400)
        conds = where_clause(cat, ctx, table, 'u', req.get('filters'))
        if not conds:
            raise DbError('UPDATE requires a WHERE clause', '21000', status=400)
        sets = []
        for k, v in values.items():
            if k not in t.columns:
                raise DbError(f"Could not find the '{k}' column of '{table}' in the schema cache", 'PGRST204', status=400)
            sets.append(f'{qi(k)} = {ctx.param(v, t.columns[k])}')
        # SET params come after WHERE params in the SQL text: rebuild in text order
        ctx2 = Ctx()
        sets = [f'{qi(k)} = {ctx2.param(v, t.columns[k])}' for k, v in values.items()]
        conds = where_clause(cat, ctx2, table, 'u', req.get('filters'))
        ctx = ctx2
        sql_mut = f'UPDATE public.{qi(table)} u SET {", ".join(sets)} WHERE {" AND ".join(conds)} RETURNING u.*'
    else:  # delete
        conds = where_clause(cat, ctx, table, 'd', req.get('filters'))
        if not conds:
            raise DbError('DELETE requires a WHERE clause', '21000', status=400)
        sql_mut = f'DELETE FROM public.{qi(table)} d WHERE {" AND ".join(conds)} RETURNING d.*'

    if not req.get('returning'):
        cur.execute(f'WITH t0 AS ({sql_mut}) SELECT count(*) FROM t0', ctx.params)
        count = cur.fetchone()[0] if req.get('count') else None
        return None, count
    cols = select_list(cat, ctx, table, 't0', items)
    sql = f'WITH t0 AS ({sql_mut}) SELECT COALESCE(json_agg(row_to_json(q)), \'[]\'::json) FROM (SELECT {", ".join(cols)} FROM t0) q'
    rows = _json_rows(cur, sql, ctx.params)
    return shape(rows, req), (len(rows) if req.get('count') else None)


def shape(rows, req):
    if req.get('single'):
        if len(rows) != 1:
            raise DbError('JSON object requested, multiple (or no) rows returned', 'PGRST116',
                          details=f'The result contains {len(rows)} rows', status=406)
        return rows[0]
    if req.get('maybeSingle'):
        if len(rows) > 1:
            raise DbError('JSON object requested, multiple (or no) rows returned', 'PGRST116',
                          details=f'The result contains {len(rows)} rows', status=406)
        return rows[0] if rows else None
    return rows
