"""Database access: every app request runs as the signed-in user.

`as_user(claims)` opens a transaction, sets the same request settings Supabase's
API sets (request.jwt.claims / claim.sub / claim.role) and switches to the
`authenticated` (or `anon`) role. auth.uid(), every row-level policy and every
SECURITY DEFINER function therefore behave exactly as before.
"""
import json
from contextlib import contextmanager

from django.db import connection, transaction
from psycopg.types.json import JsonbLoader, JsonLoader


def _parse_json(cur):
    """Django leaves jsonb as text for its ORM; this API wants real objects."""
    raw = getattr(cur, 'cursor', cur)
    raw.adapters.register_loader('jsonb', JsonbLoader)
    raw.adapters.register_loader('json', JsonLoader)


class DbError(Exception):
    """A Postgres error, carried to the client in PostgREST's shape."""

    def __init__(self, message, code=None, details=None, hint=None, status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details
        self.hint = hint
        self.status = status

    def as_dict(self):
        return {'message': self.message, 'code': self.code, 'details': self.details, 'hint': self.hint}


# SQLSTATE -> HTTP status, as PostgREST maps them.
_STATUS = {
    '23503': 409, '23505': 409, '23514': 400, '23502': 400, '22P02': 400,
    '42501': 403, '42883': 404, '42P01': 404, '42703': 400, 'P0001': 400, 'PGRST116': 406,
}


def db_error_from(exc, anonymous=False):
    cause = getattr(exc, '__cause__', None) or exc
    diag = getattr(cause, 'diag', None)
    code = getattr(cause, 'sqlstate', None) or (getattr(diag, 'sqlstate', None) if diag else None)
    message = (getattr(diag, 'message_primary', None) if diag else None) or str(cause).split('\n')[0]
    details = getattr(diag, 'message_detail', None) if diag else None
    hint = getattr(diag, 'message_hint', None) if diag else None
    status = _STATUS.get(code, 400)
    if code == '42501' and anonymous:
        status = 401
    return DbError(message, code, details, hint, status)


@contextmanager
def as_user(claims):
    """claims: dict with 'sub', 'email', 'role' for a signed-in user, or None."""
    role = 'authenticated' if claims else 'anon'
    jwt_claims = claims or {'role': 'anon'}
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                _parse_json(cur)
                cur.execute(
                    "SELECT set_config('request.jwt.claims', %s, true),"
                    " set_config('request.jwt.claim.sub', %s, true),"
                    " set_config('request.jwt.claim.role', %s, true),"
                    " set_config('request.jwt.claim.email', %s, true)",
                    [json.dumps(jwt_claims), (claims or {}).get('sub', ''), role, (claims or {}).get('email', '')],
                )
                cur.execute('SET LOCAL ROLE ' + role)
                yield cur
    except DbError:
        raise
    except Exception as exc:  # psycopg / Django DB errors
        if _is_db_exception(exc):
            raise db_error_from(exc, anonymous=claims is None) from exc
        raise


@contextmanager
def as_service():
    """Backend-internal work (auth, jobs): the connection's own role, no RLS."""
    with transaction.atomic():
        with connection.cursor() as cur:
            _parse_json(cur)
            yield cur


def _is_db_exception(exc):
    from django.db import Error as DjangoDbError
    try:
        import psycopg
        return isinstance(exc, (DjangoDbError, psycopg.Error))
    except ImportError:  # pragma: no cover
        return isinstance(exc, DjangoDbError)


def fetch_one(cur, sql, params=None):
    cur.execute(sql, params or [])
    row = cur.fetchone()
    return row[0] if row else None


def fetch_dict(cur, sql, params=None):
    cur.execute(sql, params or [])
    row = cur.fetchone()
    if row is None:
        return None
    cols = [c.name for c in cur.description]
    return dict(zip(cols, row))
