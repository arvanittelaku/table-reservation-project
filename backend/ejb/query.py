"""The app's direct table queries (what PostgREST did), on Django's ORM.

Same request format and JSON results as before (see core/query.py history):

    {"table": "tables", "action": "select",
     "select": "*, host:profiles!tables_host_id_fkey(id, first_name)",
     "filters": [{"col": "city", "op": "eq", "value": "Prishtinë"}],
     "order": [{"col": "event_datetime", "ascending": true}],
     "limit": 50, "single": false, "maybeSingle": false, "count": null}

Who sees and changes which rows is decided by policies.py (the former
row-level security), embedded rows included; writes run the model hooks (the
former triggers).
"""
import json
import re

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, models
from django.db.models import Exists, F, OuterRef, Q
from django.db.models.functions import Cast

from core.db import DbError, db_error_from
from .parse import _list_value, parse_select, split_top

from . import context
from .errors import rls_violation
from .policies import rules_for
from .registry import column_fields, model_for, pk_columns, table_name, to_json

ACTIONS = {'select', 'insert', 'upsert', 'update', 'delete'}


def _err(message, code, status=400, details=None):
    raise DbError(message, code, details=details, status=status)


# ───────────── models, columns, values ─────────────

def _model(table):
    m = model_for(table)
    if m is None:
        _err(f'relation "public.{table}" does not exist', '42P01', 404)
    return m


def _field(model, col, for_write=False):
    f = column_fields(model).get(col)
    if f is None:
        if for_write:
            _err(f"Could not find the '{col}' column of '{table_name(model)}' in the schema cache", 'PGRST204')
        _err(f'column {table_name(model)}.{col} does not exist', '42703')
    return f


def _pg_array(text):
    """'{a,b,"c d"}' -> ['a', 'b', 'c d']"""
    s = text.strip()
    if not (s.startswith('{') and s.endswith('}')):
        raise ValueError
    inner = s[1:-1]
    if not inner:
        return []
    return [v.strip().strip('"') for v in split_top(inner)]


def coerce(field, value):
    """A JSON/query-string value as the Python value of this column."""
    if value is None:
        return None
    try:
        if isinstance(field, ArrayField):
            if isinstance(value, str):
                value = _pg_array(value) if value.strip().startswith('{') else _list_value(value)
            return [coerce(field.base_field, v) for v in value]
        if isinstance(field, models.JSONField):
            return value
        if isinstance(field, models.ForeignKey):
            return field.target_field.to_python(value)
        if isinstance(field, models.BooleanField) and isinstance(value, str):
            v = value.strip().lower()
            if v in ('true', 't', 'yes', 'on', '1'):
                return True
            if v in ('false', 'f', 'no', 'off', '0'):
                return False
            raise ValidationError('bad bool')
        return field.to_python(value)
    except (ValidationError, ValueError, TypeError, ArithmeticError):
        _err(_bad_value_message(field, value), '22P02')


def _bad_value_message(field, value):
    kind = {models.UUIDField: 'uuid', models.IntegerField: 'integer', models.BigIntegerField: 'bigint',
            models.BooleanField: 'boolean', models.DateTimeField: 'timestamp with time zone',
            models.DateField: 'date', models.FloatField: 'double precision',
            models.DecimalField: 'numeric'}
    target = field.target_field if isinstance(field, models.ForeignKey) else field
    for cls, name in kind.items():
        if isinstance(target, cls):
            return f'invalid input syntax for type {name}: "{value}"'
    return f'invalid input value: "{value}"'


# ───────────── filters ─────────────

def _like_regex(pattern):
    out = []
    for ch in str(pattern).replace('*', '%'):
        out.append('.*' if ch == '%' else '.' if ch == '_' else re.escape(ch))
    return '^' + ''.join(out) + '$'


def _cond(model, col, op, value, negate=False, annotations=None):
    f = _field(model, col)
    name = f.attname
    if op == 'is':
        v = str(value).lower() if value is not None else 'null'
        if v == 'null':
            q = Q(**{f'{name}__isnull': True})
        elif v in ('true', 'false'):
            q = Q(**{name: v == 'true'})
        elif v == 'unknown':
            q = Q(**{f'{name}__isnull': True})
        else:
            _err('Invalid "is" value', 'PGRST100')
    elif op == 'in':
        q = Q(**{f'{name}__in': [coerce(f, v) for v in _list_value(value)]})
    elif op in ('cs', 'cd', 'ov'):
        if isinstance(f, ArrayField):
            v = coerce(f, value)
        elif isinstance(f, models.JSONField):
            v = json.loads(value) if isinstance(value, str) else value
        else:
            _err(f'operator does not exist for column {col}', '42883')
        q = Q(**{f'{name}__{ {"cs": "contains", "cd": "contained_by", "ov": "overlap"}[op] }': v})
    elif op in ('like', 'ilike'):
        target = name
        if not isinstance(f, (models.TextField, models.CharField)):
            alias = f'_txt_{col}'
            annotations[alias] = Cast(name, models.TextField())
            target = alias
        q = Q(**{f'{target}__{"regex" if op == "like" else "iregex"}': _like_regex(value)})
    elif op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte'):
        v = coerce(f, value)
        if op == 'eq':
            q = Q(**{name: v})
        elif op == 'neq':
            # SQL: col <> v is NULL (not true) when col is NULL
            q = ~Q(**{name: v}) & Q(**{f'{name}__isnull': False})
        else:
            q = Q(**{f'{name}__{op}': v})
    else:
        _err(f'Unsupported operator "{op}"', 'PGRST100')
    if negate:
        # NOT (cond): rows where cond is NULL are excluded in SQL too
        q = ~q & (Q(**{f'{name}__isnull': False}) if op != 'is' else Q())
    return q


def _logic(model, expr, joiner, annotations):
    parts = []
    for p in split_top(expr):
        m = re.match(r'^(not\.)?(and|or)\((.*)\)$', p, re.S)
        if m:
            inner = _logic(model, m.group(3), m.group(2), annotations)
            parts.append(~inner if m.group(1) else inner)
            continue
        bits = p.split('.', 2)
        if len(bits) < 3:
            _err(f'Could not parse filter "{p}"', 'PGRST100')
        col, op, val = bits
        negate = False
        if op == 'not':
            negate = True
            op, val = val.split('.', 1)
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        parts.append(_cond(model, col, op, val, negate, annotations))
    if not parts:
        return Q()
    out = parts[0]
    for p in parts[1:]:
        out = (out | p) if joiner == 'or' else (out & p)
    return out


def _filters(model, filters, annotations):
    q = Q()
    for f in filters or []:
        if 'or' in f:
            q &= _logic(model, f['or'], 'or', annotations)
        elif 'and' in f:
            q &= _logic(model, f['and'], 'and', annotations)
        else:
            if '.' in (f.get('col') or ''):
                _err('Filtering embedded resources is not supported', 'PGRST100')
            q &= _cond(model, f.get('col'), f.get('op'), f.get('value'), bool(f.get('negate')), annotations)
    return q


# ───────────── relationships (embeds) ─────────────

def _fk_name(model, field):
    return f'{table_name(model)}_{field.column}_fkey'


def _relationship(model, rel, hint):
    """('m2o', fk_field, target) or ('o2m', fk_field on target, target)."""
    found = []
    target = model_for(rel)
    fields = column_fields(model)
    if target is None and rel in fields and fields[rel].is_relation:
        f = fields[rel]
        found.append(('m2o', f, f.related_model))
    if target is not None:
        for f in model._meta.concrete_fields:
            if f.is_relation and f.related_model is target:
                found.append(('m2o', f, target))
        for f in target._meta.concrete_fields:
            if f.is_relation and f.related_model is model:
                found.append(('o2m', f, target))
    if hint:
        found = [x for x in found
                 if _fk_name(model if x[0] == 'm2o' else x[2], x[1]) == hint or x[1].column == hint]
    if not found:
        _err(f"Could not find a relationship between '{table_name(model)}' and '{rel}' in the schema cache",
             'PGRST200')
    if len(found) > 1:
        _err(f"Could not embed because more than one relationship was found for '{table_name(model)}' and '{rel}'",
             'PGRST201', 300)
    return found[0]


def _visible(model, a):
    return model.objects.filter(rules_for(table_name(model)).select(a))


def _inner_q(model, items, a):
    q = Q()
    for it in items:
        if it[0] == 'embed' and it[4]:
            kind, f, target = _relationship(model, it[1], it[3])
            sub = _visible(target, a)
            if kind == 'm2o':
                sub = sub.filter(**{f.target_field.attname: OuterRef(f.attname)})
            else:
                sub = sub.filter(**{f.attname: OuterRef(f.target_field.attname)})
            q &= Q(Exists(sub))
    return q


# ───────────── rendering ─────────────

def _columns(model, items):
    """[(output key, column)] for the plain columns of a select list."""
    out = []
    fields = column_fields(model)
    for it in items:
        if it[0] == 'star':
            out.extend((c, c) for c in fields)
        elif it[0] == 'col':
            _field(model, it[1])
            out.append((it[2], it[1]))
    return out


def render(model, objs, items, a, embeds=True, columns=True):
    """Rows as JSON dicts with embeds, loading each embed level in one query."""
    fields = column_fields(model)
    cols = _columns(model, items) if columns else []
    rows = [{key: to_json(getattr(o, fields[c].attname)) for key, c in cols} for o in objs]
    for it in items if embeds else ():
        if it[0] != 'embed':
            continue
        _, rel, key, hint, _inner, sub_items = it
        kind, f, target = _relationship(model, rel, hint)
        base = _visible(target, a)
        if kind == 'm2o':
            ids = {getattr(o, f.attname) for o in objs} - {None}
            tf = f.target_field
            found = list(base.filter(**{f'{tf.attname}__in': ids})) if ids else []
            rendered = render(target, found, sub_items, a)
            by_id = {getattr(t, tf.attname): r for t, r in zip(found, rendered)}
            for o, row in zip(objs, rows):
                row[key] = by_id.get(getattr(o, f.attname))
        else:
            tf = f.target_field                       # column on `model` the FK points to
            ids = {getattr(o, tf.attname) for o in objs} - {None}
            found = list(base.filter(**{f'{f.attname}__in': ids})) if ids else []
            rendered = render(target, found, sub_items, a)
            groups = {}
            for t, r in zip(found, rendered):
                groups.setdefault(getattr(t, f.attname), []).append(r)
            for o, row in zip(objs, rows):
                row[key] = groups.get(getattr(o, tf.attname), [])
    return rows


def shape(rows, req):
    if req.get('single'):
        if len(rows) != 1:
            _err('JSON object requested, multiple (or no) rows returned', 'PGRST116', 406,
                 details=f'The result contains {len(rows)} rows')
        return rows[0]
    if req.get('maybeSingle'):
        if len(rows) > 1:
            _err('JSON object requested, multiple (or no) rows returned', 'PGRST116', 406,
                 details=f'The result contains {len(rows)} rows')
        return rows[0] if rows else None
    return rows


# ───────────── execution ─────────────

def _order(model, order):
    out = []
    for o in order or []:
        f = _field(model, o.get('col'))
        expr = F(f.attname)
        nf = o.get('nullsFirst')
        kw = {'nulls_first': True} if nf is True else {'nulls_last': True} if nf is False else {}
        out.append(expr.asc(**kw) if o.get('ascending', True) else expr.desc(**kw))
    return out


def _make(model, values):
    obj = model()
    for col, v in values.items():
        f = _field(model, col, for_write=True)
        setattr(obj, f.attname, coerce(f, v))
    return obj


def _apply(obj, values):
    for col, v in values.items():
        f = _field(type(obj), col, for_write=True)
        setattr(obj, f.attname, coerce(f, v))


def run(req, a=None):
    """Execute one request as the current actor; returns (data, count)."""
    a = a or context.actor()
    table = req.get('table')
    action = req.get('action', 'select')
    if action not in ACTIONS:
        _err(f'Unsupported action "{action}"', 'PGRST100')
    model = _model(table)
    rules = rules_for(table)
    items = parse_select(req.get('select') or '*')
    try:
        if action == 'select':
            return _select(model, rules, items, req, a)
        return _mutate(model, rules, items, req, a, action)
    except DbError:
        raise
    except (IntegrityError, DatabaseError) as exc:
        raise db_error_from(exc, anonymous=a.uid is None) from exc


def _select(model, rules, items, req, a):
    annotations = {}
    q = _filters(model, req.get('filters'), annotations)
    qs = model.objects.all()
    if annotations:
        qs = qs.annotate(**annotations)
    qs = qs.filter(rules.select(a)).filter(q).filter(_inner_q(model, items, a))
    count = qs.count() if req.get('count') in ('exact', 'planned', 'estimated') else None
    if req.get('head'):
        return None, count
    order = _order(model, req.get('order'))
    if order:
        qs = qs.order_by(*order)
    off = int(req.get('offset') or 0)
    if req.get('limit') is not None:
        qs = qs[off:off + int(req['limit'])]
    elif off:
        qs = qs[off:]
    objs = list(qs)
    return shape(render(model, objs, items, a), req), count


def _check_visible(model, rules, objs, a):
    if not objs:
        return
    pks = [o.pk for o in objs]
    seen = set(model.objects.filter(rules.select(a)).filter(pk__in=pks).values_list('pk', flat=True))
    if any(pk not in seen for pk in pks):
        rls_violation(table_name(model), a.uid is None)


def _has_embeds(items):
    return any(it[0] == 'embed' for it in items)


def _mutate(model, rules, items, req, a, action):
    table = table_name(model)
    anon = a.uid is None
    changed = []
    snapshots = None
    if anon:
        # signed-out visitors have no write rules on any table
        rls_violation(table, True)
    # PostgREST returned mutated rows from a CTE: embedded rows come from the
    # database as it was before the statement (trigger effects not yet visible).
    want_embeds = req.get('returning') and _has_embeds(items)
    pre_embeds = {}

    def remember(obj):
        if want_embeds:
            pre_embeds[id(obj)] = render(model, [obj], items, a, columns=False)[0]

    def insert_check(obj):
        if not rules.insert(a, obj):
            rls_violation(table, anon)

    def update_check(obj):
        if not rules.update_check(a, obj):
            rls_violation(table, anon)

    if action in ('insert', 'upsert'):
        values = req.get('values')
        rows = values if isinstance(values, list) else [values]
        if not rows or not all(isinstance(r, dict) for r in rows):
            _err('Insert needs an object or a list of objects', 'PGRST102')
        target = [x.strip() for x in (req.get('onConflict') or '').split(',') if x.strip()] or pk_columns(model)
        for c in target:
            _field(model, c)
        for r in rows:
            existing = None
            if action == 'upsert' and all(c in r for c in target):
                lookup = {_field(model, c).attname: coerce(_field(model, c), r[c]) for c in target}
                existing = model.objects.filter(**lookup).first()
            if existing is not None:
                if req.get('ignoreDuplicates'):
                    continue
                if not model.objects.filter(rules.update(a)).filter(pk=existing.pk).exists():
                    _err(f'new row violates row-level security policy (USING expression) for table "{table}"',
                         '42501', 401 if anon else 403)
                remember(existing)
                _apply(existing, {k: v for k, v in r.items() if k not in target} or r)
                existing._rls_check = update_check
                existing.save()
                changed.append(existing)
            else:
                obj = _make(model, r)
                remember(obj)
                obj._rls_check = insert_check
                obj.save(force_insert=True)
                changed.append(obj)
    elif action == 'update':
        values = req.get('values') or {}
        if not isinstance(values, dict) or not values:
            _err('Update needs an object', 'PGRST102')
        annotations = {}
        q = _filters(model, req.get('filters'), annotations)
        if not req.get('filters'):
            _err('UPDATE requires a WHERE clause', '21000')
        qs = model.objects.annotate(**annotations) if annotations else model.objects.all()
        targets = list(qs.filter(rules.select(a)).filter(rules.update(a)).filter(q))
        for obj in targets:
            remember(obj)
        for obj in targets:
            _apply(obj, values)
            obj._rls_check = update_check
            obj.save()
            changed.append(obj)
    else:  # delete
        annotations = {}
        q = _filters(model, req.get('filters'), annotations)
        if not req.get('filters'):
            _err('DELETE requires a WHERE clause', '21000')
        qs = model.objects.annotate(**annotations) if annotations else model.objects.all()
        targets = list(qs.filter(rules.select(a)).filter(rules.delete(a)).filter(q))
        snapshots = render(model, targets, items, a) if req.get('returning') else None
        for obj in targets:
            obj.delete()
        changed = targets

    if action != 'delete' and req.get('returning'):
        _check_visible(model, rules, changed, a)
    if not req.get('returning'):
        return None, (len(changed) if req.get('count') else None)
    if snapshots is not None:
        rows = snapshots
    else:
        rows = render(model, changed, items, a, embeds=False)
        for obj, row in zip(changed, rows):
            row.update(pre_embeds.get(id(obj), {}))
    return shape(rows, req), (len(rows) if req.get('count') else None)
