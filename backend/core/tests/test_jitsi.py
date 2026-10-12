"""JaaS room tokens: signed with a test RSA key pair, decoded and checked.

Run: cd backend && python3 -m unittest core.tests.test_jitsi
"""
import datetime
import time
import unittest
import uuid

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.db import transaction
from django.test import override_settings

from core import jitsi
from ejb import context, rpc
from ejb.context import Actor
from ejb.models import Lesson, LessonParticipant, LessonRoom, Profile, Tutor

APP = 'vpaas-magic-cookie-0123456789abcdef0123456789abcdef'
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIV = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                         serialization.NoEncryption()).decode()
PUB = KEY.public_key().public_bytes(serialization.Encoding.PEM,
                                    serialization.PublicFormat.SubjectPublicKeyInfo).decode()
OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
JAAS = dict(JAAS_APP_ID=APP, JAAS_KEY_ID=f'{APP}/4f4910', JAAS_PRIVATE_KEY=PRIV, JAAS_DOMAIN='8x8.vc',
            JITSI_APP_SECRET='')
NO_JAAS = dict(JAAS_APP_ID='', JAAS_KEY_ID='', JAAS_PRIVATE_KEY='', JITSI_DOMAIN='jitsi.example.org',
               JITSI_APP_SECRET='')
SECRET = 'x' * 40
OWN = dict(NO_JAAS, JITSI_DOMAIN='meet.example.org', JITSI_APP_ID='ejabashkohu', JITSI_APP_SECRET=SECRET)


def decode_own(token, key=SECRET):
    return jwt.decode(token, key, algorithms=['HS256'], audience='jitsi', issuer='ejabashkohu')


def decode(token, key=PUB):
    return jwt.decode(token, key, algorithms=['RS256'], audience='jitsi', issuer='chat')


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.ov = override_settings(**JAAS)
        self.ov.enable()

    def tearDown(self):
        self.ov.disable()

    def test_claims_and_header(self):
        t = jitsi.jaas_token('ejaBashkohu-abc', 'u1', 'Arta K', True, avatar='https://x/a.jpg',
                             expires_at=time.time() + 600)
        h = jwt.get_unverified_header(t)
        self.assertEqual((h['alg'], h['kid'], h['typ']), ('RS256', f'{APP}/4f4910', 'JWT'))
        c = decode(t)
        self.assertEqual((c['aud'], c['iss'], c['sub'], c['room']), ('jitsi', 'chat', APP, 'ejaBashkohu-abc'))
        u = c['context']['user']
        self.assertEqual((u['id'], u['name'], u['avatar'], u['moderator']), ('u1', 'Arta K', 'https://x/a.jpg', True))
        self.assertEqual(c['context']['features']['recording'], False)
        self.assertIn('livestreaming', c['context']['features'])
        self.assertTrue(c['nbf'] <= c['iat'] < c['exp'])

    def test_short_kid_gets_app_prefix(self):
        with override_settings(JAAS_KEY_ID='4f4910'):
            self.assertEqual(jwt.get_unverified_header(jitsi.jaas_token('r', 'u', 'n', False))['kid'], f'{APP}/4f4910')

    def test_wrong_key_rejected(self):
        with self.assertRaises(jwt.InvalidSignatureError):
            decode(jitsi.jaas_token('r', 'u', 'n', False), OTHER)

    def test_expired_rejected(self):
        t = jitsi.jaas_token('r', 'u', 'n', False, expires_at=time.time() - 5, now=time.time() - 100)
        with self.assertRaises(jwt.ExpiredSignatureError):
            decode(t)

    def test_room_access_shape(self):
        a = jitsi.room_access('ejaBashkohu-k', 'u', 'N', False,
                              closes_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1))
        self.assertEqual((a['provider'], a['domain'], a['room_name']), ('jaas', '8x8.vc', f'{APP}/ejaBashkohu-k'))
        self.assertEqual(a['script_url'], f'https://8x8.vc/{APP}/external_api.js')
        self.assertFalse(decode(a['jwt'])['context']['user']['moderator'])
        self.assertAlmostEqual(decode(a['jwt'])['exp'], time.time() + 3600, delta=5)

    def test_fallback_without_jaas(self):
        with override_settings(**NO_JAAS):
            a = jitsi.room_access('ejaBashkohu-k', 'u', 'N', True)
            self.assertEqual((a['provider'], a['domain'], a['room_name'], a['jwt']),
                             ('jitsi', 'jitsi.example.org', 'ejaBashkohu-k', None))
            self.assertEqual(a['script_url'], 'https://jitsi.example.org/external_api.js')


class Rollback(Exception):
    pass


def ensure_tutor():
    """An approved online tutor to test with (created if the dev data has none;
    the caller removes it again when `created` is True)."""
    t = Tutor.objects.filter(status='approved', online=True).select_related('user').first()
    if t is not None:
        return t, False
    p = Profile.objects.filter(is_admin=False).order_by('created_at').first()
    t = Tutor(user=p, headline='Video test tutor', bio='Tutor created by the video token test, removed afterwards.',
              subjects=['english'], price_cents=1000, city='Prishtinë', online=True, in_person=False,
              status='approved')
    t.save()
    return t, True


class LessonRoomTests(unittest.TestCase):
    """get_lesson_room through the RPC dispatcher, on dev-DB rows rolled back afterwards."""

    def run_in_lesson(self, fn, starts_in_min=5):
        try:
            with transaction.atomic():
                tutor, _ = ensure_tutor()   # rolled back with the rest
                student, stranger = Profile.objects.exclude(pk=tutor.pk).order_by('created_at')[:2]
                now = datetime.datetime.now(datetime.timezone.utc)
                lesson = Lesson.objects.create(tutor=tutor, subject_id=tutor.subjects[0], kind='individual',
                                               starts_at=now + datetime.timedelta(minutes=starts_in_min),
                                               duration_min=60, format='online', max_students=1, price_cents=0)
                LessonParticipant.objects.create(lesson=lesson, student=student, status='confirmed')
                room = LessonRoom.objects.create(lesson=lesson)
                fn(lesson, tutor, student, stranger, room)
                raise Rollback
        except Rollback:
            pass

    @staticmethod
    def call(user_id, lesson):
        with context.acting(Actor(uid=uuid.UUID(str(user_id)), role='authenticated')):
            return rpc.call('get_lesson_room', {'p_lesson': str(lesson.id)})

    def test_jaas_tutor_moderator_student_not(self):
        def check(lesson, tutor, student, stranger, room):
            with override_settings(**JAAS):
                t = self.call(tutor.pk, lesson)
                s = self.call(student.pk, lesson)
            for r in (t, s):   # old keys kept
                self.assertEqual(r['room'], 'ejaBashkohu-' + room.room_key)
                self.assertEqual(r['duration_min'], 60)
                self.assertIn('starts_at', r)
                self.assertEqual((r['provider'], r['domain']), ('jaas', '8x8.vc'))
                self.assertEqual(r['room_name'], f'{APP}/ejaBashkohu-{room.room_key}')
            ct, cs = decode(t['jwt']), decode(s['jwt'])
            self.assertTrue(ct['context']['user']['moderator'])
            self.assertFalse(cs['context']['user']['moderator'])
            self.assertEqual(ct['room'], 'ejaBashkohu-' + room.room_key)
            self.assertEqual(cs['context']['user']['id'], str(student.pk))
            self.assertEqual(cs['context']['user']['name'], student.full_name)
            closes = lesson.starts_at + datetime.timedelta(minutes=90)
            self.assertAlmostEqual(cs['exp'], closes.timestamp(), delta=5)
            self.assertNotEqual(t['jwt'], s['jwt'])
            # strangers still refused
            from core.db import DbError
            with override_settings(**JAAS), self.assertRaises(DbError):
                self.call(stranger.pk, lesson)
        self.run_in_lesson(check)

    def test_fallback_plain_room(self):
        def check(lesson, tutor, student, stranger, room):
            with override_settings(**NO_JAAS):
                s = self.call(student.pk, lesson)
            self.assertEqual((s['provider'], s['domain'], s['jwt']), ('jitsi', 'jitsi.example.org', None))
            self.assertEqual(s['room_name'], s['room'])
        self.run_in_lesson(check)

    def test_selfhosted_tokens(self):
        from core.db import DbError

        def check(lesson, tutor, student, stranger, room):
            with override_settings(**OWN):
                t = self.call(tutor.pk, lesson)
                s = self.call(student.pk, lesson)
                with self.assertRaises(DbError):
                    self.call(stranger.pk, lesson)
                # a cancelled (not confirmed) student gets nothing either
                LessonParticipant.objects.filter(lesson=lesson, student=student).update(status='cancelled')
                with self.assertRaises(DbError):
                    self.call(student.pk, lesson)
            name = 'ejaBashkohu-' + room.room_key
            closes = lesson.starts_at + datetime.timedelta(minutes=90)
            for r in (t, s):
                self.assertEqual(r['room'], name)                     # old keys kept
                self.assertEqual(r['duration_min'], 60)
                self.assertEqual((r['provider'], r['domain'], r['room_name']), ('jitsi-jwt', 'meet.example.org', name))
                self.assertEqual(r['script_url'], 'https://meet.example.org/external_api.js')
                self.assertEqual(jwt.get_unverified_header(r['jwt'])['alg'], 'HS256')
                c = decode_own(r['jwt'])                              # signature + aud + iss
                self.assertEqual((c['aud'], c['iss'], c['sub'], c['room']),
                                 ('jitsi', 'ejabashkohu', 'meet.example.org', name))
                self.assertEqual(c['exp'], int(closes.timestamp()))
            ct, cs = decode_own(t['jwt']), decode_own(s['jwt'])
            self.assertIs(ct['context']['user']['moderator'], True)
            self.assertIs(cs['context']['user']['moderator'], False)
            self.assertEqual(cs['context']['user']['id'], str(student.pk))
            self.assertEqual(ct['context']['user']['id'], str(tutor.pk))
            with self.assertRaises(jwt.InvalidSignatureError):
                decode_own(s['jwt'], 'y' * 40)
        self.run_in_lesson(check)

    def test_selfhosted_wins_over_jaas(self):
        a = None
        with override_settings(**dict(JAAS, **{k: v for k, v in OWN.items() if k.startswith('JITSI')})):
            a = jitsi.room_access('r', 'u', 'N', False)
        self.assertEqual((a['provider'], decode_own(a['jwt'])['room']), ('jitsi-jwt', 'r'))

    def test_time_window_unchanged(self):
        from core.db import DbError

        def check(lesson, tutor, student, stranger, room):
            with override_settings(**JAAS), self.assertRaises(DbError) as e:
                self.call(student.pk, lesson)
            self.assertIn('15 minuta', str(e.exception.as_dict()))
        self.run_in_lesson(check, starts_in_min=60)


if __name__ == '__main__':
    unittest.main()
