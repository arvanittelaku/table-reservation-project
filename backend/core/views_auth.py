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

from . import accounts as acc
from .db import as_service, fetch_dict
from .http import BadRequest, bearer_claims, error_response, json_body, ok, rate_limit
from .jobs import enqueue
from .tokens import TokenError, read_state, sign_state


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
    with as_service() as cur:
        existing = acc.get_user_by_email(cur, email)
        if existing:
            raise BadRequest('User already registered', 422, 'user_already_exists')
        confirmed = not settings.AUTH_EMAIL_CONFIRM
        user = acc.create_user(cur, email, password, options.get('data') or {}, confirmed=confirmed)
        if confirmed:
            session = acc.start_session(cur, user)
            return ok({'user': session['user'], 'session': session})
        link = acc.create_email_link(cur, user['id'], 'signup', options.get('emailRedirectTo'))
        enqueue(cur, 'auth-email', {'kind': 'signup', 'email': email, 'link': link})
        return ok({'user': acc.user_json(cur, user), 'session': None})


@_handle
@require_http_methods(['POST'])
def token(request):
    grant = request.GET.get('grant_type')
    body = json_body(request)
    if grant == 'password':
        rate_limit(request, 'login')
        email = acc.normalize_email(body.get('email'))
        password = body.get('password') or ''
        with as_service() as cur:
            user = acc.get_user_by_email(cur, email)
            if not user or not acc.check_password(cur, user['id'], password):
                raise BadRequest('Invalid login credentials', 400, 'invalid_credentials')
            if acc.is_banned(user):
                raise BadRequest('User is banned', 400, 'user_banned')
            if settings.AUTH_EMAIL_CONFIRM and not user.get('email_confirmed_at'):
                raise BadRequest('Email not confirmed', 400, 'email_not_confirmed')
            return ok(acc.start_session(cur, user))
    if grant == 'refresh_token':
        with as_service() as cur:
            session = acc.rotate_refresh_token(cur, body.get('refresh_token'))
            if not session:
                raise BadRequest('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found')
            return ok(session)
    raise BadRequest('Unsupported grant_type', 400, 'validation_failed')


@_handle
@require_http_methods(['POST'])
def logout(request):
    claims = bearer_claims(request, required=True)
    with as_service() as cur:
        acc.revoke_all_sessions(cur, claims['sub'])
    return ok({})


@_handle
@require_http_methods(['GET', 'PUT'])
def user(request):
    claims = bearer_claims(request, required=True)
    with as_service() as cur:
        u = acc.get_user_by_id(cur, claims['sub'])
        if not u:
            raise BadRequest('User from sub claim in JWT does not exist', 403, 'user_not_found')
        if acc.is_banned(u):
            raise BadRequest('User is banned', 403, 'user_banned')
        if request.method == 'PUT':
            body = json_body(request)
            if 'password' in body:
                _check_password_rules(body['password'])
                acc.set_password(cur, u['id'], body['password'])
            if isinstance(body.get('data'), dict):
                cur.execute("UPDATE auth.users SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || %s::jsonb,"
                            " updated_at = now() WHERE id = %s", [json.dumps(body['data']), u['id']])
            u = acc.get_user_by_id(cur, u['id'])
        return ok(acc.user_json(cur, u))


@_handle
@require_http_methods(['POST'])
def recover(request):
    rate_limit(request, 'recover', limit=5)
    body = json_body(request)
    email = acc.normalize_email(body.get('email'))
    with as_service() as cur:
        u = acc.get_user_by_email(cur, email) if _valid_email(email) else None
        if u and not acc.is_banned(u):
            link = acc.create_email_link(cur, u['id'], 'recovery', body.get('redirect_to') or request.GET.get('redirect_to'))
            enqueue(cur, 'auth-email', {'kind': 'recovery', 'email': u['email'], 'link': link})
    return ok({})  # same answer whether or not the email exists


@_handle
@require_http_methods(['POST'])
def resend(request):
    rate_limit(request, 'resend', limit=5)
    body = json_body(request)
    if body.get('type') != 'signup':
        raise BadRequest('Unsupported resend type', 400, 'validation_failed')
    email = acc.normalize_email(body.get('email'))
    with as_service() as cur:
        u = acc.get_user_by_email(cur, email)
        if u and not u.get('email_confirmed_at'):
            redirect = (body.get('options') or {}).get('emailRedirectTo')
            link = acc.create_email_link(cur, u['id'], 'signup', redirect)
            enqueue(cur, 'auth-email', {'kind': 'signup', 'email': u['email'], 'link': link})
    return ok({})


@csrf_exempt
@require_http_methods(['GET'])
def verify(request):
    """Email links land here, then return to the app like Supabase did."""
    kind = request.GET.get('type')
    raw = request.GET.get('token', '')
    if kind not in ('signup', 'recovery'):
        return HttpResponseRedirect(f'{settings.SITE_URL}/#{acc.error_fragment("validation_failed", "Invalid link")}')
    with as_service() as cur:
        user, redirect_to = acc.consume_email_link(cur, raw, kind)
        target = acc.safe_redirect(redirect_to)
        if not user or acc.is_banned(user):
            return HttpResponseRedirect(f'{target.split("#")[0]}#{acc.error_fragment()}')
        session = acc.start_session(cur, user)
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
    with as_service() as cur:
        session = _oauth_sign_in(cur, provider, provider_id, email, verified, data)
    if session is None:
        return HttpResponseRedirect(f'{base}#{acc.error_fragment("user_banned", "User is banned")}')
    return HttpResponseRedirect(f'{base}#{acc.session_fragment(session, "signup")}')


def _oauth_sign_in(cur, provider, provider_id, email, verified, data):
    row = fetch_dict(cur, 'SELECT user_id FROM auth.identities WHERE provider = %s AND provider_id = %s',
                     [provider, provider_id])
    if row:
        user = acc.get_user_by_id(cur, row['user_id'])
        cur.execute('UPDATE auth.identities SET identity_data = %s::jsonb, last_sign_in_at = now(), updated_at = now()'
                    ' WHERE provider = %s AND provider_id = %s', [json.dumps(data), provider, provider_id])
    else:
        user = acc.get_user_by_email(cur, email) if (email and verified) else None
        if user:  # same verified email: link the provider to the existing account
            cur.execute('INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, email)'
                        ' VALUES (%s, %s, %s::jsonb, %s, now(), %s)', [provider_id, user['id'], json.dumps(data), provider, email])
            cur.execute("UPDATE auth.users SET raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb),"
                        " '{providers}', (SELECT to_jsonb(array_agg(DISTINCT provider)) FROM auth.identities WHERE user_id = %s)),"
                        " email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = %s", [user['id'], user['id']])
            user = acc.get_user_by_id(cur, user['id'])
        else:
            meta = {k: v for k, v in data.items() if v is not None}
            user = acc.create_user(cur, email or f'{provider_id}@{provider}.invalid', None, meta, provider=provider,
                                   confirmed=True, identity_data=data, provider_id=provider_id)
    if not user or acc.is_banned(user):
        return None
    return acc.start_session(cur, user)
