"""SigV4 against AWS's published test vectors.

* sigv4_vectors/: the SigV4 test suite as maintained in awslabs/aws-c-auth
  (tests/aws-signing-test-suite/v4, Apache-2.0, commit 84a26ea). Each case is
  checked in header mode and query (presign) mode: canonical request,
  string to sign and signature.
* The S3 examples from the AWS docs ("Signature Calculations for the
  Authorization Header" / "Authenticating Requests: Using Query Parameters").

Run: cd backend && python3 -m unittest core.tests.test_sigv4
"""
import datetime
import hashlib
import json
import unittest
from pathlib import Path
from urllib.parse import unquote

from core import sigv4

VECTORS = Path(__file__).parent / 'sigv4_vectors'
UTC = datetime.timezone.utc


def parse_request(text):
    head, _, body = text.partition('\n\n')
    lines = head.split('\n')
    # request line: METHOD <target with possible spaces> HTTP/1.1
    first = lines[0]
    method = first.split(' ', 1)[0]
    target = first[len(method) + 1:first.rindex(' HTTP/')]
    headers = []
    for line in lines[1:]:
        if line.startswith((' ', '\t')) and headers:     # folded continuation line
            n, v = headers[-1]
            headers[-1] = (n, v + ' ' + line.strip())
        elif line:
            n, v = line.split(':', 1)
            headers.append((n, v))
    path, _, qs = target.partition('?')
    query = []
    for part in qs.split('&') if qs else []:
        k, _, v = part.partition('=')
        query.append((unquote(k), unquote(v)))
    return method, path, query, headers, body.encode()


def load_case(d):
    ctx = json.loads((d / 'context.json').read_text())
    c = ctx['credentials']
    creds = sigv4.Credentials(c['access_key_id'], c['secret_access_key'], c.get('token'))
    now = datetime.datetime.strptime(ctx['timestamp'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    return ctx, creds, now, parse_request((d / 'request.txt').read_text())


def read(d, name):
    return (d / name).read_text()


class TestSuiteVectors(unittest.TestCase):
    def test_vectors(self):
        cases = sorted(p for p in VECTORS.iterdir() if p.is_dir())
        self.assertGreaterEqual(len(cases), 30)
        checked = 0
        for d in cases:
            ctx, creds, now, (method, path, query, headers, body) = load_case(d)
            payload = hashlib.sha256(body).hexdigest()
            with self.subTest(case=d.name, mode='header'):
                s = sigv4.sign(method, path, query, headers, creds, ctx['region'], ctx['service'], now,
                               payload_hash=payload, normalize=ctx['normalize'],
                               add_content_sha256=ctx['sign_body'],
                               sign_token=not ctx.get('omit_session_token', False))
                self.assertEqual(s.canonical_request, read(d, 'header-canonical-request.txt'))
                self.assertEqual(s.string_to_sign, read(d, 'header-string-to-sign.txt'))
                self.assertEqual(s.signature, read(d, 'header-signature.txt').strip())
                auth = dict(s.headers)['Authorization']
                self.assertIn(auth, read(d, 'header-signed-request.txt'))
            with self.subTest(case=d.name, mode='query'):
                s = sigv4.presign(method, path, query, headers, creds, ctx['region'], ctx['service'], now,
                                  expires=ctx['expiration_in_seconds'], payload_hash=payload,
                                  normalize=ctx['normalize'],
                                  sign_token=not ctx.get('omit_session_token', False))
                self.assertEqual(s.canonical_request, read(d, 'query-canonical-request.txt'))
                self.assertEqual(s.string_to_sign, read(d, 'query-string-to-sign.txt'))
                self.assertEqual(s.signature, read(d, 'query-signature.txt').strip())
            checked += 1
        self.assertEqual(checked, len(cases))


S3_CREDS = sigv4.Credentials('AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
S3_NOW = datetime.datetime(2013, 5, 24, tzinfo=UTC)
HOST = [('Host', 'examplebucket.s3.amazonaws.com')]


class TestS3Examples(unittest.TestCase):
    def test_get_object_with_range(self):
        s = sigv4.sign('GET', '/test.txt', [], HOST + [('Range', 'bytes=0-9')], S3_CREDS, 'us-east-1', 's3',
                       S3_NOW, payload_hash=sigv4.EMPTY_SHA256, normalize=False, add_content_sha256=True)
        self.assertEqual(s.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')

    def test_put_object(self):
        body = b'Welcome to Amazon S3.'
        s = sigv4.sign('PUT', '/test$file.text', [],
                       HOST + [('Date', 'Fri, 24 May 2013 00:00:00 GMT'), ('x-amz-storage-class', 'REDUCED_REDUNDANCY')],
                       S3_CREDS, 'us-east-1', 's3', S3_NOW, payload_hash=sigv4.sha256_hex(body),
                       normalize=False, add_content_sha256=True)
        self.assertEqual(s.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')

    def test_get_bucket_lifecycle(self):
        s = sigv4.sign('GET', '/', [('lifecycle', '')], HOST, S3_CREDS, 'us-east-1', 's3', S3_NOW,
                       payload_hash=sigv4.EMPTY_SHA256, normalize=False, add_content_sha256=True)
        self.assertEqual(s.signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543')

    def test_list_objects(self):
        s = sigv4.sign('GET', '/', [('max-keys', '2'), ('prefix', 'J')], HOST, S3_CREDS, 'us-east-1', 's3',
                       S3_NOW, payload_hash=sigv4.EMPTY_SHA256, normalize=False, add_content_sha256=True)
        self.assertEqual(s.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')

    def test_presigned_get(self):
        s = sigv4.presign('GET', '/test.txt', [], HOST, S3_CREDS, 'us-east-1', 's3', S3_NOW, expires=86400,
                          normalize=False)
        self.assertEqual(s.signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
        self.assertEqual(dict(s.query)['X-Amz-Credential'], 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request')

    def test_signing_key_example(self):
        # AWS docs, "Examples of how to derive a signing key for Signature Version 4"
        k = sigv4.signing_key('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam')
        self.assertEqual(k.hex(), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d')


if __name__ == '__main__':
    unittest.main()
