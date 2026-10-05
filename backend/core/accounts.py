"""Accounts, sessions and one-time email links (what Supabase Auth did).

Accounts stay in auth.users (model ejb.AuthUser) with the same ids, emails,
metadata and bcrypt hashes, so existing users sign in unchanged. Creating an
account creates its profile through the model hook (formerly a trigger).
"""
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.utils import timezone

from ejb.models import AuthToken, AuthUser, Identity, RefreshToken

from . import passwords
from .tokens import hash_token, issue_access_token, new_random_token, refresh_expiry


def normalize_email(email):
    return (email or '').strip().lower()


def get_user_by_id(user_id):
    try:
        return AuthUser.objects.filter(pk=user_id, deleted_at__isnull=True).first()
    except (ValueError, TypeError):
        return None


def get_user_by_email(email):
    email = normalize_email(email)
    if not email:
        return None
    return AuthUser.objects.filter(email__iexact=email, deleted_at__isnull=True).first()


def _iso(v):
    return v.isoformat() if v else None


def identities_json(user):
    out = []
    for i in Identity.objects.filter(user_id=user.id).order_by('created_at'):
        out.append({
            'identity_id': str(i.id), 'id': i.provider_id, 'user_id': str(i.user_id),
            'identity_data': i.identity_data, 'provider': i.provider, 'provider_id': i.provider_id,
            'last_sign_in_at': _iso(i.last_sign_in_at), 'created_at': _iso(i.created_at),
            'updated_at': _iso(i.updated_at), 'email': i.email,
        })
    return out


def user_json(user):
    """The user object the app expects (Supabase Auth's shape)."""
    return {
        'id': str(user.id),
        'aud': user.aud or 'authenticated',
        'role': user.role or 'authenticated',
        'email': user.email,
        'email_confirmed_at': _iso(user.email_confirmed_at),
        'confirmed_at': _iso(user.email_confirmed_at),
        'last_sign_in_at': _iso(user.last_sign_in_at),
        'phone': user.phone or '',
        'app_metadata': user.raw_app_meta_data or {},
        'user_metadata': user.raw_user_meta_data or {},
        'identities': identities_json(user),
        'created_at': _iso(user.created_at),
        'updated_at': _iso(user.updated_at),
        'is_anonymous': bool(user.is_anonymous),
    }


def create_user(email, password, user_metadata, provider='email', confirmed=False, identity_data=None,
                provider_id=None):
    now = timezone.now()
    email = normalize_email(email)
    user = AuthUser(
        id=uuid.uuid4(), instance_id=uuid.UUID(int=0), aud='authenticated', role='authenticated',
        email=email, encrypted_password=passwords.hash_password(password) if password else '',
        raw_app_meta_data={'provider': provider, 'providers': [provider]},
        raw_user_meta_data=user_metadata or {}, email_confirmed_at=now if confirmed else None,
        created_at=now, updated_at=now)
    user.save(force_insert=True)          # hook: creates the profile
    data = identity_data or {'sub': str(user.id), 'email': email, 'email_verified': confirmed,
                             'phone_verified': False}
    Identity(provider_id=provider_id or str(user.id), user=user, identity_data=data, provider=provider,
             last_sign_in_at=now, email=email).save(force_insert=True)
    return user


def check_password(user, password):
    return passwords.check_password(password or '', user.encrypted_password)


def set_password(user, password):
    user.encrypted_password = passwords.hash_password(password)
    user.updated_at = timezone.now()
    user.save(update_fields=['encrypted_password', 'updated_at'])


def is_banned(user):
    return bool(user.banned_until and user.banned_until > timezone.now())


# ───────────── sessions ─────────────

def start_session(user, touch_sign_in=True):
    if touch_sign_in:
        user.last_sign_in_at = timezone.now()
        user.save(update_fields=['last_sign_in_at'])
    access, exp = issue_access_token(user)
    refresh = new_random_token(32)
    RefreshToken(token_hash=hash_token(refresh), user=user, expires_at=refresh_expiry()).save(force_insert=True)
    return {
        'access_token': access,
        'token_type': 'bearer',
        'expires_in': settings.JWT_ACCESS_TTL,
        'expires_at': exp,
        'refresh_token': refresh,
        'user': user_json(user),
    }


def rotate_refresh_token(raw):
    now = timezone.now()
    rt = (RefreshToken.objects.select_for_update()
          .filter(token_hash=hash_token(raw or ''), revoked_at__isnull=True, expires_at__gt=now).first())
    if rt is None:
        return None
    rt.revoked_at = now
    rt.save(update_fields=['revoked_at'])
    user = get_user_by_id(rt.user_id)
    if not user or is_banned(user):
        return None
    return start_session(user, touch_sign_in=False)


def revoke_all_sessions(user_id):
    RefreshToken.objects.filter(user_id=user_id, revoked_at__isnull=True).update(revoked_at=timezone.now())


# ───────────── one-time email links ─────────────

def safe_redirect(url):
    """Only redirect to the app itself (or explicitly allowed origins)."""
    if url:
        for allowed in settings.AUTH_REDIRECT_ALLOWLIST:
            base = allowed.rstrip('/')
            if url == allowed or url.startswith(base + '/') or url.startswith(base + '#') or url.startswith(base + '?'):
                return url
    return settings.SITE_URL


def create_email_link(user, kind, redirect_to):
    raw = new_random_token(32)
    now = timezone.now()
    AuthToken(token_hash=hash_token(raw), user=user, kind=kind, redirect_to=safe_redirect(redirect_to),
              expires_at=now + timedelta(seconds=settings.AUTH_LINK_TTL)).save(force_insert=True)
    if kind == 'signup':
        user.confirmation_sent_at = now
        user.save(update_fields=['confirmation_sent_at'])
    else:
        user.recovery_sent_at = now
        user.save(update_fields=['recovery_sent_at'])
    return f"{settings.API_URL}/auth/v1/verify?{urlencode({'token': raw, 'type': kind})}"


def consume_email_link(raw, kind):
    """Returns (user, redirect_to) or (None, redirect_to_or_None)."""
    tok = AuthToken.objects.select_for_update().filter(token_hash=hash_token(raw or ''), kind=kind).first()
    if tok is None:
        return None, None
    now = timezone.now()
    if tok.used_at or tok.expires_at < now:
        return None, tok.redirect_to
    tok.used_at = now
    tok.save(update_fields=['used_at'])
    user = get_user_by_id(tok.user_id)
    if user and kind == 'signup':
        if user.email_confirmed_at is None:
            user.email_confirmed_at = now
        user.updated_at = now
        user.save(update_fields=['email_confirmed_at', 'updated_at'])
        for ident in Identity.objects.filter(user_id=user.id, provider='email'):
            ident.identity_data = {**(ident.identity_data or {}), 'email_verified': True}
            ident.save(update_fields=['identity_data'])
    return user, tok.redirect_to


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
