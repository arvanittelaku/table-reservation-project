"""File storage for avatars (what Supabase Storage did).

Files live under STORAGE_ROOT/<bucket>/<path> (a mounted volume in
production, or swap in an S3 implementation here). The access rules are the
same as the old storage policies:
  * signed-in users may write/delete only inside their own folder (<uid>/...)
  * signed-in users may read any avatar, through signed URLs that expire
"""
import mimetypes
import os
import time
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


def can_write(claims, bucket, path):
    """Same as policies avatars_insert_own / update_own / delete_own."""
    return bool(claims) and path.split('/')[0] == claims['sub']


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
    target = _file(bucket, path)
    if target.exists() and not upsert:
        raise StorageError('The resource already exists', 409)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + '.part')
    tmp.write_bytes(data)
    os.replace(tmp, target)
    from ejb.models import StorageObject
    StorageObject.objects.update_or_create(
        bucket=bucket, path=path,
        defaults={'owner': claims['sub'], 'size': len(data), 'content_type': content_type,
                  'updated_at': timezone.now()})
    return {'Key': f'{bucket}/{path}', 'path': path, 'id': f'{bucket}/{path}', 'fullPath': f'{bucket}/{path}'}


def remove(claims, bucket, paths):
    bucket_config(bucket)
    removed = []
    for raw in paths or []:
        path = _clean_path(raw)
        if not can_write(claims, bucket, path):
            continue  # like RLS: silently not deleted
        f = _file(bucket, path)
        if f.exists():
            f.unlink()
            removed.append({'name': path, 'bucket_id': bucket})
        from ejb.models import StorageObject
        StorageObject.objects.filter(bucket=bucket, path=path).delete()
    return removed


def delete_prefix(bucket, prefix):
    """Backend jobs (account deletion): remove a user's folder."""
    root = _file(bucket, _clean_path(prefix))
    if root.is_dir():
        for p in sorted(root.rglob('*'), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
        root.rmdir()
    from ejb.models import StorageObject
    StorageObject.objects.filter(bucket=bucket, path__startswith=prefix.rstrip('/') + '/').delete()


def sign_urls(claims, bucket, paths, expires_in):
    cfg = bucket_config(bucket)
    if not claims and not cfg['public']:
        raise StorageError('Not signed in', 401)  # avatars_read_authenticated
    expires_in = max(1, min(int(expires_in or 3600), 7 * 24 * 3600))
    exp = int(time.time()) + expires_in
    out = []
    for raw in paths or []:
        try:
            path = _clean_path(raw)
        except StorageError:
            out.append({'path': raw, 'signedURL': None, 'signedUrl': None, 'error': 'Invalid path'})
            continue
        if not _file(bucket, path).exists():
            out.append({'path': path, 'signedURL': None, 'signedUrl': None, 'error': 'Object not found'})
            continue
        token = signing.dumps({'b': bucket, 'p': path, 'e': exp}, salt=SIGN_SALT, compress=True)
        url = f'{settings.API_URL}/storage/v1/object/sign/{bucket}/{path}?token={token}'
        out.append({'path': path, 'signedURL': url, 'signedUrl': url, 'error': None})
    return out


def open_signed(bucket, path, token):
    try:
        data = signing.loads(token or '', salt=SIGN_SALT)
    except signing.BadSignature:
        raise StorageError('Invalid signature', 400)
    path = _clean_path(path)
    if data.get('b') != bucket or data.get('p') != path:
        raise StorageError('Invalid signature', 400)
    if int(data.get('e', 0)) < time.time():
        raise StorageError('Signed URL expired', 400)
    f = _file(bucket, path)
    if not f.exists():
        raise StorageError('Object not found', 404)
    ctype = mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
    return f, ctype
