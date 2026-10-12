"""Video rooms for online lessons (Jitsi).

Production uses 8x8 Jitsi as a Service (JaaS): the room lives at
https://8x8.vc/<appId>/<room> and only opens with a JWT signed (RS256) by our
JaaS API key. Each participant gets their own short-lived token: the tutor is
moderator, students are not. Configured by VIDEO_PROVIDER=jaas, JAAS_APP_ID,
JAAS_API_KEY_ID (kid) and JAAS_PRIVATE_KEY.

Self-hosted (VIDEO_PROVIDER=jitsi): our own Jitsi server on
JITSI_DOMAIN with JWT auth (prosody token auth, guests off). Tokens are HS256,
signed with JITSI_APP_SECRET, iss = JITSI_APP_ID, sub = JITSI_DOMAIN, valid for
that one room until the lesson window closes.

Without either configured, rooms are plain rooms on JITSI_DOMAIN (a self-hosted
Jitsi server, or meet.jit.si for local development), as before.
"""
import datetime
import time

import jwt
from django.conf import settings

# Features a participant may use (JaaS checks them in the token). Recording,
# streaming and dial-out cost money / need consent: off.
FEATURES = {
    'livestreaming': False,
    'recording': False,
    'transcription': False,
    'outbound-call': False,
    'sip-outbound-call': False,
}


PROVIDERS = ('jaas', 'jitsi', 'public')


def _key_id():
    return getattr(settings, 'JAAS_API_KEY_ID', '') or getattr(settings, 'JAAS_KEY_ID', '')


def jaas_configured():
    return bool(settings.JAAS_APP_ID and _key_id() and settings.JAAS_PRIVATE_KEY)


def provider():
    """'jaas', 'jitsi', 'public', or raise ValueError when VIDEO_PROVIDER is set
    explicitly but its settings are missing (never fall back to open rooms then)."""
    chosen = (getattr(settings, 'VIDEO_PROVIDER', '') or '').strip().lower()
    if not chosen:
        if selfhosted_configured():
            return 'jitsi'
        return 'jaas' if jaas_configured() else 'public'
    if chosen not in PROVIDERS:
        raise ValueError(f'VIDEO_PROVIDER={chosen!r}: use jaas, jitsi or public')
    if chosen == 'jaas' and not jaas_configured():
        raise ValueError('VIDEO_PROVIDER=jaas needs JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY')
    if chosen == 'jitsi' and not (selfhosted_configured() and settings.JITSI_DOMAIN):
        raise ValueError('VIDEO_PROVIDER=jitsi needs JITSI_DOMAIN, JITSI_APP_ID and JITSI_APP_SECRET')
    return chosen


def _kid():
    kid = _key_id()
    # the console shows the full id "<appId>/<keyId>"; accept the short form too
    return kid if '/' in kid else f'{settings.JAAS_APP_ID}/{kid}'


def jaas_token(room, user_id, name, moderator, avatar=None, email=None, expires_at=None, now=None):
    """RS256 JWT for one participant of one JaaS room."""
    now = int(now if now is not None else time.time())
    exp = int(expires_at if expires_at is not None else now + 2 * 3600)
    payload = {
        'aud': 'jitsi',
        'iss': 'chat',
        'sub': settings.JAAS_APP_ID,
        'room': room,
        'iat': now,
        'nbf': now - 10,
        'exp': exp,
        'context': {
            'user': {
                'id': str(user_id),
                'name': name or '',
                'avatar': avatar or '',
                'email': email or '',
                'moderator': bool(moderator),
                'hidden-from-recorder': False,
            },
            'features': dict(FEATURES),
        },
    }
    return jwt.encode(payload, settings.JAAS_PRIVATE_KEY, algorithm='RS256',
                      headers={'kid': _kid(), 'typ': 'JWT'})


def selfhosted_configured():
    return bool(getattr(settings, 'JITSI_APP_SECRET', ''))


def selfhosted_token(room, user_id, name, moderator, avatar=None, expires_at=None, now=None):
    """HS256 JWT for one participant of one room on our own Jitsi server."""
    now = int(now if now is not None else time.time())
    exp = int(expires_at if expires_at is not None else now + 2 * 3600)
    user = {'id': str(user_id), 'name': name or '', 'moderator': bool(moderator)}
    if avatar:
        user['avatar'] = avatar
    payload = {
        'aud': 'jitsi',
        'iss': settings.JITSI_APP_ID,
        'sub': settings.JITSI_DOMAIN,
        'room': room,
        'iat': now,
        'nbf': now - 10,
        'exp': exp,
        'context': {'user': user, 'features': dict(FEATURES)},
    }
    return jwt.encode(payload, settings.JITSI_APP_SECRET, algorithm='HS256')


def check_key():
    """Raise if the configured private key cannot sign (used by preflight)."""
    jaas_token('preflight', 'preflight', 'preflight', False)


def room_access(room, user_id, name, moderator, avatar=None, email=None, closes_at=None):
    """What the app needs to open `room` (None while the room has no key).

    provider   'jitsi-jwt' (own server), 'jaas' or 'jitsi' (open rooms)
    domain     Jitsi server for the External API / iframe
    room_name  full room name on that server ('<appId>/<room>' with JaaS)
    jwt        participant token (own server / JaaS, else None)
    script_url External API script
    """
    now = time.time()
    which = provider()
    if which == 'jitsi':
        domain = settings.JITSI_DOMAIN
        exp = closes_at.timestamp() if closes_at else now + 2 * 3600
        token = None if room is None else selfhosted_token(room, user_id, name, moderator, avatar,
                                                           expires_at=exp, now=now)
        return {
            'provider': 'jitsi-jwt', 'domain': domain, 'room_name': room, 'jwt': token,
            'jwt_expires_at': datetime.datetime.fromtimestamp(int(exp), datetime.timezone.utc) if token else None,
            'script_url': f'https://{domain}/external_api.js', 'moderator': bool(moderator),
        }
    if which == 'jaas':
        domain = settings.JAAS_DOMAIN
        app = settings.JAAS_APP_ID
        exp = max(now + 600, closes_at.timestamp() if closes_at else now + 2 * 3600)
        token = None if room is None else jaas_token(room, user_id, name, moderator, avatar, email,
                                                     expires_at=exp, now=now)
        return {
            'provider': 'jaas', 'domain': domain,
            'room_name': None if room is None else f'{app}/{room}',
            'jwt': token,
            'jwt_expires_at': datetime.datetime.fromtimestamp(int(exp), datetime.timezone.utc) if token else None,
            'script_url': f'https://{domain}/{app}/external_api.js',
            'moderator': bool(moderator),
        }
    domain = settings.JITSI_DOMAIN
    return {
        'provider': 'jitsi', 'domain': domain, 'room_name': room, 'jwt': None, 'jwt_expires_at': None,
        'script_url': f'https://{domain}/external_api.js', 'moderator': bool(moderator),
    }
