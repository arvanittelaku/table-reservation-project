"""Data, storage and function endpoints used by the web app."""
import logging
import socket

from django.http import FileResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.db import transaction

from ejb import context, query, rpc
from ejb.context import Actor

from . import storage
from .db import DbError
from .http import BadRequest, bearer_claims, error_response, json_body, ok, rate_limit

log = logging.getLogger('ejb.api')


def _db_errors(fn):
    def wrapper(request, *args, **kwargs):
        try:
            return fn(request, *args, **kwargs)
        except BadRequest as exc:
            return error_response(exc.message, exc.status, exc.code)
        except DbError as exc:
            return ok(exc.as_dict(), exc.status)
        except storage.StorageError as exc:
            return ok({'statusCode': str(exc.status), 'error': exc.message, 'message': exc.message}, exc.status)
    wrapper.__name__ = fn.__name__
    return csrf_exempt(wrapper)


@_db_errors
@require_http_methods(['POST'])
def table_query(request):
    claims = bearer_claims(request)
    req = json_body(request)
    with context.acting(Actor.from_claims(claims), direct=True):
        data, count = query.run(req)
    return ok({'data': data, 'count': count})


@_db_errors
@require_http_methods(['POST'])
def rpc_call(request, name):
    claims = bearer_claims(request)
    args = json_body(request)
    with context.acting(Actor.from_claims(claims)):
        data = rpc.call(name, args)
    return ok({'data': data})


# ───────────── storage ─────────────

@_db_errors
@require_http_methods(['POST', 'PUT', 'DELETE'])
def storage_object(request, bucket, path=''):
    claims = bearer_claims(request)
    if request.method == 'DELETE':
        body = json_body(request)
        with transaction.atomic():  # folder rules are enforced in storage.py
            removed = storage.remove(claims, bucket, body.get('prefixes') or [])
        return ok(removed)
    upsert = request.method == 'PUT' or request.headers.get('x-upsert', '').lower() == 'true'
    with transaction.atomic():
        result = storage.upload(claims, bucket, path, request.body, request.headers.get('Content-Type'), upsert)
    return ok(result)


@_db_errors
@require_http_methods(['POST'])
def storage_sign(request, bucket, path=''):
    claims = bearer_claims(request)
    body = json_body(request)
    paths = body.get('paths') if body.get('paths') is not None else [path]
    return ok(storage.sign_urls(claims, bucket, paths, body.get('expiresIn')))


@_db_errors
@require_http_methods(['GET'])
def storage_signed_get(request, bucket, path):
    f, ctype = storage.open_signed(bucket, path, request.GET.get('token'))
    resp = FileResponse(open(f, 'rb'), content_type=ctype)
    resp['Cache-Control'] = 'private, max-age=3600'
    return resp


# ───────────── server functions (were Edge Functions) ─────────────

def _has_mail_records(domain):
    try:
        import dns.resolver  # dnspython
        try:
            return bool(dns.resolver.resolve(domain, 'MX', lifetime=4)), 'mx'
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            pass
        except Exception:
            return None, 'error'
    except ImportError:
        pass
    try:  # domains may accept mail on their A record
        socket.getaddrinfo(domain, 25)
        return True, 'a_fallback'
    except OSError:
        return False, 'no_mx'


@_db_errors
@require_http_methods(['POST'])
def function_call(request, name):
    body = json_body(request)
    if name == 'check-email-domain':
        rate_limit(request, 'email-domain', limit=30)
        email = body.get('email') if isinstance(body.get('email'), str) else ''
        domain = email.split('@')[1].strip().lower() if '@' in email else ''
        if not domain or '.' not in domain or ' ' in domain:
            return ok({'valid': False, 'reason': 'invalid_domain'})
        valid, how = _has_mail_records(domain)
        if valid is None:  # DNS unavailable: do not block sign-ups
            return ok({'valid': True, 'domain': domain, 'checked': 'unavailable'})
        return ok({'valid': valid, 'domain': domain, 'checked': how} if valid else
                  {'valid': False, 'domain': domain, 'reason': 'no_mx'})
    return error_response(f'Function {name} not found', 404, 'not_found')


def health(request):
    return HttpResponse('ok')
