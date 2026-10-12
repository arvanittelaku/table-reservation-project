"""Video room JWTs from get_lesson_room: self-hosted Jitsi (HS256) and 8x8 JaaS (RS256).

Run: cd backend && MSGPACK_PUREPYTHON=1 python3 dev/test_video_tokens.py
Uses database ejb_dev; every change happens inside one transaction that is rolled back.
"""
import datetime
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ.setdefault('MSGPACK_PUREPYTHON', '1')
os.environ['DB_NAME'] = 'ejb_dev'
import django  # noqa: E402

django.setup()

import jwt  # noqa: E402
from django.db import transaction  # noqa: E402
from django.test import override_settings  # noqa: E402
from django.utils import timezone  # noqa: E402

from ejb import context, rpc  # noqa: E402
from ejb.context import Actor  # noqa: E402
from ejb.errors import ApiError  # noqa: E402
from ejb.models import Lesson, LessonParticipant, LessonRoom, LessonSubject, Profile, Tutor  # noqa: E402

import ejb.services  # noqa: E402,F401

SECRET = 'test-secret-' + uuid.uuid4().hex
DOMAIN = 'meet.example.test'
APP = 'ejabashkohu-test'
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

_rsa = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIV = _rsa.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                          serialization.NoEncryption()).decode()
PUB = _rsa.public_key().public_bytes(serialization.Encoding.PEM,
                                     serialization.PublicFormat.SubjectPublicKeyInfo).decode()
JAAS_APP = 'vpaas-magic-cookie-0123456789abcdef'
NOKEYS = dict(JAAS_APP_ID='', JAAS_KEY_ID='', JAAS_API_KEY_ID='', JAAS_PRIVATE_KEY='', JITSI_APP_SECRET='')
JITSI_ON = dict(NOKEYS, VIDEO_PROVIDER='jitsi', JITSI_APP_SECRET=SECRET, JITSI_DOMAIN=DOMAIN, JITSI_APP_ID=APP)
JAAS_ON = dict(NOKEYS, VIDEO_PROVIDER='jaas', JAAS_APP_ID=JAAS_APP, JAAS_API_KEY_ID='abc123',
               JAAS_PRIVATE_KEY=PRIV, JAAS_DOMAIN='8x8.vc', JITSI_DOMAIN='meet.jit.si')
JITSI_OFF = dict(NOKEYS, VIDEO_PROVIDER='', JITSI_DOMAIN='meet.jit.si')

passed = failed = 0


def check(name, cond, extra=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  ok   {name}')
    else:
        failed += 1
        print(f'  FAIL {name} {extra}')


def room_as(uid, lesson_id):
    with context.acting(Actor(uid=uid, role='authenticated')):
        return rpc.call('get_lesson_room', {'p_lesson': str(lesson_id)})


def err_as(uid, lesson_id):
    try:
        room_as(uid, lesson_id)
    except ApiError as e:
        return str(getattr(e, 'message', e))
    return None


def decode(token):
    return jwt.decode(token, SECRET, algorithms=['HS256'], audience='jitsi', issuer=APP)


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


def main():
    tutor, created = ensure_tutor()
    try:
        return _main(tutor)
    finally:
        if created:
            tutor.delete()


def _main(tutor):
    others = list(Profile.objects.exclude(pk=tutor.pk).values_list('pk', flat=True)[:3])
    assert tutor and len(others) == 3, 'ejb_dev needs a tutor and 3 other profiles (dev/seed.sql)'
    student, requested, stranger = others
    subject = LessonSubject.objects.first()
    now = timezone.now()
    try:
        with transaction.atomic():
            lesson = Lesson.objects.create(tutor=tutor, subject=subject, kind='group', title='Video test',
                                           starts_at=now - datetime.timedelta(minutes=5), duration_min=60,
                                           format='online', max_students=5, price_cents=0)
            LessonParticipant.objects.create(lesson=lesson, student_id=student, status='confirmed')
            LessonParticipant.objects.create(lesson=lesson, student_id=requested, status='requested')
            LessonRoom.objects.filter(lesson=lesson).delete()
            key = LessonRoom.objects.create(lesson=lesson).room_key
            room = 'ejaBashkohu-' + key
            closes_at = lesson.starts_at + datetime.timedelta(minutes=60 + 30)

            print('secret set (self-hosted Jitsi):')
            with override_settings(**JITSI_ON):
                t = room_as(tutor.pk, lesson.id)
                s = room_as(student, lesson.id)
                check('tutor gets token + domain', t.get('jwt') and t.get('domain') == DOMAIN, t)
                check('student gets token', bool(s.get('jwt')))
                check('room name unchanged', t['room'] == room and t['room_name'] == room)
                ct, cs = decode(t['jwt']), decode(s['jwt'])   # verifies signature, aud, iss, exp
                check('claims aud/iss/sub', ct['aud'] == 'jitsi' and ct['iss'] == APP and ct['sub'] == DOMAIN)
                check('room claim = this room only', ct['room'] == room and cs['room'] == room)
                check('tutor is moderator', ct['context']['user']['moderator'] is True)
                check('student is not moderator', cs['context']['user']['moderator'] is False)
                check('user id/name', ct['context']['user']['id'] == str(tutor.pk)
                      and cs['context']['user']['id'] == str(student) and 'name' in cs['context']['user'])
                check('exp = lesson window close', abs(ct['exp'] - closes_at.timestamp()) <= 1,
                      (ct['exp'], closes_at.timestamp()))
                check('exp after lesson end', ct['exp'] > (lesson.starts_at + datetime.timedelta(minutes=60)).timestamp())
                try:
                    jwt.decode(t['jwt'], 'wrong-secret-' + 'x' * 32, algorithms=['HS256'], audience='jitsi')
                    check('wrong secret rejected', False)
                except jwt.InvalidSignatureError:
                    check('wrong secret rejected', True)
                try:
                    jwt.decode(t['jwt'], SECRET, algorithms=['HS256'], audience='jitsi',
                               options={'verify_exp': True, 'verify_iat': False, 'verify_nbf': False}, leeway=-(ct['exp'] - int(now.timestamp()) + 1))
                    check('token expires', False)
                except jwt.ExpiredSignatureError:
                    check('token expires', True)
                check('stranger refused', err_as(stranger, lesson.id) == 'Nuk ke qasje në këtë mësim')
                check('requested student refused', err_as(requested, lesson.id) == 'Nuk ke qasje në këtë mësim')
                check('signed-out refused', err_as(None, lesson.id) is not None)
                # time window still enforced
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=now + datetime.timedelta(minutes=30))
                check('too early refused', err_as(tutor.pk, lesson.id) == 'Dhoma hapet 15 minuta para mësimit')
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=now - datetime.timedelta(minutes=120))
                check('too late refused', err_as(tutor.pk, lesson.id) == 'Mësimi ka përfunduar')
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=lesson.starts_at)

            print('VIDEO_PROVIDER=jaas (8x8 JaaS, RS256):')
            with override_settings(**JAAS_ON):
                t = room_as(tutor.pk, lesson.id)
                s = room_as(student, lesson.id)
                check('provider/domain', t['provider'] == 'jaas' and t['domain'] == '8x8.vc', t)
                check('room_name = appId/room', t['room_name'] == f'{JAAS_APP}/{room}' and t['room'] == room)
                check('script from 8x8.vc/<appId>', t['script_url'] == f'https://8x8.vc/{JAAS_APP}/external_api.js')
                hdr = jwt.get_unverified_header(t['jwt'])
                check('RS256 + kid appId/keyId', hdr['alg'] == 'RS256' and hdr['kid'] == f'{JAAS_APP}/abc123', hdr)
                ct = jwt.decode(t['jwt'], PUB, algorithms=['RS256'], audience='jitsi', issuer='chat')
                cs = jwt.decode(s['jwt'], PUB, algorithms=['RS256'], audience='jitsi', issuer='chat')
                check('claims sub=appId room=room', ct['sub'] == JAAS_APP and ct['room'] == room)
                check('tutor moderator / student not', ct['context']['user']['moderator'] is True
                      and cs['context']['user']['moderator'] is False)
                check('user id + name in context', cs['context']['user']['id'] == str(student)
                      and 'name' in cs['context']['user'] and 'avatar' in cs['context']['user'])
                f = ct['context']['features']
                check('features: recording/livestreaming off', f['recording'] is False
                      and f['livestreaming'] is False and f['transcription'] is False, f)
                check('exp = lesson end + 30 min', abs(ct['exp'] - closes_at.timestamp()) <= 1)
                other = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()
                try:
                    jwt.decode(t['jwt'], other, algorithms=['RS256'], audience='jitsi')
                    check('foreign key rejected', False)
                except jwt.InvalidSignatureError:
                    check('foreign key rejected', True)
                check('stranger refused', err_as(stranger, lesson.id) == 'Nuk ke qasje në këtë mësim')
                check('requested student refused', err_as(requested, lesson.id) == 'Nuk ke qasje në këtë mësim')
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=now + datetime.timedelta(minutes=30))
                check('too early refused', err_as(student, lesson.id) == 'Dhoma hapet 15 minuta para mësimit')
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=now - datetime.timedelta(minutes=120))
                check('too late refused', err_as(student, lesson.id) == 'Mësimi ka përfunduar')
                Lesson.objects.filter(pk=lesson.pk).update(starts_at=lesson.starts_at)
            with override_settings(**dict(JAAS_ON, JAAS_API_KEY_ID='', JAAS_KEY_ID='abc123')):
                check('old JAAS_KEY_ID name still works', bool(room_as(tutor.pk, lesson.id)['jwt']))

            print('VIDEO_PROVIDER set but incomplete:')
            with override_settings(**dict(JAAS_ON, JAAS_PRIVATE_KEY='')):
                check('jaas without key refused (no open room)', err_as(tutor.pk, lesson.id) == 'Dhoma video nuk është konfiguruar')
            with override_settings(**dict(JITSI_ON, JITSI_APP_SECRET='')):
                check('jitsi without secret refused', err_as(tutor.pk, lesson.id) == 'Dhoma video nuk është konfiguruar')

            print('secret unset (local dev):')
            with override_settings(**JITSI_OFF):
                t = room_as(tutor.pk, lesson.id)
                s = room_as(student, lesson.id)
                check('no token', t.get('jwt') is None and s.get('jwt') is None, t)
                check('plain meet.jit.si room', t['domain'] == 'meet.jit.si' and t['provider'] == 'jitsi'
                      and t['room'] == room)
                check('stranger still refused', err_as(stranger, lesson.id) == 'Nuk ke qasje në këtë mësim')
            raise Rollback
    except Rollback:
        pass
    print(f'{passed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
