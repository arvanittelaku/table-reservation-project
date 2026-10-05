"""Access tokens (JWT, 1 hour) and refresh tokens (random, stored hashed)."""
import hashlib
import secrets
import time
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone

ALGORITHM = 'HS256'
AUDIENCE = 'authenticated'


class TokenError(Exception):
    pass


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def new_random_token(nbytes=32):
    return secrets.token_urlsafe(nbytes)


def issue_access_token(user):
    now = int(time.time())
    claims = {
        'sub': str(user.id),
        'email': user.email or '',
        'role': 'authenticated',
        'aud': AUDIENCE,
        'iat': now,
        'exp': now + settings.JWT_ACCESS_TTL,
        'app_metadata': user.raw_app_meta_data or {},
        'user_metadata': user.raw_user_meta_data or {},
    }
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=ALGORITHM), claims['exp']


def decode_access_token(token):
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM], audience=AUDIENCE)
    except jwt.ExpiredSignatureError:
        raise TokenError('JWT expired')
    except jwt.InvalidTokenError:
        raise TokenError('Invalid JWT')
    if claims.get('role') != 'authenticated' or not claims.get('sub'):
        raise TokenError('Invalid JWT')
    return {'sub': claims['sub'], 'email': claims.get('email', ''), 'role': 'authenticated', 'aud': AUDIENCE}


def refresh_expiry():
    return timezone.now() + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS)


def sign_state(payload, max_age=600):
    """Short-lived signed blob (OAuth state)."""
    data = dict(payload, exp=int(time.time()) + max_age)
    return jwt.encode(data, settings.JWT_SECRET, algorithm=ALGORITHM)


def read_state(token):
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        raise TokenError('Invalid or expired state')
