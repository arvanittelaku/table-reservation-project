"""bcrypt password hashes in the format Supabase Auth stored ($2a$, cost 10).

Uses the `bcrypt` package (in requirements.txt). Only if it is missing (e.g. a
sandbox without native wheels) does it fall back to Postgres' pgcrypto, which
produces and checks the same format.
"""
import hmac

try:
    import bcrypt as _bcrypt
except ImportError:  # pragma: no cover - depends on the environment
    _bcrypt = None

COST = 10


def hash_password(password):
    if _bcrypt is not None:
        h = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(COST)).decode()
        return '$2a$' + h[4:] if h.startswith('$2b$') else h
    return _pg('SELECT extensions.crypt(%s, extensions.gen_salt(%s, %s))', [password, 'bf', COST])


def check_password(password, hashed):
    if not hashed or not password:
        return False
    if _bcrypt is not None:
        try:
            return _bcrypt.checkpw(password.encode(), hashed.encode())
        except ValueError:
            return False
    computed = _pg('SELECT extensions.crypt(%s, %s)', [password, hashed])
    return bool(computed) and hmac.compare_digest(computed, hashed)


def _pg(sql, params):
    from django.db import connection
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()[0]
