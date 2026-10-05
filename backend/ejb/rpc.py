"""Registry and dispatcher for server functions (/rest/v1/rpc/<name>).

    @rpc('request_join')
    def request_join(p_table: UUID) -> UUID: ...

    @rpc('table_share_preview', anon=True)   # callable without signing in

Arguments are passed by name like PostgREST did: unknown names or a missing
required argument give PGRST202; values are converted using the annotations
(UUID, int, float, bool, str, datetime, date, list[str], dict/JSON).
Functions run as the signed-in user (context.actor()) and return JSON-ready
data: a value, a dict, a list of dicts (set-returning functions) or None.
"""
import datetime
import inspect
import typing
import uuid
from dataclasses import dataclass

from django.utils.dateparse import parse_date, parse_datetime

from django.db import DatabaseError

from core.db import DbError, db_error_from

from . import context
from .errors import permission_denied
from .registry import to_json

REGISTRY = {}


@dataclass
class Spec:
    name: str
    fn: typing.Callable
    anon: bool
    params: list          # [(name, annotation, has_default)]


def rpc(name, anon=False):
    def deco(fn):
        sig = inspect.signature(fn)
        hints = typing.get_type_hints(fn)
        params = [(p.name, hints.get(p.name, str), p.default is not inspect.Parameter.empty)
                  for p in sig.parameters.values()]
        REGISTRY[name] = Spec(name, fn, anon, params)
        return fn
    return deco


def _bad(value, typ):
    raise DbError(f'invalid input syntax for type {typ}: "{value}"', '22P02', status=400)


def convert(value, ann):
    if value is None:
        return None
    origin = typing.get_origin(ann)
    if origin in (typing.Union, getattr(__import__('types'), 'UnionType', object)):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        return convert(value, args[0]) if args else value
    if origin is list:
        (inner,) = typing.get_args(ann) or (str,)
        if isinstance(value, str):
            s = value.strip()
            if s.startswith('{') and s.endswith('}'):
                value = [v.strip().strip('"') for v in s[1:-1].split(',')] if s[1:-1] else []
            else:
                _bad(value, 'array')
        if not isinstance(value, list):
            _bad(value, 'array')
        return [convert(v, inner) for v in value]
    if ann is uuid.UUID:
        try:
            return uuid.UUID(str(value))
        except ValueError:
            _bad(value, 'uuid')
    if ann is bool:
        if isinstance(value, bool):
            return value
        s = str(value).strip().lower()
        if s in ('true', 't', '1', 'yes', 'on'):
            return True
        if s in ('false', 'f', '0', 'no', 'off'):
            return False
        _bad(value, 'boolean')
    if ann is int:
        if isinstance(value, bool):
            _bad(value, 'integer')
        try:
            if isinstance(value, float) and not value.is_integer():
                return int(round(value))
            return int(str(value).strip())
        except ValueError:
            _bad(value, 'integer')
    if ann is float:
        try:
            return float(value)
        except (TypeError, ValueError):
            _bad(value, 'double precision')
    if ann is datetime.datetime:
        if isinstance(value, datetime.datetime):
            return value
        dt = parse_datetime(str(value).replace(' ', 'T', 1)) if isinstance(value, str) else None
        if dt is None:
            d = parse_date(str(value)) if isinstance(value, str) else None
            if d is None:
                _bad(value, 'timestamp with time zone')
            dt = datetime.datetime(d.year, d.month, d.day)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    if ann is datetime.date:
        d = parse_date(str(value)) if isinstance(value, str) else None
        if d is None:
            _bad(value, 'date')
        return d
    if ann is str:
        if isinstance(value, (dict, list)):
            import json
            return json.dumps(value)
        if isinstance(value, bool):
            return 'true' if value else 'false'
        return str(value)
    return value   # dict / JSON / anything else


def call(name, args):
    if not isinstance(args, dict):
        raise DbError('Function arguments must be an object', 'PGRST102', status=400)
    spec = REGISTRY.get(name)
    keys = set(args)
    if spec is not None:
        names = [p[0] for p in spec.params]
        required = {p[0] for p in spec.params if not p[2]}
        if not keys <= set(names) or not required <= keys:
            spec = None
    if spec is None:
        raise DbError(f'Could not find the function public.{name}({", ".join(sorted(keys))}) in the schema cache',
                      'PGRST202', status=404)
    a = context.actor()
    if a.uid is None and not spec.anon:
        permission_denied(f'function {name}', anonymous=True)
    kwargs = {n: convert(args[n], ann) for n, ann, _ in spec.params if n in args}
    try:
        return to_json(spec.fn(**kwargs))
    except DbError:
        raise
    except DatabaseError as exc:   # constraint violations etc.: same error Postgres raised before
        raise db_error_from(exc, anonymous=a.uid is None) from exc
