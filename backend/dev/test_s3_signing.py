"""SigV4 presigning against AWS's documented example, then the storage endpoints
end-to-end against a tiny fake S3 server defined here.

    cd backend && MSGPACK_PUREPYTHON=1 python3 dev/test_s3_signing.py

1. AWS docs, "Authenticating Requests: Using Query Parameters (AWS Signature
   Version 4)": GET examplebucket/test.txt, 2013-05-24, 86400 s, key
   AKIAIOSFODNN7EXAMPLE -> known canonical request, string to sign, signature.
   Also the AWS header-signing GET example (Range: bytes=0-9).
2. Starts the fake S3 (http.server, PUT/GET/HEAD/DELETE/list, checks every
   Authorization header and presigned URL with its own SigV4 verifier written
   below, independent of core/sigv4.py), then a backend on a free port with
   STORAGE_BACKEND=s3 and runs upload / size / mime / folder rules / signed
   URL download / tamper / expiry / delete through the HTTP API.
Needs Postgres (DB_NAME, default ejb_dev) like the other dev tests; does not touch :8000.
"""
import datetime
import hashlib
import hmac
import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import requests

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from core import sigv4  # noqa: E402

results = []


def check(name, cond, info=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''))


# ───────────── 1. AWS documented examples ─────────────

AWS_KEY = sigv4.Credentials('AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
AWS_NOW = datetime.datetime(2013, 5, 24, tzinfo=datetime.timezone.utc)


def aws_vectors():
    s = sigv4.presign('GET', '/test.txt', [], [('Host', 'examplebucket.s3.amazonaws.com')], AWS_KEY,
                      'us-east-1', 's3', AWS_NOW, expires=86400, normalize=False)
    check('presign: canonical request = AWS docs', s.canonical_request == '\n'.join([
        'GET', '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com', '', 'host', 'UNSIGNED-PAYLOAD']), s.canonical_request)
    check('presign: string to sign = AWS docs', s.string_to_sign == (
        'AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n'
        '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04'))
    check('presign: signature = AWS docs (aeeed9bb...)',
          s.signature == 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404', s.signature)
    check('presign: URL query carries X-Amz-Signature last',
          sigv4.encode_query(s.query).endswith('X-Amz-Signature=' + s.signature))
    h = sigv4.sign('GET', '/test.txt', [], [('Host', 'examplebucket.s3.amazonaws.com'), ('Range', 'bytes=0-9')],
                   AWS_KEY, 'us-east-1', 's3', AWS_NOW, payload_hash=sigv4.EMPTY_SHA256,
                   normalize=False, add_content_sha256=True)
    check('header signing: AWS GET example signature (f0e8bdb8...)',
          h.signature == 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41', h.signature)


# ───────────── 2. fake S3 with its own verifier ─────────────

ACCESS, SECRET, REGION = 'test-signing-access', 'test-signing-secret/+=', 'auto'
OBJECTS, STATS, LOCK = {}, {'put': 0, 'get': 0, 'presigned_get': 0, 'head': 0, 'delete': 0, 'denied': 0}, threading.Lock()


def _enc(v, slash=False):
    return quote(v, safe='-_.~' + ('/' if slash else ''))


def _key(date):
    k = hmac.new(('AWS4' + SECRET).encode(), date.encode(), hashlib.sha256).digest()
    for p in (REGION, 's3', 'aws4_request'):
        k = hmac.new(k, p.encode(), hashlib.sha256).digest()
    return k


def verify(method, raw_path, pairs, headers, body):
    """Independent SigV4 check (header or query). Returns None or an error string."""
    q = dict(pairs)
    presigned = 'X-Amz-Signature' in q
    if presigned:
        cred, stamp, signed_names, sig = q['X-Amz-Credential'], q['X-Amz-Date'], q['X-Amz-SignedHeaders'], q['X-Amz-Signature']
        start = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        if datetime.datetime.now(datetime.timezone.utc) > start + datetime.timedelta(seconds=int(q['X-Amz-Expires'])):
            return 'expired'
        payload = 'UNSIGNED-PAYLOAD'
        pairs = [(k, v) for k, v in pairs if k != 'X-Amz-Signature']
    else:
        auth = headers.get('Authorization', '')
        if not auth.startswith('AWS4-HMAC-SHA256 '):
            return 'no signature'
        parts = dict(x.strip().split('=', 1) for x in auth[len('AWS4-HMAC-SHA256 '):].split(','))
        cred, signed_names, sig = parts['Credential'], parts['SignedHeaders'], parts['Signature']
        stamp = headers.get('X-Amz-Date', '')
        payload = headers.get('x-amz-content-sha256') or hashlib.sha256(body).hexdigest()
        if payload != 'UNSIGNED-PAYLOAD' and payload != hashlib.sha256(body).hexdigest():
            return 'payload hash mismatch'
    access, date, region, service, term = cred.split('/')
    if access != ACCESS or region != REGION or service != 's3' or term != 'aws4_request' or date != stamp[:8]:
        return 'bad credential scope'
    lower = {k.lower(): v for k, v in headers.items()}
    names = signed_names.split(';')
    if 'host' not in names:
        return 'host not signed'
    canon_h = ''.join(f'{n}:{" ".join(lower.get(n, "").split())}\n' for n in names)
    canon_q = '&'.join(f'{k}={v}' for k, v in sorted((_enc(k), _enc(v)) for k, v in pairs))
    canonical = '\n'.join([method, _enc(unquote(raw_path), True), canon_q, canon_h, signed_names, payload])
    sts = '\n'.join(['AWS4-HMAC-SHA256', stamp, f'{date}/{region}/s3/aws4_request',
                     hashlib.sha256(canonical.encode()).hexdigest()])
    want = hmac.new(_key(date), sts.encode(), hashlib.sha256).hexdigest()
    return None if hmac.compare_digest(want, sig) else 'SignatureDoesNotMatch'


class FakeS3(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body=b'', ctype='application/xml', extra=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _handle(self):
        u = urlsplit(self.path)
        pairs = [(unquote(k), unquote(v)) for k, _, v in (p.partition('=') for p in u.query.split('&') if p)]
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        err = verify(self.command, u.path, pairs, self.headers, body)
        if err:
            with LOCK:
                STATS['denied'] += 1
            return self._send(403, f'<Error><Code>AccessDenied</Code><Message>{err}</Message></Error>'.encode())
        bucket, _, key = unquote(u.path).lstrip('/').partition('/')
        q = dict(pairs)
        with LOCK:
            if not key and q.get('list-type') == '2':
                keys = sorted(k for b, k in OBJECTS if b == bucket and k.startswith(q.get('prefix', '')))
                xml = ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>'
                       + ''.join(f'<Contents><Key>{k}</Key></Contents>' for k in keys) + '</ListBucketResult>')
                return self._send(200, xml.encode())
            if self.command == 'PUT':
                STATS['put'] += 1
                OBJECTS[(bucket, key)] = (body, self.headers.get('Content-Type', 'application/octet-stream'))
                return self._send(200, extra={'ETag': '"x"'})
            obj = OBJECTS.get((bucket, key))
            if self.command in ('GET', 'HEAD'):
                STATS['presigned_get' if 'X-Amz-Signature' in q else self.command.lower()] += 1
                if obj is None:
                    return self._send(404, b'<Error><Code>NoSuchKey</Code></Error>')
                return self._send(200, obj[0], obj[1])
            if self.command == 'DELETE':
                STATS['delete'] += 1
                OBJECTS.pop((bucket, key), None)
                return self._send(204)
        return self._send(405)

    do_GET = do_PUT = do_HEAD = do_DELETE = _handle


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def endpoints():
    s3_port, api_port = free_port(), free_port()
    srv = ThreadingHTTPServer(('127.0.0.1', s3_port), FakeS3)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    api = f'http://localhost:{api_port}'
    env = dict(os.environ, STORAGE_BACKEND='s3', S3_ENDPOINT=f'http://127.0.0.1:{s3_port}', S3_BUCKET='ejb-test',
               S3_ACCESS_KEY_ID=ACCESS, S3_SECRET_ACCESS_KEY=SECRET, S3_REGION=REGION, S3_KEY_PREFIX='',
               S3_SIGNED_URL_MODE='presigned', API_URL=api, RUN_BACKGROUND='0', AUTH_EMAIL_CONFIRM='0',
               AUTH_RATE_LIMIT_PER_MIN='1000', DEBUG='1', MSGPACK_PUREPYTHON='1')
    log = open(BACKEND / 'var' / 'test_s3_signing.log', 'w')
    proc = subprocess.Popen([sys.executable, 'manage.py', 'serve', '--port', str(api_port)], cwd=BACKEND,
                            env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                if requests.get(api + '/health', timeout=1).ok:
                    break
            except requests.RequestException:
                time.sleep(0.3)
        run_endpoints(api)
    finally:
        proc.terminate()
        proc.wait(10)
        srv.shutdown()


def session(api):
    email = f's3sign.{uuid.uuid4().hex[:8]}@gmail.com'
    r = requests.post(api + '/auth/v1/signup', json={'email': email, 'password': 'Secret123!'})
    s = r.json().get('session') or requests.post(api + '/auth/v1/token?grant_type=password',
                                                 json={'email': email, 'password': 'Secret123!'}).json()
    return s['access_token'], s['user']['id']


def run_endpoints(api):
    tok, uid = session(api)
    tok2, uid2 = session(api)
    h = {'Authorization': f'Bearer {tok}', 'Content-Type': 'image/jpeg'}
    jpg = b'\xff\xd8\xff\xe0' + os.urandom(3000)
    path = f'{uid}/avatar.jpg'
    r = requests.post(f'{api}/storage/v1/object/avatars/{path}', data=jpg, headers=h)
    check('upload into own folder -> stored in the bucket', r.ok and OBJECTS.get(('ejb-test', f'avatars/{path}'), (None,))[0] == jpg, r.text[:200])
    check('upload response shape unchanged', r.ok and r.json().get('Key') == f'avatars/{path}', r.text[:200])
    r = requests.post(f'{api}/storage/v1/object/avatars/{path}', data=jpg, headers=h)
    check('second upload without x-upsert -> 409', r.status_code == 409, r.status_code)
    r = requests.post(f'{api}/storage/v1/object/avatars/{path}', data=jpg, headers={**h, 'x-upsert': 'true'})
    check('upsert overwrites', r.ok)
    r = requests.post(f'{api}/storage/v1/object/avatars/{uid2}/a.jpg', data=jpg, headers=h)
    check("someone else's folder -> 403", r.status_code == 403)
    r = requests.post(f'{api}/storage/v1/object/avatars/{uid}/big.jpg', data=b'x' * (5 * 1024 * 1024 + 1), headers=h)
    check('over 5 MB -> 413', r.status_code == 413, r.status_code)
    r = requests.post(f'{api}/storage/v1/object/avatars/{uid}/a.gif', data=jpg, headers={**h, 'Content-Type': 'image/gif'})
    check('unsupported mime -> 415', r.status_code == 415)
    r = requests.post(f'{api}/storage/v1/object/sign/avatars', json={'paths': [path, f'{uid}/missing.jpg'], 'expiresIn': 120},
                      headers={'Authorization': f'Bearer {tok2}'})
    signed = r.json() if r.ok else []
    url = signed[0]['signedUrl'] if signed else ''
    check('other user signs: presigned bucket URL + missing reported',
          r.ok and url.startswith('http://127.0.0.1:') and 'X-Amz-Signature=' in url and 'X-Amz-Expires=120' in url
          and signed[0]['signedURL'] == url and signed[1]['error'] == 'Object not found', r.text[:300])
    got = requests.get(url)
    check('presigned URL downloads the photo (fake S3 verified the signature)', got.ok and got.content == jpg and STATS['presigned_get'] >= 1)
    check('tampered presigned URL -> 403', requests.get(url.replace(uid, uid2)).status_code == 403)
    check('wrong signature -> 403', requests.get(url[:-4] + '0000').status_code == 403)
    r = requests.post(f'{api}/storage/v1/object/sign/avatars', json={'paths': [path]})
    check('signing needs sign-in -> 401', r.status_code == 401)
    r = requests.post(f'{api}/storage/v1/object/sign/avatars', json={'paths': [path], 'expiresIn': 1},
                      headers={'Authorization': f'Bearer {tok}'})
    short = r.json()[0]['signedUrl']
    time.sleep(2.2)
    check('expired presigned URL -> 403', requests.get(short).status_code == 403)
    r = requests.delete(f'{api}/storage/v1/object/avatars', json={'prefixes': [path]}, headers={'Authorization': f'Bearer {tok2}'})
    check("other user's delete removes nothing", r.ok and r.json() == [] and ('ejb-test', f'avatars/{path}') in OBJECTS, r.text[:200])
    r = requests.delete(f'{api}/storage/v1/object/avatars', json={'prefixes': [path]}, headers={'Authorization': f'Bearer {tok}'})
    check('owner delete removes it from the bucket', r.ok and r.json() == [{'name': path, 'bucket_id': 'avatars'}]
          and ('ejb-test', f'avatars/{path}') not in OBJECTS, r.text[:200])
    check('every backend->S3 request was correctly signed', STATS['denied'] == 3, STATS)   # the 3 refused GETs above


if __name__ == '__main__':
    aws_vectors()
    endpoints()
    print(f'\n{sum(results)}/{len(results)} passed')
    sys.exit(0 if all(results) else 1)
