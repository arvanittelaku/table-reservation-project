"""Tiny S3-compatible server for local tests (STORAGE_BACKEND=s3).

    python3 dev/fake_s3.py [--port 9010] [--access KEY --secret SECRET]

Path-style buckets (/<bucket>/<key>), objects kept in memory. Supports PUT,
GET, HEAD, DELETE objects, ListObjectsV2 and presigned GET URLs. Every request
must carry a valid SigV4 signature (header or query) for the configured key,
and an unexpired X-Amz-Expires; the payload hash is checked against the body,
like S3 does. GET /__stats returns request counters (for tests).
"""
import argparse
import datetime
import hashlib
import hmac
import json
import os
import sys
import threading
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from core import sigv4  # noqa: E402

LOCK = threading.Lock()
OBJECTS = {}            # (bucket, key) -> (bytes, content_type, cache_control)
STATS = {'put': 0, 'get': 0, 'head': 0, 'delete': 0, 'list': 0, 'presigned_get': 0, 'denied': 0}


def _pairs(qs):
    out = []
    for part in qs.split('&') if qs else []:
        k, _, v = part.partition('=')
        out.append((unquote(k), unquote(v)))
    return out


class Handler(BaseHTTPRequestHandler):
    access = secret = None
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _send(self, status, body=b'', ctype='application/xml', extra=None, head=False):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and not head:
            self.wfile.write(body)

    def _error(self, status, code, msg=''):
        body = f'<?xml version="1.0" encoding="UTF-8"?><Error><Code>{code}</Code><Message>{escape(msg)}</Message></Error>'
        if status == 403:
            STATS['denied'] += 1
        self._send(status, body.encode(), head=self.command == 'HEAD')

    def _verify(self, body):
        u = urlsplit(self.path)
        path, query = unquote(u.path), _pairs(u.query)
        qd = dict(query)
        now = datetime.datetime.now(datetime.timezone.utc)
        if 'X-Amz-Signature' in qd:            # presigned URL
            cred = qd.get('X-Amz-Credential', '')
            signed_names = qd.get('X-Amz-SignedHeaders', '').split(';')
            stamp, given = qd.get('X-Amz-Date', ''), qd['X-Amz-Signature']
            try:
                t = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
                if now > t + datetime.timedelta(seconds=int(qd.get('X-Amz-Expires', '0'))):
                    return 'Request has expired'
            except ValueError:
                return 'bad X-Amz-Date'
            query = [(k, v) for k, v in query if k != 'X-Amz-Signature']
            payload = sigv4.UNSIGNED
        else:
            auth = self.headers.get('Authorization', '')
            if not auth.startswith(sigv4.ALGORITHM + ' '):
                return 'missing Authorization'
            parts = dict(p.strip().split('=', 1) for p in auth[len(sigv4.ALGORITHM) + 1:].split(','))
            cred, given = parts.get('Credential', ''), parts.get('Signature', '')
            signed_names = parts.get('SignedHeaders', '').split(';')
            stamp = self.headers.get('X-Amz-Date', '')
            payload = self.headers.get('x-amz-content-sha256', '')
            if payload != sigv4.UNSIGNED and payload != hashlib.sha256(body).hexdigest():
                return 'XAmzContentSHA256Mismatch'
            try:
                t = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
                if abs((now - t).total_seconds()) > 900:
                    return 'RequestTimeTooSkewed'
            except ValueError:
                return 'bad X-Amz-Date'
        bits = cred.split('/')
        if len(bits) != 5 or bits[0] != self.access or bits[1] != stamp[:8] or bits[3] != 's3':
            return 'InvalidAccessKeyId or bad scope'
        if 'host' not in signed_names:
            return 'host must be signed'
        headers = [(n, self.headers.get(n, '')) for n in signed_names]
        _, _, sig, _, _ = sigv4._finish(self.command, path, query, headers, payload,
                                        sigv4.Credentials(self.access, self.secret), bits[2], 's3', stamp, False)
        if not hmac.compare_digest(sig, given):
            return 'SignatureDoesNotMatch'
        return None

    def _handle(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        u = urlsplit(self.path)
        if u.path == '/__stats':
            return self._send(200, json.dumps(STATS).encode(), 'application/json')
        problem = self._verify(body)
        if problem:
            return self._error(403, 'AccessDenied', problem)
        segs = unquote(u.path).lstrip('/').split('/', 1)
        bucket, key = segs[0], (segs[1] if len(segs) > 1 else '')
        q = dict(_pairs(u.query))
        presigned = 'X-Amz-Signature' in q
        if presigned and self.command != 'GET':
            return self._error(403, 'AccessDenied', 'presigned URL is for GET')
        with LOCK:
            if not key:
                if self.command == 'GET' and q.get('list-type') == '2':
                    STATS['list'] += 1
                    prefix = q.get('prefix', '')
                    keys = sorted(k for (b, k) in OBJECTS if b == bucket and k.startswith(prefix))
                    items = ''.join(f'<Contents><Key>{escape(k)}</Key><Size>{len(OBJECTS[(bucket, k)][0])}</Size></Contents>'
                                    for k in keys)
                    xml = ('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                           f'<Name>{bucket}</Name><Prefix>{escape(prefix)}</Prefix><KeyCount>{len(keys)}</KeyCount>'
                           f'<IsTruncated>false</IsTruncated>{items}</ListBucketResult>')
                    return self._send(200, xml.encode())
                return self._error(400, 'NotImplemented')
            obj = OBJECTS.get((bucket, key))
            if self.command == 'PUT':
                STATS['put'] += 1
                OBJECTS[(bucket, key)] = (body, self.headers.get('Content-Type', 'application/octet-stream'),
                                          self.headers.get('Cache-Control'))
                etag = '"' + hashlib.md5(body).hexdigest() + '"'
                return self._send(200, b'', extra={'ETag': etag})
            if self.command in ('GET', 'HEAD'):
                STATS['presigned_get' if presigned else self.command.lower()] += 1
                if obj is None:
                    return self._error(404, 'NoSuchKey', key)
                extra = {'Last-Modified': formatdate(usegmt=True), 'ETag': '"' + hashlib.md5(obj[0]).hexdigest() + '"'}
                if obj[2]:
                    extra['Cache-Control'] = obj[2]
                if q.get('response-cache-control'):
                    extra['Cache-Control'] = q['response-cache-control']
                return self._send(200, obj[0], obj[1], extra, head=self.command == 'HEAD')
            if self.command == 'DELETE':
                STATS['delete'] += 1
                OBJECTS.pop((bucket, key), None)
                return self._send(204)
        return self._error(405, 'MethodNotAllowed')

    do_GET = do_PUT = do_HEAD = do_DELETE = do_POST = _handle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=int(os.environ.get('FAKE_S3_PORT', '9010')))
    ap.add_argument('--access', default=os.environ.get('S3_ACCESS_KEY_ID', 'test-access'))
    ap.add_argument('--secret', default=os.environ.get('S3_SECRET_ACCESS_KEY', 'test-secret'))
    a = ap.parse_args()
    Handler.access, Handler.secret = a.access, a.secret
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print(f'fake S3 on :{a.port}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
