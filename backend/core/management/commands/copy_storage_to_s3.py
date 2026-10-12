"""Copy files from the local storage folder to the S3 bucket (switching STORAGE_BACKEND
from local to s3 on a server that already has photos).

    STORAGE_BACKEND=s3 S3_...=... python manage.py copy_storage_to_s3 [--dry-run]

Reads STORAGE_ROOT/<bucket>/<path> for every row of backend.storage_objects
and writes it to the configured S3 bucket (same keys). Safe to run again:
objects already in the bucket are skipped. Run it with the S3 settings
active, then restart the backend with STORAGE_BACKEND=s3.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import storage
from ejb.models import StorageObject


class Command(BaseCommand):
    help = 'Copy local storage files into the S3 bucket (STORAGE_BACKEND=s3)'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        if settings.STORAGE_BACKEND != 's3':
            raise CommandError('Run with STORAGE_BACKEND=s3 and the S3_* settings')
        local, s3 = storage.LocalBackend(), storage.backend()
        copied = skipped = missing = 0
        for obj in StorageObject.objects.order_by('bucket', 'path'):
            got = local.get(obj.bucket, obj.path)
            if got is None:
                missing += 1
                self.stderr.write(f'missing locally: {obj.bucket}/{obj.path}')
                continue
            if s3.exists(obj.bucket, obj.path):
                skipped += 1
                continue
            if opts['dry_run']:
                self.stdout.write(f'would copy {obj.bucket}/{obj.path}')
                continue
            s3.put(obj.bucket, obj.path, got[0], obj.content_type or got[1])
            copied += 1
        self.stdout.write(self.style.SUCCESS(f'{copied} copied, {skipped} already in S3, {missing} missing locally'))
