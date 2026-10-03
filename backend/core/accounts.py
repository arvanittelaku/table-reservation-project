"""Accounts live in auth.users, exactly where Supabase Auth kept them.

Same ids, emails, metadata and bcrypt password hashes, so existing users sign
in unchanged and the database trigger that creates profiles keeps firing.
Passwords are hashed and checked inside Postgres (pgcrypto's crypt(), the same
$2a$ bcrypt format Supabase uses); they are never logged or returned.
"""
import json
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.utils import timezone

from .db import fetch_dict, fetch_one
from .tokens import hash_token, issue_access_token, new_random_token, refresh_expiry

USER_COLUMNS = (
    'id, aud, role, email, email_confirmed_at, confirmed_at, last_sign_in_at, '
    'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until, phone, is_anonymous'
)


def normalize_email(email):
    return (email or '').strip().lower()


def get_user_by_id(cur, user_id):
    return fetch_dict(cur, f'SELECT {USER_COLUMNS} FROM auth.users WHERE id = %s AND deleted_at IS NULL', [user_id])


def get_user_by_email(cur, email):
    return fetch_dict(cur, f'SELECT {USER_COLUMNS} FROM auth.users WHERE lower(email) = %s AND deleted_at IS NULL',
                      [normalize_email(email)])


def identities_of(cur, user_id):
    cur.execute(
        'SELECT id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at, email '
        'FROM auth.identities WHERE user_id = %s ORDER BY created_at', [user_id])
    cols = [c.name for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in rows:
        r['identity_id'] = str(r['id'])
        r['id'] = r['provider_id']
        r['user_id'] = str(r['user_id'])
        for k in ('last_sign_in_at', 'created_at', 'updated_at'):
            r[k] = _iso(r[k])
    return rows


def _iso(v):
    return v.isoformat() if v else None


def user_json(cur, user):
    """The user object the app expects (Supabase Auth's shape)."""
    return {
        'id': str(user['id']),
        'aud': user.get('aud') or 'authenticated',
        'role': user.get('role') or 'authenticated',
        'email': user.get('email'),
        'email_confirmed_at': _iso(user.get('email_confirmed_at')),
        'confirmed_at': _iso(user.get('confirmed_at') or user.get('email_confirmed_at')),
        'last_sign_in_at': _iso(user.get('last_sign_in_at')),
        'phone': user.get('phone') or '',
        'app_metadata': user.get('raw_app_meta_data') or {},
        'user_metadata': user.get('raw_user_meta_data') or {},
        'identities': identities_of(cur, user['id']),
        'created_at': _iso(user.get('created_at')),
        'updated_at': _iso(user.get('updated_at')),
        'is_anonymous': bool(user.get('is_anonymous')),
    }


def create_user(cur, email, password, user_metadata, provider='email', confirmed=False, identity_data=None, provider_id=None):
    user_id = str(uuid.uuid4())
    email = normalize_email(email)
    app_meta = {'provider': provider, 'providers': [provider]}
    pw_sql = "extensions.crypt(%s, extensions.gen_salt('bf', 10))" if password else "''"
    params = [user_id, email]
    if password:
        params.append(password)
    params += [json.dumps(app_meta), json.dumps(user_metadata or {}), confirmed]
    cur.execute(
        f"INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data,"
        f" raw_user_meta_data, email_confirmed_at, created_at, updated_at)"
        f" VALUES ('00000000-0000-0000-0000-000000000000', %s, 'authenticated', 'authenticated', %s, {pw_sql},"
        f" %s::jsonb, %s::jsonb, CASE WHEN %s THEN now() END, now(), now())",
        params,
    )
    data = identity_data or {'sub': user_id, 'email': email, 'email_verified': confirmed, 'phone_verified': False}
    cur.execute(
        'INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, email)'
        ' VALUES (%s, %s, %s::jsonb, %s, now(), %s)',
        [provider_id or user_id, user_id, json.dumps(data), provider, email],
    )
    return get_user_by_id(cur, user_id)


def check_password(cur, user_id, password):
    return bool(fetch_one(
        cur,
        "SELECT encrypted_password IS NOT NULL AND encrypted_password <> ''"
        " AND encrypted_password = extensions.crypt(%s, encrypted_password) FROM auth.users WHERE id = %s",
        [password or '', user_id],
    ))


def set_password(cur, user_id, password):
    cur.execute(
        "UPDATE auth.users SET encrypted_password = extensions.crypt(%s, extensions.gen_salt('bf', 10)),"
        " updated_at = now() WHERE id = %s", [password, user_id])


def is_banned(user):
    until = user.get('banned_until')
    return bool(until and until > timezone.now())


# ───────────── sessions ─────────────

def start_session(cur, user, touch_sign_in=True):
    if touch_sign_in:
        cur.execute('UPDATE auth.users SET last_sign_in_at = now() WHERE id = %s', [user['id']])
        user = get_user_by_id(cur, user['id'])
    access, exp = issue_access_token(user)
    refresh = new_random_token(32)
    cur.execute('INSERT INTO backend.refresh_tokens (token_hash, user_id, expires_at) VALUES (%s, %s, %s)',
                [hash_token(refresh), user['id'], refresh_expiry()])
    return {
        'access_token': access,
        'token_type': 'bearer',
        'expires_in': settings.JWT_ACCESS_TTL,
        'expires_at': exp,
        'refresh_token': refresh,
        'user': user_json(cur, user),
    }


def rotate_refresh_token(cur, raw):
    row = fetch_dict(
        cur,
        'UPDATE backend.refresh_tokens SET revoked_at = now()'
        ' WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > now() RETURNING user_id',
        [hash_token(raw or '')])
    if not row:
        return None
    user = get_user_by_id(cur, row['user_id'])
    if not user or is_banned(user):
        return None
    return start_session(cur, user, touch_sign_in=False)


def revoke_all_sessions(cur, user_id):
    cur.execute('UPDATE backend.refresh_tokens SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL',
                [user_id])


# ───────────── one-time email links ─────────────

def safe_redirect(url):
    """Only redirect to the app itself (or explicitly allowed origins)."""
    if url:
        for allowed in settings.AUTH_REDIRECT_ALLOWLIST:
            if url == allowed or url.startswith(allowed.rstrip('/') + '/') or url.startswith(allowed.rstrip('/') + '#') \
                    or url.startswith(allowed.rstrip('/') + '?'):
                return url
    return settings.SITE_URL


def create_email_link(cur, user_id, kind, redirect_to):
    raw = new_random_token(32)
    cur.execute(
        'INSERT INTO backend.auth_tokens (token_hash, user_id, kind, redirect_to, expires_at) VALUES (%s, %s, %s, %s, %s)',
        [hash_token(raw), user_id, kind, safe_redirect(redirect_to),
         timezone.now() + timedelta(seconds=settings.AUTH_LINK_TTL)])
    column = 'confirmation_sent_at' if kind == 'signup' else 'recovery_sent_at'
    cur.execute(f'UPDATE auth.users SET {column} = now() WHERE id = %s', [user_id])
    return f"{settings.API_URL}/auth/v1/verify?{urlencode({'token': raw, 'type': kind})}"


def consume_email_link(cur, raw, kind):
    """Returns (user, redirect_to) or (None, redirect_to_or_None)."""
    row = fetch_dict(cur, 'SELECT user_id, redirect_to, expires_at, used_at FROM backend.auth_tokens'
                          ' WHERE token_hash = %s AND kind = %s', [hash_token(raw or ''), kind])
    if not row:
        return None, None
    if row['used_at'] or row['expires_at'] < timezone.now():
        return None, row['redirect_to']
    cur.execute('UPDATE backend.auth_tokens SET used_at = now() WHERE token_hash = %s', [hash_token(raw)])
    if kind == 'signup':
        cur.execute('UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()),'
                    ' updated_at = now() WHERE id = %s', [row['user_id']])
        cur.execute("UPDATE auth.identities SET identity_data = identity_data || '{\"email_verified\": true}'::jsonb"
                    " WHERE user_id = %s AND provider = 'email'", [row['user_id']])
    return get_user_by_id(cur, row['user_id']), row['redirect_to']


def session_fragment(session, kind):
    return urlencode({
        'access_token': session['access_token'],
        'expires_at': session['expires_at'],
        'expires_in': session['expires_in'],
        'refresh_token': session['refresh_token'],
        'token_type': 'bearer',
        'type': kind,
    })


def error_fragment(code='otp_expired', description='Email link is invalid or has expired'):
    return urlencode({'error': 'access_denied', 'error_code': code, 'error_description': description})
