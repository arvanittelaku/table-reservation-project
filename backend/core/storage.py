"""File storage for avatars (what Supabase Storage did).

Two interchangeable backends, chosen by STORAGE_BACKEND:
  * local: files under STORAGE_ROOT/<bucket>/<path> (a mounted volume)
  * s3:    objects <S3_KEY_PREFIX><bucket>/<path> in one S3-compatible bucket
           (Cloudflare R2, Hetzner Object Storage, AWS S3, MinIO); see core/s3.py
The app-facing API is identical for both. The access rules are the same as
the old storage policies:
  * signed-in users may write/delete only inside their own folder (<uid>/...)
  * signed-in users may read any avatar, through signed URLs that expire
Local: signed URLs point at this backend (/storage/v1/object/sign/...).
S3: they are presigned GET URLs of the bucket (S3_SIGNED_URL_MODE=presigned,
default), or a backend URL that redirects to one (redirect) or streams the
object through (proxy). Same JSON shape (signedURL/signedUrl) in every mode.
"""
import mimetypes
import os
import time
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.utils import timezone

SIGN_SALT = 'ejb.storage'


class StorageError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def bucket_config(bucket):
    cfg = settings.STORAGE_BUCKETS.get(bucket)
    if not cfg:
        raise StorageError('Bucket not found', 404)
    return cfg


def _clean_path(path):
    parts = [p for p in (path or '').split('/') if p not in ('', '.')]
    if not parts or any(p == '..' or '\\' in p or '\x00' in p for p in parts):
        raise StorageError('Invalid path')
    return '/'.join(parts)


def _file(bucket, path):
    root = (Path(settings.STORAGE_ROOT) / bucket).resolve()
    full = (root / path).resolve()
    if root not in full.parents:
        raise StorageError('Invalid path')
    return full


# ───────────── backends ─────────────

class LocalBackend:
    name = 'local'

    def exists(self, bucket, path):
        return _file(bucket, path).is_file()

    def existing(self, bucket, paths):
        return {p for p in paths if self.exists(bucket, p)}

    def put(self, bucket, path, data, content_type):
        target = _file(bucket, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + '.part')
        tmp.write_bytes(data)
        os.replace(tmp, target)

    def delete(self, bucket, path):
        f = _file(bucket, path)
        if f.exists():
            f.unlink()
            return True
        return False

    def delete_prefix(self, bucket, prefix):
        root = _file(bucket, prefix)
        if root.is_dir():
            for p in sorted(root.rglob('*'), reverse=True):
                p.unlink() if p.is_file() else p.rmdir()
            root.rmdir()

    def get(self, bucket, path):
        f = _file(bucket, path)
        if not f.is_file():
            return None
        return f.read_bytes(), mimetypes.guess_type(str(f))[0] or 'application/octet-stream'

    def check(self):
        settings.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
        probe = settings.STORAGE_ROOT / '.preflight'
        probe.write_text('ok')
        probe.unlink()
        return str(settings.STORAGE_ROOT)


class S3Backend:
    name = 's3'

    def __init__(self):
        from .s3 import S3Client
        self.client = S3Client(settings.S3_ENDPOINT_URL, settings.S3_BUCKET, settings.S3_ACCESS_KEY_ID,
                               settings.S3_SECRET_ACCESS_KEY, settings.S3_REGION)
        self.prefix = settings.S3_KEY_PREFIX

    def key(self, bucket, path):
        return f'{self.prefix}{bucket}/{path}'

    def exists(self, bucket, path):
        return self.client.head_object(self.key(bucket, path)) is not None

    def existing(self, bucket, paths):
        # every object is written through upload()/import and recorded, so the
        # table answers without one HEAD request per avatar
        from ejb.models import StorageObject
        return set(StorageObject.objects.filter(bucket=bucket, path__in=list(paths)).values_list('path', flat=True))

    def put(self, bucket, path, data, content_type):
        self.client.put_object(self.key(bucket, path), data, content_type)

    def delete(self, bucket, path):
        key = self.key(bucket, path)
        if self.client.head_object(key) is None:
            return False
        self.client.delete_object(key)
        return True

    def delete_prefix(self, bucket, prefix):
        for key in self.client.list_keys(self.key(bucket, prefix.rstrip('/') + '/')):
            self.client.delete_object(key)

    def get(self, bucket, path):
        return self.client.get_object(self.key(bucket, path))

    def presigned_url(self, bucket, path, expires):
        return self.client.presign_get(self.key(bucket, path), expires,
                                       {'response-cache-control': f'private, max-age={int(expires)}'})

    def check(self):
        key = self.key('.preflight', 'probe')
        self.client.put_object(key, b'ok', 'text/plain')
        self.client.delete_object(key)
        return f'{settings.S3_ENDPOINT_URL} bucket {settings.S3_BUCKET}'


@lru_cache(maxsize=1)
def _backend_for(kind):
    if kind == 'local':
        return LocalBackend()
    if kind == 's3':
        return S3Backend()
    raise RuntimeError(f'STORAGE_BACKEND must be local or s3, not {kind!r}')


def backend():
    return _backend_for(settings.STORAGE_BACKEND)


# ───────────── API used by the views, jobs and commands ─────────────

def can_write(claims, bucket, path):
    """Same as policies avatars_insert_own / update_own / delete_own."""
    return bool(claims) and path.split('/')[0] == claims['sub']


def _record(bucket, path, owner, size, content_type):
    from ejb.models import StorageObject
    StorageObject.objects.update_or_create(
        bucket=bucket, path=path,
        defaults={'owner': owner, 'size': size, 'content_type': content_type, 'updated_at': timezone.now()})


def upload(claims, bucket, path, data, content_type, upsert):
    cfg = bucket_config(bucket)
    path = _clean_path(path)
    if not can_write(claims, bucket, path):
        raise StorageError('new row violates row-level security policy', 403)
    if len(data) > cfg['max_bytes']:
        raise StorageError('The object exceeded the maximum allowed size', 413)
    content_type = (content_type or '').split(';')[0].strip().lower()
    if cfg.get('mime_types') and content_type not in cfg['mime_types']:
        raise StorageError(f'mime type {content_type or "unknown"} is not supported', 415)
    be = backend()
    if not upsert and be.exists(bucket, path):
        raise StorageError('The resource already exists', 409)
    be.put(bucket, path, data, content_type)
    _record(bucket, path, claims['sub'], len(data), content_type)
    return {'Key': f'{bucket}/{path}', 'path': path, 'id': f'{bucket}/{path}', 'fullPath': f'{bucket}/{path}'}


def store_object(bucket, path, data, content_type, owner=None):
    """Backend-internal write (e.g. import_supabase_avatars): no folder rule."""
    bucket_config(bucket)
    path = _clean_path(path)
    backend().put(bucket, path, data, content_type)
    _record(bucket, path, owner, len(data), content_type)


def exists(bucket, path):
    return backend().exists(bucket, _clean_path(path))


def remove(claims, bucket, paths):
    bucket_config(bucket)
    from ejb.models import StorageObject
    be = backend()
    removed = []
    for raw in paths or []:
        path = _clean_path(raw)
        if not can_write(claims, bucket, path):
            continue  # like RLS: silently not deleted
        if be.delete(bucket, path):
            removed.append({'name': path, 'bucket_id': bucket})
        StorageObject.objects.filter(bucket=bucket, path=path).delete()
    return removed


def delete_prefix(bucket, prefix):
    """Backend jobs (account deletion): remove a user's folder."""
    prefix = _clean_path(prefix)
    backend().delete_prefix(bucket, prefix)
    from ejb.models import StorageObject
    StorageObject.objects.filter(bucket=bucket, path__startswith=prefix.rstrip('/') + '/').delete()


def signed_url(bucket, path, expires_in=3600):
    """URL of this backend that serves the object until it expires."""
    exp = int(time.time()) + max(1, int(expires_in))
    token = signing.dumps({'b': bucket, 'p': path, 'e': exp}, salt=SIGN_SALT, compress=True)
    return f'{settings.API_URL}/storage/v1/object/sign/{bucket}/{path}?token={token}'


def _signed_for(bucket, path, expires_in):
    be = backend()
    if be.name == 's3' and settings.S3_SIGNED_URL_MODE == 'presigned':
        return be.presigned_url(bucket, path, expires_in)   # straight to the bucket
    return signed_url(bucket, path, expires_in)


def sign_urls(claims, bucket, paths, expires_in):
    cfg = bucket_config(bucket)
    if not claims and not cfg['public']:
        raise StorageError('Not signed in', 401)  # avatars_read_authenticated
    expires_in = max(1, min(int(expires_in or 3600), 7 * 24 * 3600))
    cleaned = []
    for raw in paths or []:
        try:
            cleaned.append((raw, _clean_path(raw)))
        except StorageError:
            cleaned.append((raw, None))
    present = backend().existing(bucket, [p for _, p in cleaned if p])
    out = []
    for raw, path in cleaned:
        if path is None:
            out.append({'path': raw, 'signedURL': None, 'signedUrl': None, 'error': 'Invalid path'})
        elif path not in present:
            out.append({'path': path, 'signedURL': None, 'signedUrl': None, 'error': 'Object not found'})
        else:
            url = _signed_for(bucket, path, expires_in)
            out.append({'path': path, 'signedURL': url, 'signedUrl': url, 'error': None})
    return out


def open_signed(bucket, path, token):
    """Check a signed URL. Returns ('file', Path, ctype) for local storage,
    ('redirect', url, max_age) or ('bytes', data, ctype) for S3."""
    try:
        data = signing.loads(token or '', salt=SIGN_SALT)
    except signing.BadSignature:
        raise StorageError('Invalid signature', 400)
    path = _clean_path(path)
    if data.get('b') != bucket or data.get('p') != path:
        raise StorageError('Invalid signature', 400)
    remaining = int(data.get('e', 0)) - time.time()
    if remaining < 0:
        raise StorageError('Signed URL expired', 400)
    be = backend()
    if be.name == 'local':
        f = _file(bucket, path)
        if not f.exists():
            raise StorageError('Object not found', 404)
        return 'file', f, mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
    if settings.S3_SIGNED_URL_MODE == 'proxy':
        got = be.get(bucket, path)
        if got is None:
            raise StorageError('Object not found', 404)
        return 'bytes', got[0], got[1]
    if not be.existing(bucket, [path]):
        raise StorageError('Object not found', 404)
    ttl = int(max(60, min(remaining, settings.S3_PRESIGN_TTL)))
    return 'redirect', be.presigned_url(bucket, path, ttl), max(0, ttl - 60)
