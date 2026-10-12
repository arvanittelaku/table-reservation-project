"""Minimal S3 client (path-style) for S3-compatible object storage.

Works with Cloudflare R2 (S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com,
S3_REGION=auto), Hetzner Object Storage (https://<location>.your-objectstorage.com,
S3_REGION=<location>), AWS S3 and MinIO. Requests are signed with core/sigv4.py.
Only what the app needs: put, get, head, delete, list by prefix, presigned GET.
"""
import datetime
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

import requests

from . import sigv4


class S3Error(Exception):
    def __init__(self, status, code='', message=''):
        super().__init__(f'S3 {status} {code} {message}'.strip())
        self.status, self.code, self.message = status, code, message


def _strip_ns(tag):
    return tag.rsplit('}', 1)[-1]


class S3Client:
    def __init__(self, endpoint_url, bucket, access_key, secret_key, region='auto', session_token=None,
                 timeout=30, session=None):
        if not endpoint_url or not bucket or not access_key or not secret_key:
            raise ValueError('S3_ENDPOINT_URL, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required')
        u = urlsplit(endpoint_url.rstrip('/'))
        self.scheme, self.host = u.scheme or 'https', u.netloc
        self.base_path = u.path.rstrip('/')
        self.bucket = bucket
        self.region = region or 'auto'
        self.creds = sigv4.Credentials(access_key, secret_key, session_token)
        self.timeout = timeout
        self.http = session or requests.Session()

    # ───────── internals ─────────
    def _path(self, key=''):
        return f'{self.base_path}/{self.bucket}' + (f'/{key}' if key else '')

    def _url(self, path, query):
        url = f'{self.scheme}://{self.host}{sigv4.uri_encode(path, keep_slash=True)}'
        return url + ('?' + sigv4.encode_query(query) if query else '')

    def _request(self, method, key='', query=(), body=b'', headers=None, ok=(200, 204)):
        query = list(query)
        hdrs = [('Host', self.host)] + list((headers or {}).items())
        payload = sigv4.sha256_hex(body)
        signed = sigv4.sign(method, self._path(key), query, hdrs, self.creds, self.region, 's3',
                            datetime.datetime.now(datetime.timezone.utc), payload_hash=payload,
                            normalize=False, add_content_sha256=True)
        send = {k: v for k, v in hdrs[1:]}
        send.update(dict(signed.headers))
        r = self.http.request(method, self._url(self._path(key), query), data=body or None, headers=send,
                              timeout=self.timeout, allow_redirects=False)
        if r.status_code not in ok:
            code = msg = ''
            try:
                root = ET.fromstring(r.content)
                for el in root:
                    if _strip_ns(el.tag) == 'Code':
                        code = el.text or ''
                    elif _strip_ns(el.tag) == 'Message':
                        msg = el.text or ''
            except ET.ParseError:
                pass
            raise S3Error(r.status_code, code, msg)
        return r

    # ───────── API ─────────
    def put_object(self, key, data, content_type='application/octet-stream', cache_control=None):
        headers = {'Content-Type': content_type, 'Content-Length': str(len(data))}
        if cache_control:
            headers['Cache-Control'] = cache_control
        self._request('PUT', key, body=data, headers=headers)

    def get_object(self, key):
        """(bytes, content_type) or None when missing."""
        try:
            r = self._request('GET', key)
        except S3Error as exc:
            if exc.status == 404:
                return None
            raise
        return r.content, r.headers.get('Content-Type', 'application/octet-stream')

    def head_object(self, key):
        """dict(size, content_type) or None when missing."""
        try:
            r = self._request('HEAD', key)
        except S3Error as exc:
            if exc.status == 404:
                return None
            raise
        return {'size': int(r.headers.get('Content-Length') or 0),
                'content_type': r.headers.get('Content-Type', '')}

    def delete_object(self, key):
        self._request('DELETE', key, ok=(200, 204, 404))

    def list_keys(self, prefix):
        keys, token = [], None
        while True:
            q = [('list-type', '2'), ('prefix', prefix)]
            if token:
                q.append(('continuation-token', token))
            root = ET.fromstring(self._request('GET', query=q).content)
            token = None
            truncated = False
            for el in root:
                tag = _strip_ns(el.tag)
                if tag == 'Contents':
                    for c in el:
                        if _strip_ns(c.tag) == 'Key':
                            keys.append(c.text)
                elif tag == 'IsTruncated':
                    truncated = (el.text or '').lower() == 'true'
                elif tag == 'NextContinuationToken':
                    token = el.text
            if not truncated or not token:
                return keys

    def presign_get(self, key, expires=3600, response_headers=None):
        """Presigned GET URL (response_headers e.g. {'response-cache-control': ...})."""
        scheme, host = self.scheme, self.host
        query = sorted((response_headers or {}).items())
        s = sigv4.presign('GET', self._path(key), query, [('Host', host)], self.creds, self.region, 's3',
                          datetime.datetime.now(datetime.timezone.utc), expires=max(1, min(int(expires), 604800)),
                          normalize=False)
        return f'{scheme}://{host}{sigv4.uri_encode(self._path(key), keep_slash=True)}?{sigv4.encode_query(s.query)}'
