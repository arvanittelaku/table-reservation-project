"""API description for the mobile team: /api/openapi.json and a docs page at /api/docs."""
from functools import lru_cache
from pathlib import Path

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET

from .openapi import build_spec


@lru_cache(maxsize=1)
def _spec():
    return build_spec()


@require_GET
def openapi_json(request):
    resp = JsonResponse(_spec(), json_dumps_params={'ensure_ascii': False, 'indent': 1})
    resp['Access-Control-Allow-Origin'] = '*'      # readable by editors / codegen tools
    resp['Cache-Control'] = 'public, max-age=300'
    return resp


@lru_cache(maxsize=1)
def _page():
    return (Path(__file__).parent / 'templates' / 'api_docs.html').read_text()


@require_GET
def docs(request):
    resp = HttpResponse(_page(), content_type='text/html; charset=utf-8')
    resp['Cache-Control'] = 'public, max-age=300'
    resp['Content-Security-Policy'] = ("default-src 'none'; script-src 'self' 'unsafe-inline'; "
                                       "style-src 'unsafe-inline'; connect-src 'self'; img-src data:")
    return resp
