"""Storage with STORAGE_BACKEND=s3 against dev/fake_s3.py (SigV4-checking fake S3),
plus import_supabase_avatars writing through the configured backend.

Run: cd backend && python3 -m unittest core.tests.test_storage_s3
"""
import io
import threading
import time
import unittest
import uuid
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.parse import parse_qsl, urlsplit

import requests
from django.core.management import call_command
from django.db import transaction
from django.test import override_settings

from core import storage
from core.s3 import S3Client, S3Error
from dev import fake_s3
from ejb.models import Profile, StorageObject

JPG = b'\xff\xd8\xff\xe0' + b'1' * 3000


class Rollback(Exception):
    pass


def start_fake():
    fake_s3.Handler.access, fake_s3.Handler.secret = 'AKTEST', 'sekret/Test+Key'
    srv = ThreadingHTTPServer(('127.0.0.1', 0), fake_s3.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class S3StorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = start_fake()
        cls.endpoint = f'http://127.0.0.1:{cls.srv.server_address[1]}'
        cls.ov = override_settings(STORAGE_BACKEND='s3', S3_ENDPOINT_URL=cls.endpoint, S3_BUCKET='ejb-test',
                                   S3_ACCESS_KEY_ID='AKTEST', S3_SECRET_ACCESS_KEY='sekret/Test+Key',
                                   S3_REGION='auto', S3_KEY_PREFIX='t/', S3_SIGNED_URL_MODE='redirect',
                                   S3_PRESIGN_TTL=3600)
        cls.ov.enable()
        storage._backend_for.cache_clear()

    @classmethod
    def tearDownClass(cls):
        cls.ov.disable()
        storage._backend_for.cache_clear()
        cls.srv.shutdown()

    def setUp(self):
        fake_s3.OBJECTS.clear()
        self.uid, self.other = [str(p) for p in Profile.objects.order_by('created_at').values_list('pk', flat=True)[:2]]
        self.claims = {'sub': self.uid}

    def in_tx(self, fn):
        try:
            with transaction.atomic():
                fn()
                raise Rollback
        except Rollback:
            pass

    def test_client_roundtrip_and_auth(self):
        c = S3Client(self.endpoint, 'b', 'AKTEST', 'sekret/Test+Key')
        c.put_object('dir/a b+c.txt', b'hello', 'text/plain')
        self.assertEqual(c.get_object('dir/a b+c.txt'), (b'hello', 'text/plain'))
        self.assertEqual(c.head_object('dir/a b+c.txt')['size'], 5)
        self.assertEqual(c.list_keys('dir/'), ['dir/a b+c.txt'])
        self.assertIsNone(c.get_object('missing'))
        url = c.presign_get('dir/a b+c.txt', 60)
        self.assertEqual(requests.get(url).content, b'hello')
        self.assertEqual(requests.get(url.replace('X-Amz-Signature=', 'X-Amz-Signature=0')).status_code, 403)
        q = dict(parse_qsl(urlsplit(url).query))
        self.assertEqual(q['X-Amz-Expires'], '60')
        bad = S3Client(self.endpoint, 'b', 'AKTEST', 'wrong-secret')
        with self.assertRaises(S3Error) as e:
            bad.put_object('x', b'1')
        self.assertEqual(e.exception.status, 403)
        c.delete_object('dir/a b+c.txt')
        self.assertEqual(c.list_keys('dir/'), [])

    def test_expired_presigned_refused(self):
        c = S3Client(self.endpoint, 'b', 'AKTEST', 'sekret/Test+Key')
        c.put_object('k', b'1')
        url = c.presign_get('k', 1)
        time.sleep(2.1)
        self.assertEqual(requests.get(url).status_code, 403)

    def test_upload_sign_serve_remove(self):
        def run():
            r = storage.upload(self.claims, 'avatars', f'{self.uid}/avatar.jpg', JPG, 'image/jpeg', True)
            self.assertEqual(r['path'], f'{self.uid}/avatar.jpg')
            self.assertIn(('ejb-test', f't/avatars/{self.uid}/avatar.jpg'), fake_s3.OBJECTS)
            with self.assertRaises(storage.StorageError) as e:
                storage.upload(self.claims, 'avatars', f'{self.uid}/avatar.jpg', JPG, 'image/jpeg', False)
            self.assertEqual(e.exception.status, 409)
            with self.assertRaises(storage.StorageError) as e:
                storage.upload(self.claims, 'avatars', f'{self.other}/avatar.jpg', JPG, 'image/jpeg', True)
            self.assertEqual(e.exception.status, 403)
            signed = storage.sign_urls(self.claims, 'avatars', [f'{self.uid}/avatar.jpg', 'nobody/x.jpg'], 600)
            self.assertTrue(signed[0]['signedUrl'].startswith('http://localhost:8000/storage/v1/object/sign/avatars/'))
            self.assertEqual(signed[1]['error'], 'Object not found')
            token = dict(parse_qsl(urlsplit(signed[0]['signedUrl']).query))['token']
            kind, url, max_age = storage.open_signed('avatars', f'{self.uid}/avatar.jpg', token)
            self.assertEqual(kind, 'redirect')
            self.assertLessEqual(max_age, 600)
            got = requests.get(url)
            self.assertEqual((got.status_code, got.content, got.headers['Content-Type']), (200, JPG, 'image/jpeg'))
            with self.assertRaises(storage.StorageError):
                storage.open_signed('avatars', f'{self.uid}/avatar.jpg', token + 'x')
            with override_settings(S3_SIGNED_URL_MODE='proxy'):
                kind, data, ctype = storage.open_signed('avatars', f'{self.uid}/avatar.jpg', token)
                self.assertEqual((kind, data, ctype), ('bytes', JPG, 'image/jpeg'))
            # someone else cannot remove it; the owner can
            self.assertEqual(storage.remove({'sub': self.other}, 'avatars', [f'{self.uid}/avatar.jpg']), [])
            self.assertEqual(len(storage.remove(self.claims, 'avatars', [f'{self.uid}/avatar.jpg'])), 1)
            self.assertNotIn(('ejb-test', f't/avatars/{self.uid}/avatar.jpg'), fake_s3.OBJECTS)
            self.assertFalse(StorageObject.objects.filter(bucket='avatars', path=f'{self.uid}/avatar.jpg').exists())
        self.in_tx(run)

    def test_presigned_mode_returns_bucket_url(self):
        def run():
            storage.upload(self.claims, 'avatars', f'{self.uid}/avatar.jpg', JPG, 'image/jpeg', True)
            with override_settings(S3_SIGNED_URL_MODE='presigned'):
                row = storage.sign_urls(self.claims, 'avatars', [f'{self.uid}/avatar.jpg'], 600)[0]
            self.assertEqual(row['signedURL'], row['signedUrl'])
            self.assertTrue(row['signedUrl'].startswith(f'{self.endpoint}/ejb-test/t/avatars/{self.uid}/avatar.jpg?'))
            q = dict(parse_qsl(urlsplit(row['signedUrl']).query))
            self.assertEqual(q['X-Amz-Expires'], '600')
            got = requests.get(row['signedUrl'])
            self.assertEqual((got.status_code, got.content), (200, JPG))
        self.in_tx(run)

    def test_delete_prefix(self):
        def run():
            for n in ('a.jpg', 'b.jpg'):
                storage.upload(self.claims, 'avatars', f'{self.uid}/{n}', JPG, 'image/jpeg', True)
            storage.upload({'sub': self.other}, 'avatars', f'{self.other}/keep.jpg', JPG, 'image/jpeg', True)
            storage.delete_prefix('avatars', f'{self.uid}/')
            keys = sorted(k for _, k in fake_s3.OBJECTS)
            self.assertEqual(keys, [f't/avatars/{self.other}/keep.jpg'])
            self.assertEqual(StorageObject.objects.filter(bucket='avatars', path__startswith=self.uid).count(), 0)
        self.in_tx(run)

    def test_import_supabase_avatars_writes_to_s3(self):
        listing = {'': [{'name': self.uid, 'id': None}], self.uid: [{'name': 'avatar.jpg', 'id': 'x'}]}

        def fake_post(url, json=None, **kw):
            r = mock.Mock(status_code=200)
            r.json.return_value = listing.get(json['prefix'], []) if json['offset'] == 0 else []
            r.raise_for_status = lambda: None
            return r

        def fake_get(url, **kw):
            self.assertTrue(url.endswith(f'/storage/v1/object/avatars/{self.uid}/avatar.jpg'))
            r = mock.Mock(status_code=200, content=JPG, headers={'Content-Type': 'image/jpeg'})
            r.raise_for_status = lambda: None
            return r

        def run():
            out = io.StringIO()
            with mock.patch.dict('os.environ', {'SUPABASE_URL': 'https://sb.example', 'SUPABASE_SERVICE_KEY': 'k'}), \
                    mock.patch('core.management.commands.import_supabase_avatars.requests.post', fake_post), \
                    mock.patch('core.management.commands.import_supabase_avatars.requests.get', fake_get):
                call_command('import_supabase_avatars', stdout=out)
                self.assertIn('1 found, 1 copied, 0 already present', out.getvalue())
                self.assertEqual(fake_s3.OBJECTS[('ejb-test', f't/avatars/{self.uid}/avatar.jpg')][0], JPG)
                row = StorageObject.objects.get(bucket='avatars', path=f'{self.uid}/avatar.jpg')
                self.assertEqual((str(row.owner), row.size), (self.uid, len(JPG)))
                out = io.StringIO()
                call_command('import_supabase_avatars', stdout=out)   # again: skipped
                self.assertIn('1 found, 0 copied, 1 already present', out.getvalue())
        self.in_tx(run)


    def test_copy_local_files_to_s3(self):
        def run():
            with override_settings(STORAGE_BACKEND='local'):
                storage._backend_for.cache_clear()
                storage.upload(self.claims, 'avatars', f'{self.uid}/copy-test.jpg', JPG, 'image/jpeg', True)
            storage._backend_for.cache_clear()
            try:
                out = io.StringIO()
                call_command('copy_storage_to_s3', stdout=out, stderr=io.StringIO())
                self.assertRegex(out.getvalue(), r'[1-9]\d* copied')   # (plus any other dev-DB files)
                self.assertEqual(fake_s3.OBJECTS[('ejb-test', f't/avatars/{self.uid}/copy-test.jpg')][0], JPG)
                out = io.StringIO()
                call_command('copy_storage_to_s3', stdout=out, stderr=io.StringIO())
                self.assertIn('0 copied', out.getvalue())
            finally:
                storage.LocalBackend().delete('avatars', f'{self.uid}/copy-test.jpg')
        self.in_tx(run)


class LocalStorageTests(unittest.TestCase):
    def test_local_backend_selected_by_default(self):
        storage._backend_for.cache_clear()
        self.assertEqual(storage.backend().name, 'local')


if __name__ == '__main__':
    unittest.main()
