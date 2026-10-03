"""HTTP helpers: CORS, JSON in/out, the signed-in user, rate limits."""
import json

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse

from .tokens import TokenError, decode_access_token


class CorsMiddleware:
    """Lets the web app (another origin in development) call the API."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get('Origin')
        allowed = origin and (origin in settings.CORS_ALLOWED_ORIGINS or '*' in settings.CORS_ALLOWED_ORIGINS)
        if request.method == 'OPTIONS' and request.headers.get('Access-Control-Request-Method'):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        if allowed:
            response['Access-Control-Allow-Origin'] = origin
            response['Vary'] = 'Origin'
            response['Access-Control-Allow-Credentials'] = 'true'
            response['Access-Control-Allow-Headers'] = 'authorization, content-type, x-upsert, x-client-info, cache-control'
            response['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            response['Access-Control-Max-Age'] = '86400'
        return response


def json_body(request):
    if not request.body:
        return {}
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise BadRequest('Invalid JSON body')
    return data if data is not None else {}


class BadRequest(Exception):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def error_response(message, status=400, code=None, **extra):
    body = {'message': message, 'code': code, 'error': code or 'error', 'msg': message}
    body.update(extra)
    return JsonResponse(body, status=status)


def ok(data, status=200):
    return JsonResponse(data, status=status, safe=False, json_dumps_params={'ensure_ascii': False})


def bearer_claims(request, required=False):
    """Claims of the access token in the Authorization header, or None."""
    header = request.headers.get('Authorization', '')
    token = header[7:].strip() if header.lower().startswith('bearer ') else ''
    if not token:
        if required:
            raise BadRequest('Not signed in', status=401, code='no_authorization')
        return None
    try:
        return decode_access_token(token)
    except TokenError as exc:
        raise BadRequest(str(exc), status=401, code='bad_jwt')


def client_ip(request):
    forwarded = request.headers.get('X-Forwarded-For', '')
    return forwarded.split(',')[0].strip() if forwarded else request.META.get('REMOTE_ADDR', '')


def rate_limit(request, bucket, limit=None, window=60):
    """Simple fixed-window limit per IP (auth endpoints)."""
    limit = limit or settings.AUTH_RATE_LIMIT_PER_MIN
    key = f'rl:{bucket}:{client_ip(request)}'
    try:
        count = cache.get_or_set(key, 0, window)
        count = cache.incr(key)
    except Exception:  # cache down: do not block sign-ins
        return
    if count > limit:
        raise BadRequest('Too many requests. Try again in a minute.', status=429, code='over_request_rate_limit')
