"""Errors in the shape PostgREST returned ({message, code, details, hint}),
and the translation of database errors (constraint violations etc.) into it."""


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
