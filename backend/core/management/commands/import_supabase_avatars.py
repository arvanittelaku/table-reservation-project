"""One-time move of profile photos from Supabase Storage into this backend.

    SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=... \
        python manage.py import_supabase_avatars [--dry-run]

Copies every object of the private `avatars` bucket to STORAGE_ROOT/avatars/
(same paths, so profiles.photo_path stays valid) and records it in
backend.storage_objects. Safe to run again: files already copied are skipped.
"""
import os

import requests
from django.core.management.base import BaseCommand, CommandError

from core.storage import _clean_path, _file
from ejb.models import StorageObject

BUCKET = 'avatars'


class Command(BaseCommand):
    help = 'Copy avatars from Supabase Storage into the Django backend storage'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        base = os.environ.get('SUPABASE_URL', '').rstrip('/')
        key = os.environ.get('SUPABASE_SERVICE_KEY', '')
        if not base or not key:
            raise CommandError('Set SUPABASE_URL and SUPABASE_SERVICE_KEY')
        headers = {'Authorization': f'Bearer {key}', 'apikey': key}

        def list_folder(prefix):
            out, offset = [], 0
            while True:
                r = requests.post(f'{base}/storage/v1/object/list/{BUCKET}', headers=headers, timeout=30,
                                  json={'prefix': prefix, 'limit': 100, 'offset': offset,
                                        'sortBy': {'column': 'name', 'order': 'asc'}})
                r.raise_for_status()
                page = r.json()
                out += page
                if len(page) < 100:
                    return out
                offset += 100

        paths = []
        for entry in list_folder(''):
            if entry.get('id') is None:  # a folder (user id)
                for f in list_folder(entry['name']):
                    if f.get('id') is not None:
                        paths.append(f"{entry['name']}/{f['name']}")
            else:
                paths.append(entry['name'])

        copied = skipped = 0
        for path in paths:
            path = _clean_path(path)
            target = _file(BUCKET, path)
            if target.exists():
                skipped += 1
                continue
            if opts['dry_run']:
                self.stdout.write(f'would copy {path}')
                continue
            r = requests.get(f'{base}/storage/v1/object/{BUCKET}/{path}', headers=headers, timeout=60)
            r.raise_for_status()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(r.content)
            owner = path.split('/')[0]
            StorageObject.objects.get_or_create(
                bucket=BUCKET, path=path,
                defaults={'owner': owner if len(owner) == 36 else None, 'size': len(r.content),
                          'content_type': r.headers.get('Content-Type', 'image/jpeg').split(';')[0]})
            copied += 1
        self.stdout.write(self.style.SUCCESS(f'{len(paths)} found, {copied} copied, {skipped} already present'))
