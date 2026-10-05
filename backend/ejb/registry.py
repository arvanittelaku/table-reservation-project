"""Tables the app's API may touch, mapped to models, plus JSON output that
matches what Postgres' row_to_json produced (so the app sees identical data)."""
import datetime
import decimal
import uuid
from functools import lru_cache

from django.apps import apps
from django.db import models


def _short(db_table):
    return db_table.split('"."')[-1]


@lru_cache(maxsize=None)
def public_tables():
    out = {}
    for m in apps.get_app_config('ejb').get_models():
        if '"."' in m._meta.db_table:      # auth.* / backend.* are never exposed
            continue
        out[m._meta.db_table] = m
    return out


def model_for(table):
    return public_tables().get(table)


def table_name(model):
    return _short(model._meta.db_table)


@lru_cache(maxsize=None)
def column_fields(model):
    """column name -> concrete field, in table order."""
    return {f.column: f for f in model._meta.concrete_fields if f.column}


def field_for(model, column):
    return column_fields(model).get(column)


@lru_cache(maxsize=None)
def pk_columns(model):
    pk = model._meta.pk
    if isinstance(pk, models.CompositePrimaryKey):
        return [f.column for f in pk.fields]
    return [pk.column]


def to_json(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() and v.as_tuple().exponent >= 0 else float(v)
    if isinstance(v, datetime.datetime):
        return pg_timestamp(v)
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, datetime.time):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (list, tuple)):
        return [to_json(x) for x in v]
    if isinstance(v, dict):
        return {k: to_json(x) for k, x in v.items()}
    return str(v)


def pg_timestamp(dt):
    """Postgres JSON form: 2026-10-04T19:59:37.7128+00:00 (no trailing zeros)."""
    if dt.tzinfo is None:
        s = dt.isoformat()
        tail = ''
    else:
        dt = dt.astimezone(datetime.timezone.utc)
        s = dt.replace(tzinfo=None).isoformat()
        tail = '+00:00'
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return s + tail


def row_json(obj, columns=None):
    """A model instance as Postgres row JSON, keyed by column name."""
    fields = column_fields(type(obj))
    cols = columns or list(fields)
    return {c: to_json(getattr(obj, fields[c].attname)) for c in cols}
