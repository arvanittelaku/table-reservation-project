"""Per-request performance log: total time, time spent in the database, number of queries,
and any statement that is repeated many times (the signature of an N+1 loop).

Enabled when DEBUG=1 or PERF_LOG=1. One INFO line per request, e.g.

    PERF  POST /rest/v1/rpc/admin_list_wednesday  200  total 41230ms  db 40870ms  queries 612  !! 200x SELECT ... FROM "wednesday_restaurants" ...

Lines are WARNING when a request takes over 800 ms or runs over 25 queries.
"""
import json
import logging
import re
import time

from django.db import connection

log = logging.getLogger('ejb.perf')

SLOW_MS = 800
MANY_QUERIES = 25
REPEAT_AT = 8

_NUM = re.compile(r'\b\d+\b')
_STR = re.compile(r"'[^']*'")
_PARAMS = re.compile(r'%s')
_IN_LIST = re.compile(r'IN \((?:%s,? ?)+\)')


def shape(sql):
    """The statement without its values, so repeated calls compare equal."""
    s = _IN_LIST.sub('IN (...)', sql)
    s = _STR.sub("'?'", s)
    s = _NUM.sub('?', s)
    s = re.sub(r'\s+', ' ', s)
    return s[:200]


class QueryRecorder:
    """Use as a Django `connection.execute_wrapper` to time every statement."""

    def __init__(self):
        self.count = 0
        self.seconds = 0.0
        self.shapes = {}

    def __call__(self, execute, sql, params, many, context):
        start = time.perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            elapsed = time.perf_counter() - start
            self.count += 1
            self.seconds += elapsed
            key = shape(sql)
            n, t = self.shapes.get(key, (0, 0.0))
            self.shapes[key] = (n + 1, t + elapsed)

    def worst_repeat(self):
        if not self.shapes:
            return None
        key, (n, t) = max(self.shapes.items(), key=lambda kv: kv[1][0])
        return (key, n, t) if n >= REPEAT_AT else None

    def slowest(self):
        if not self.shapes:
            return None
        key, (n, t) = max(self.shapes.items(), key=lambda kv: kv[1][1])
        return key, n, t


def _label(request):
    """Path plus, for the generic query endpoint, the table and action."""
    path = request.path
    if path == '/rest/v1/query':
        try:
            body = json.loads(request.body or b'{}')
            return f"{path} [{body.get('action', 'select')} {body.get('table')}]"
        except Exception:
            return path
    return path


class PerfMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        label = _label(request)
        rec = QueryRecorder()
        start = time.perf_counter()
        with connection.execute_wrapper(rec):
            response = self.get_response(request)
        total_ms = (time.perf_counter() - start) * 1000
        db_ms = rec.seconds * 1000
        line = f'PERF  {request.method} {label}  {response.status_code}  total {total_ms:.0f}ms  db {db_ms:.0f}ms  queries {rec.count}'
        rep = rec.worst_repeat()
        if rep:
            line += f'  !! {rep[1]}x {rep[0][:110]}'
        slow = total_ms > SLOW_MS or rec.count > MANY_QUERIES
        (log.warning if slow else log.info)(line)
        return response
