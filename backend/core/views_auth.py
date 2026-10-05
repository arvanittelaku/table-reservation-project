"""Auth endpoints (replacing Supabase Auth), under /auth/v1/.

Same behaviour the app relies on: email + password with confirmation emails,
password reset links, Google/Apple sign-in, 1-hour access tokens with rotating
refresh tokens, and email links that return to the app with the session (or an
"otp_expired" error) in the URL fragment.
"""
import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode

import jwt
import requests
from django.conf import settings
from django.http import HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.db import transaction
from django.utils import timezone

from ejb import jobs
from ejb.models import Identity

from . import accounts as acc
from .http import BadRequest, bearer_claims, error_response, json_body, ok, rate_limit
from .tokens import TokenError, read_state, sign_state


def enqueue(kind, payload):
    jobs.enqueue(kind, payload)


def _handle(fn):
    def wrapper(request, *args, **kwargs):
        try:
            return fn(request, *args, **kwargs)
        except BadRequest as exc:
            return error_response(exc.message, exc.status, exc.code)
    wrapper.__name__ = fn.__name__
    return csrf_exempt(wrapper)


def _valid_email(email):
    return bool(email) and '@' in email and '.' in email.split('@')[-1] and len(email) <= 254 and ' ' not in email


def _check_password_rules(password):
    if not password or len(password) < settings.AUTH_MIN_PASSWORD:
        raise BadRequest(f'Password should be at least {settings.AUTH_MIN_PASSWORD} characters.',
                         422, 'weak_password')


@_handle
@require_http_methods(['POST'])
def signup(request):
    rate_limit(request, 'signup')
    body = json_body(request)
    email = acc.normalize_email(body.get('email'))
    password = body.get('password') or ''
    options = body.get('options') or {}
    if not _valid_email(email):
        raise BadRequest('Unable to validate email address: invalid format', 400, 'validation_failed')
    _check_password_rules(password)
    with transaction.atomic():
        existing = acc.get_user_by_email(email)
        if existing:
            raise BadRequest('User already registered', 422, 'user_already_exists')
        confirmed = not settings.AUTH_EMAIL_CONFIRM
        user = acc.create_user(email, password, options.get('data') or {}, confirmed=confirmed)
        if confirmed:
            session = acc.start_session(user)
            return ok({'user': session['user'], 'session': session})
        link = acc.create_email_link(user, 'signup', options.get('emailRedirectTo'))
        enqueue('auth-email', {'kind': 'signup', 'email': email, 'link': link})
        return ok({'user': acc.user_json(user), 'session': None})


@_handle
@require_http_methods(['POST'])
def token(request):
    grant = request.GET.get('grant_type')
    body = json_body(request)
    if grant == 'password':
        rate_limit(request, 'login')
        email = acc.normalize_email(body.get('email'))
        password = body.get('password') or ''
        with transaction.atomic():
            user = acc.get_user_by_email(email)
            if not user or not acc.check_password(user, password):
                raise BadRequest('Invalid login credentials', 400, 'invalid_credentials')
            if acc.is_banned(user):
                raise BadRequest('User is banned', 400, 'user_banned')
            if settings.AUTH_EMAIL_CONFIRM and not user.email_confirmed_at:
                raise BadRequest('Email not confirmed', 400, 'email_not_confirmed')
            return ok(acc.start_session(user))
    if grant == 'refresh_token':
        with transaction.atomic():
            session = acc.rotate_refresh_token(body.get('refresh_token'))
            if not session:
                raise BadRequest('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found')
            return ok(session)
    raise BadRequest('Unsupported grant_type', 400, 'validation_failed')


@_handle
@require_http_methods(['POST'])
def logout(request):
    claims = bearer_claims(request, required=True)
    acc.revoke_all_sessions(claims['sub'])
    return ok({})


@_handle
@require_http_methods(['GET', 'PUT'])
def user(request):
    claims = bearer_claims(request, required=True)
    with transaction.atomic():
        u = acc.get_user_by_id(claims['sub'])
        if not u:
            raise BadRequest('User from sub claim in JWT does not exist', 403, 'user_not_found')
        if acc.is_banned(u):
            raise BadRequest('User is banned', 403, 'user_banned')
        if request.method == 'PUT':
            body = json_body(request)
            if 'password' in body:
                _check_password_rules(body['password'])
                acc.set_password(u, body['password'])
            if isinstance(body.get('data'), dict):
                u.raw_user_meta_data = {**(u.raw_user_meta_data or {}), **body['data']}
                u.updated_at = timezone.now()
                u.save(update_fields=['raw_user_meta_data', 'updated_at'])
            u = acc.get_user_by_id(u.id)
        return ok(acc.user_json(u))


@_handle
@require_http_methods(['POST'])
def recover(request):
    rate_limit(request, 'recover', limit=5)
    body = json_body(request)
    email = acc.normalize_email(body.get('email'))
    with transaction.atomic():
        u = acc.get_user_by_email(email) if _valid_email(email) else None
        if u and not acc.is_banned(u):
            link = acc.create_email_link(u, 'recovery', body.get('redirect_to') or request.GET.get('redirect_to'))
            enqueue('auth-email', {'kind': 'recovery', 'email': u.email, 'link': link})
    return ok({})  # same answer whether or not the email exists


@_handle
@require_http_methods(['POST'])
def resend(request):
    rate_limit(request, 'resend', limit=5)
    body = json_body(request)
    if body.get('type') != 'signup':
        raise BadRequest('Unsupported resend type', 400, 'validation_failed')
    email = acc.normalize_email(body.get('email'))
    with transaction.atomic():
        u = acc.get_user_by_email(email)
        if u and not u.email_confirmed_at:
            redirect = (body.get('options') or {}).get('emailRedirectTo')
            link = acc.create_email_link(u, 'signup', redirect)
            enqueue('auth-email', {'kind': 'signup', 'email': u.email, 'link': link})
    return ok({})


@csrf_exempt
@require_http_methods(['GET'])
def verify(request):
    """Email links land here, then return to the app like Supabase did."""
    kind = request.GET.get('type')
    raw = request.GET.get('token', '')
    if kind not in ('signup', 'recovery'):
        return HttpResponseRedirect(f'{settings.SITE_URL}/#{acc.error_fragment("validation_failed", "Invalid link")}')
    with transaction.atomic():
        user, redirect_to = acc.consume_email_link(raw, kind)
        target = acc.safe_redirect(redirect_to)
        if not user or acc.is_banned(user):
            return HttpResponseRedirect(f'{target.split("#")[0]}#{acc.error_fragment()}')
        session = acc.start_session(user)
    return HttpResponseRedirect(f'{target.split("#")[0]}#{acc.session_fragment(session, kind)}')


@csrf_exempt
@require_http_methods(['GET'])
def auth_settings(request):
    """Which sign-in methods are configured (the app hides/blocks the others)."""
    google = settings.OAUTH['google']
    apple = settings.OAUTH['apple']
    return ok({
        'external': {
            'email': True,
            'google': bool(google['client_id'] and google['client_secret']),
            'apple': bool(apple['client_id'] and apple['team_id'] and apple['key_id'] and apple['private_key']),
        },
        'mailer_autoconfirm': not settings.AUTH_EMAIL_CONFIRM,
    })


# ───────────── Google / Apple ─────────────

def _pkce_pair():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    return verifier, challenge


@csrf_exempt
@require_http_methods(['GET'])
def authorize(request):
    provider = request.GET.get('provider', '')
    cfg = settings.OAUTH.get(provider)
    redirect_to = acc.safe_redirect(request.GET.get('redirect_to'))
    if not cfg or not cfg.get('client_id'):
        frag = urlencode({'error': 'bad_oauth_state', 'error_code': 'provider_disabled',
                          'error_description': 'Unsupported provider: provider is not enabled'})
        return HttpResponseRedirect(f'{redirect_to.split("#")[0]}#{frag}')
    verifier, challenge = _pkce_pair()
    state = sign_state({'p': provider, 'r': redirect_to, 'v': verifier, 'n': secrets.token_urlsafe(12)})
    params = {
        'client_id': cfg['client_id'],
        'redirect_uri': f'{settings.API_URL}/auth/v1/callback',
        'response_type': 'code',
        'scope': cfg['scope'],
        'state': state,
    }
    if provider == 'google':
        params.update({'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'})
    if provider == 'apple':
        params['response_mode'] = 'form_post'  # Apple requires form_post when asking for name/email
    return HttpResponseRedirect(f"{cfg['authorize_url']}?{urlencode(params)}")


def _apple_client_secret(cfg):
    now = int(time.time())
    return jwt.encode(
        {'iss': cfg['team_id'], 'iat': now, 'exp': now + 300, 'aud': 'https://appleid.apple.com', 'sub': cfg['client_id']},
        cfg['private_key'], algorithm='ES256', headers={'kid': cfg['key_id']})


def _exchange(provider, cfg, code, verifier):
    data = {'grant_type': 'authorization_code', 'code': code, 'client_id': cfg['client_id'],
            'redirect_uri': f'{settings.API_URL}/auth/v1/callback'}
    if provider == 'google':
        data.update({'client_secret': cfg['client_secret'], 'code_verifier': verifier})
    else:
        data['client_secret'] = _apple_client_secret(cfg)
    r = requests.post(cfg['token_url'], data=data, timeout=10)
    r.raise_for_status()
    return r.json()


def _identity(provider, cfg, tokens, posted_user):
    """Returns (provider_id, email, email_verified, identity_data)."""
    if provider == 'google':
        r = requests.get(cfg['userinfo_url'], headers={'Authorization': f"Bearer {tokens['access_token']}"}, timeout=10)
        r.raise_for_status()
        info = r.json()
        data = {
            'sub': info.get('sub'), 'email': info.get('email'), 'email_verified': bool(info.get('email_verified')),
            'name': info.get('name'), 'full_name': info.get('name'), 'given_name': info.get('given_name'),
            'family_name': info.get('family_name'), 'picture': info.get('picture'), 'avatar_url': info.get('picture'),
            'iss': 'https://accounts.google.com', 'provider_id': info.get('sub'),
        }
        return info.get('sub'), info.get('email'), bool(info.get('email_verified')), data
    # Apple: verify the id_token signature with Apple's published keys
    keys = jwt.PyJWKClient(cfg['jwks_url'])
    signing_key = keys.get_signing_key_from_jwt(tokens['id_token'])
    claims = jwt.decode(tokens['id_token'], signing_key.key, algorithms=['RS256'], audience=cfg['client_id'],
                        issuer='https://appleid.apple.com')
    name = (posted_user or {}).get('name') or {}  # Apple sends the name only on the first sign-in
    full = ' '.join(x for x in [name.get('firstName'), name.get('lastName')] if x) or None
    data = {
        'sub': claims['sub'], 'email': claims.get('email'),
        'email_verified': str(claims.get('email_verified')).lower() == 'true',
        'full_name': full, 'name': full, 'given_name': name.get('firstName'), 'family_name': name.get('lastName'),
        'iss': 'https://appleid.apple.com', 'provider_id': claims['sub'],
    }
    return claims['sub'], claims.get('email'), data['email_verified'], data


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def callback(request):
    src = request.POST if request.method == 'POST' else request.GET
    try:
        state = read_state(src.get('state', ''))
    except TokenError:
        return HttpResponseRedirect(f'{settings.SITE_URL}/#{acc.error_fragment("bad_oauth_state", "OAuth state expired")}')
    redirect_to = acc.safe_redirect(state.get('r'))
    base = redirect_to.split('#')[0]
    if src.get('error') or not src.get('code'):
        frag = urlencode({'error': 'access_denied', 'error_code': src.get('error') or 'access_denied',
                          'error_description': src.get('error_description') or 'Sign-in was cancelled'})
        return HttpResponseRedirect(f'{base}#{frag}')
    provider = state.get('p')
    cfg = settings.OAUTH.get(provider) or {}
    try:
        tokens = _exchange(provider, cfg, src['code'], state.get('v'))
        posted_user = json.loads(src['user']) if src.get('user') else None
        provider_id, email, verified, data = _identity(provider, cfg, tokens, posted_user)
    except Exception:
        frag = urlencode({'error': 'server_error', 'error_code': 'unexpected_failure',
                          'error_description': 'Sign-in with this provider failed'})
        return HttpResponseRedirect(f'{base}#{frag}')
    with transaction.atomic():
        session = _oauth_sign_in(provider, provider_id, email, verified, data)
    if session is None:
        return HttpResponseRedirect(f'{base}#{acc.error_fragment("user_banned", "User is banned")}')
    return HttpResponseRedirect(f'{base}#{acc.session_fragment(session, "signup")}')


def _oauth_sign_in(provider, provider_id, email, verified, data):
    now = timezone.now()
    ident = Identity.objects.filter(provider=provider, provider_id=provider_id).first()
    if ident is not None:
        user = acc.get_user_by_id(ident.user_id)
        ident.identity_data = data
        ident.last_sign_in_at = now
        ident.updated_at = now
        ident.save(update_fields=['identity_data', 'last_sign_in_at', 'updated_at'])
    else:
        user = acc.get_user_by_email(email) if (email and verified) else None
        if user:  # same verified email: link the provider to the existing account
            Identity(provider_id=provider_id, user=user, identity_data=data, provider=provider,
                     last_sign_in_at=now, email=email).save(force_insert=True)
            providers = sorted(set(Identity.objects.filter(user_id=user.id).values_list('provider', flat=True)))
            user.raw_app_meta_data = {**(user.raw_app_meta_data or {}), 'providers': providers}
            if user.email_confirmed_at is None:
                user.email_confirmed_at = now
            user.save(update_fields=['raw_app_meta_data', 'email_confirmed_at'])
        else:
            meta = {k: v for k, v in data.items() if v is not None}
            user = acc.create_user(email or f'{provider_id}@{provider}.invalid', None, meta, provider=provider,
                                   confirmed=True, identity_data=data, provider_id=provider_id)
    if not user or acc.is_banned(user):
        return None
    return acc.start_session(user)
