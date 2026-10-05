"""LEGACY (dev only): the old way of running app requests, kept so
dev/difftest.py can compare the Python port with the original SQL version.
Runs the request as Postgres role authenticated/anon with Supabase's JWT
settings, so the old row-level security and SQL functions decide."""
import json
from contextlib import contextmanager

from django.db import connection, transaction
from psycopg.types.json import JsonbLoader, JsonLoader

from core.db import DbError, db_error_from


def _parse_json(cur):
    raw = getattr(cur, 'cursor', cur)
    raw.adapters.register_loader('jsonb', JsonbLoader)
    raw.adapters.register_loader('json', JsonLoader)


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




def _is_db_exception(exc):
    from django.db import Error as DjangoDbError
    try:
        import psycopg
        return isinstance(exc, (DjangoDbError, psycopg.Error))
    except ImportError:  # pragma: no cover
        return isinstance(exc, DjangoDbError)
