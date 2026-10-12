"""AWS Signature Version 4 (header signing and presigned URLs), self-contained.

Used by core/s3.py for S3-compatible object storage (Cloudflare R2, Hetzner,
AWS S3, MinIO). Verified against AWS's published SigV4 test suite
(core/tests/sigv4_vectors, from awslabs/aws-c-auth) and AWS's S3 examples
(core/tests/test_sigv4.py).

    signed = sign('GET', '/bucket/key', [], [('Host', 'example.com')], creds,
                  'auto', 's3', now, payload_hash=UNSIGNED, normalize=False)
    headers = signed.headers            # X-Amz-Date, Authorization, ...

    url_query = presign('GET', '/bucket/key', [], [('Host', 'example.com')], creds,
                        'auto', 's3', now, expires=3600, normalize=False).query

Paths and query values are given *decoded*; this module does the encoding.
"""
import datetime
import hashlib
import hmac
import posixpath
import re
from dataclasses import dataclass, field
from urllib.parse import quote

ALGORITHM = 'AWS4-HMAC-SHA256'
UNSIGNED = 'UNSIGNED-PAYLOAD'
EMPTY_SHA256 = hashlib.sha256(b'').hexdigest()


@dataclass
class Credentials:
    access_key: str
    secret_key: str
    token: str | None = None


@dataclass
class Signed:
    canonical_request: str
    string_to_sign: str
    signature: str
    headers: list = field(default_factory=list)   # [(name, value)] to add to the request
    query: list = field(default_factory=list)     # [(name, value)] full query incl. X-Amz-* (presign)


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


def uri_encode(value, keep_slash=False):
    return quote(value, safe='-_.~' + ('/' if keep_slash else ''))


def amz_date(now):
    now = now.astimezone(datetime.timezone.utc) if now.tzinfo else now
    return now.strftime('%Y%m%dT%H%M%SZ')


def _normalize_path(path):
    if not path:
        return '/'
    trailing = path.endswith('/') and path != '/'
    out = posixpath.normpath(path)
    out = re.sub('/+', '/', out)
    if out.startswith('//'):
        out = '/' + out.lstrip('/')
    if not out.startswith('/'):
        out = '/' + out
    if trailing and not out.endswith('/'):
        out += '/'
    return out


def canonical_path(path, normalize=True):
    path = path or '/'
    if normalize:
        path = _normalize_path(path)
    return uri_encode(path, keep_slash=True)


def canonical_query(pairs):
    enc = sorted((uri_encode(k), uri_encode(v or '')) for k, v in pairs)
    return '&'.join(f'{k}={v}' for k, v in enc)


def _canonical_headers(headers):
    merged = {}
    for name, value in headers:
        key = name.strip().lower()
        val = re.sub(r'\s+', ' ', str(value).strip())
        merged[key] = f'{merged[key]},{val}' if key in merged else val
    names = sorted(merged)
    return ''.join(f'{n}:{merged[n]}\n' for n in names), ';'.join(names)


def signing_key(secret_key, date, region, service):
    k = hmac.new(('AWS4' + secret_key).encode(), date.encode(), hashlib.sha256).digest()
    for part in (region, service, 'aws4_request'):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    return k


def _finish(method, path, query, headers, payload_hash, creds, region, service, stamp, normalize):
    canon_headers, signed_names = _canonical_headers(headers)
    canonical = '\n'.join([method.upper(), canonical_path(path, normalize), canonical_query(query),
                           canon_headers, signed_names, payload_hash])
    scope = f'{stamp[:8]}/{region}/{service}/aws4_request'
    sts = '\n'.join([ALGORITHM, stamp, scope, sha256_hex(canonical)])
    sig = hmac.new(signing_key(creds.secret_key, stamp[:8], region, service), sts.encode(),
                   hashlib.sha256).hexdigest()
    return canonical, sts, sig, scope, signed_names


def sign(method, path, query, headers, creds, region, service, now, payload_hash=EMPTY_SHA256,
         normalize=True, add_content_sha256=False, sign_token=True):
    """Header signing. Returns the headers to add (X-Amz-Date, token, Authorization)."""
    stamp = amz_date(now)
    added = [('X-Amz-Date', stamp)]
    if add_content_sha256:
        added.append(('x-amz-content-sha256', payload_hash))
    if creds.token and sign_token:
        added.append(('X-Amz-Security-Token', creds.token))
    canonical, sts, sig, scope, signed_names = _finish(
        method, path, query, list(headers) + added, payload_hash, creds, region, service, stamp, normalize)
    if creds.token and not sign_token:
        added.append(('X-Amz-Security-Token', creds.token))
    added.append(('Authorization', f'{ALGORITHM} Credential={creds.access_key}/{scope}, '
                                   f'SignedHeaders={signed_names}, Signature={sig}'))
    return Signed(canonical, sts, sig, headers=added)


def presign(method, path, query, headers, creds, region, service, now, expires=3600,
            payload_hash=UNSIGNED, normalize=True, sign_token=True):
    """Query-string signing (presigned URL). `query` of the result is the full query."""
    stamp = amz_date(now)
    _, signed_names = _canonical_headers(headers)
    q = list(query) + [
        ('X-Amz-Algorithm', ALGORITHM),
        ('X-Amz-Credential', f'{creds.access_key}/{stamp[:8]}/{region}/{service}/aws4_request'),
        ('X-Amz-Date', stamp),
        ('X-Amz-Expires', str(int(expires))),
        ('X-Amz-SignedHeaders', signed_names),
    ]
    if creds.token and sign_token:
        q.append(('X-Amz-Security-Token', creds.token))
    canonical, sts, sig, _, _ = _finish(method, path, q, headers, payload_hash, creds, region, service,
                                        stamp, normalize)
    if creds.token and not sign_token:
        q.append(('X-Amz-Security-Token', creds.token))
    q.append(('X-Amz-Signature', sig))
    return Signed(canonical, sts, sig, query=q)


def encode_query(pairs):
    """Query string for a URL (same encoding as the canonical form, original order)."""
    return '&'.join(f'{uri_encode(k)}={uri_encode(v or "")}' for k, v in pairs)
