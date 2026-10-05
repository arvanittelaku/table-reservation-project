"""Errors carried to the app in the shape PostgREST used ({message, code, details, hint}).

The app shows many of these messages to users (Albanian texts from the old SQL
functions), so services raise them with the exact same wording and codes.
"""
from core.db import DbError


class ApiError(DbError):
    pass


def fail(message, code='P0001', status=None, details=None, hint=None):
    """RAISE EXCEPTION '<message>' [USING ERRCODE = code]."""
    raise ApiError(message, code, details, hint, status or _status(code))


def _status(code):
    return {'42501': 403, '23505': 409, '23503': 409, '23514': 400, '22023': 400,
            'P0002': 404, '28000': 403}.get(code, 400)


def rls_violation(table, anonymous=False):
    raise ApiError(f'new row violates row-level security policy for table "{table}"', '42501',
                   status=401 if anonymous else 403)


def permission_denied(what, anonymous=False):
    raise ApiError(f'permission denied for {what}', '42501', status=401 if anonymous else 403)
