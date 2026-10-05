"""Lessons and tutors (group B): former SQL functions book_lesson, cancel_lesson, ..."""
import datetime
import math
import random
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from django.db.models import Q

from .. import context
from ..errors import fail
from ..models import (AuthUser, Block, Lesson, LessonParticipant, LessonRoom, LessonSubject, Payment,
                      Profile, Report, Tutor)
from ..registry import pg_timestamp, row_json
from ..rpc import rpc
from . import common
import functools

from django.db import DatabaseError

from core.db import DbError, db_error_from


def _db_errors(fn):
    """Constraint violations raised by Postgres come back as the same API error
    (ejb.rpc.call does not translate IntegrityError itself)."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        try:
            return fn(*a, **kw)
        except DbError:
            raise
        except DatabaseError as exc:
            raise db_error_from(exc, anonymous=context.uid() is None) from exc
    return wrapper

ACTIVE = ('requested', 'accepted', 'confirmed')
MIN = datetime.timedelta(minutes=1)


def _full_name(first, last):
    """trim(first_name || ' ' || last_name) (NULL if either is NULL)."""
    if first is None or last is None:
        return None
    return f'{first} {last}'.strip()


def _name_of(user_id):
    if user_id is None:
        return None
    p = Profile.objects.filter(pk=user_id).values('first_name', 'last_name').first()
    return _full_name(p['first_name'], p['last_name']) if p else None


def _cat(name, text):
    return None if name is None else name + text


def _blocked(a, b):
    if a is None or b is None:
        return False
    return Block.objects.filter(Q(blocker_id=a, blocked_id=b) | Q(blocker_id=b, blocked_id=a)).exists()


def _nullif_trim(s):
    s = (s or '').strip()
    return s or None


def _lesson_notify(p_user, p_kind, p_params, p_body):
    """_lesson_notify(): plain notification insert with icon 'info'."""
    common.notify(p_user, 'info', p_body, p_kind, p_params)


def _lesson_params(name, subject, at):
    return {'name': name, 'subject': subject, 'at': pg_timestamp(at)}


# ───────────── tutors (admin) ─────────────

@rpc('admin_list_tutors')
@_db_errors
def admin_list_tutors(p_status: str = 'pending') -> list:
    common.admin_guard()
    qs = Tutor.objects.all()
    if not (p_status is None or p_status == 'all'):
        qs = qs.filter(status=p_status)
    qs = qs.filter(user__isnull=False)[:500]
    out = []
    for t in qs:
        p = Profile.objects.filter(pk=t.user_id).values('first_name', 'last_name', 'photo_path', 'age').first()
        if p is None:
            continue
        row = row_json(t)
        row.update(p)
        row['email'] = AuthUser.objects.filter(pk=t.user_id).values_list('email', flat=True).first()
        rv = (Profile.objects.filter(pk=t.reviewed_by_id).values('first_name', 'last_name').first()
              if t.reviewed_by_id else None)
        row['reviewed_by_name'] = _full_name(rv['first_name'], rv['last_name']) if rv else None
        row['lessons_count'] = Lesson.objects.filter(tutor_id=t.user_id).count()
        row['reports_against'] = Report.objects.filter(reported_id=t.user_id).count()
        out.append((t.created_at, row))
    out.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in out]


@rpc('admin_review_tutor')
@_db_errors
def admin_review_tutor(p_user: UUID, p_status: str, p_reason: str = None) -> None:
    v_reason = _nullif_trim(p_reason)
    common.admin_guard()
    if p_status is not None and p_status not in ('approved', 'rejected', 'suspended'):
        fail('Status i pavlefshëm')
    if p_status in ('rejected', 'suspended') and v_reason is None:
        fail('Shkruaj arsyen')
    t = Tutor.objects.filter(user_id=p_user).first()
    if p_status is None or t is None:
        # NULL status: the IF is not taken; the UPDATE then violates NOT NULL (or finds nothing)
        if t is None:
            fail('Aplikimi nuk u gjet')
    t.status = p_status
    t.reviewed_by_id = context.uid()
    t.reviewed_at = context.now()
    t.rejection_reason = None if p_status == 'approved' else v_reason
    t.save()
    kind = {'approved': 'tutorApproved', 'rejected': 'tutorRejected'}.get(p_status, 'tutorSuspended')
    body = ('Profili yt i mësuesit u aprovua! Studentët tani mund të të gjejnë.' if p_status == 'approved'
            else _cat('Profili yt i mësuesit nuk u aprovua. Arsyeja: ', v_reason) if v_reason is not None else None)
    _lesson_notify(p_user, kind, {'reason': v_reason}, body)
    common.admin_log('tutor_' + p_status, 'user', p_user, common.user_label(p_user), {'reason': v_reason})


# ───────────── browsing ─────────────

@rpc('list_tutors')
@_db_errors
def list_tutors(p_subject: str = None, p_category: str = None, p_format: str = None, p_group: bool = None,
                p_max_price: int = None, p_lat: float = None, p_lng: float = None,
                p_radius_km: float = None) -> list:
    me = context.uid()
    if me is None:
        return []
    now = context.now()
    blocked = set()
    for b in Block.objects.filter(Q(blocker_id=me) | Q(blocked_id=me)).values('blocker_id', 'blocked_id'):
        blocked.add(b['blocked_id'] if b['blocker_id'] == me else b['blocker_id'])
    cat_subjects = (set(LessonSubject.objects.filter(category=p_category).values_list('id', flat=True))
                    if p_category is not None else None)
    rows = []
    for t in Tutor.objects.filter(status='approved', user__deactivated_at__isnull=True).select_related('user'):
        if t.user_id in blocked:
            continue
        subs = t.subjects or []
        if p_subject is not None and p_subject not in subs:
            continue
        if cat_subjects is not None and not (cat_subjects & set(subs)):
            continue
        if p_format is not None and not ((p_format == 'online' and t.online) or (p_format == 'in_person' and t.in_person)):
            continue
        if p_group and not t.group_ok:
            continue
        if p_max_price is not None and not t.price_cents <= p_max_price:
            continue
        dist = common.distance_km(p_lat, p_lng, t.lat, t.lng)
        if p_radius_km is not None and p_lat is not None and not (dist is not None and dist <= p_radius_km):
            continue
        p = t.user
        rows.append((dist, p.rating, t.years_experience, {
            'user_id': t.user_id, 'first_name': p.first_name, 'last_name': p.last_name,
            'photo_path': p.photo_path, 'age': p.age, 'rating': p.rating,
            'headline': t.headline, 'bio': t.bio, 'subjects': t.subjects, 'teach_langs': t.teach_langs,
            'price_cents': t.price_cents, 'online': t.online, 'in_person': t.in_person,
            'group_ok': t.group_ok, 'city': t.city, 'years_experience': t.years_experience,
            'education': t.education,
            'distance_km': (float(Decimal(repr(dist)).quantize(Decimal('0.1'), ROUND_HALF_UP))
                            if dist is not None else None),
            'lessons_taught': LessonParticipant.objects.filter(lesson__tutor_id=t.user_id, status='confirmed',
                                                               lesson__starts_at__lt=now).count(),
            'upcoming_groups': Lesson.objects.filter(tutor_id=t.user_id, kind='group', status='scheduled',
                                                     starts_at__gt=now).count(),
        }))

    def key(r):
        dist, rating, years, _ = r
        d = (0, dist) if (p_lat is not None and dist is not None) else (1, 0)
        # DESC puts NULLs first
        rk = (0, 0) if rating is None else (1, -rating)
        return (d, rk, -years)
    rows.sort(key=key)
    return [r[3] for r in rows[:200]]


@rpc('list_group_lessons')
@_db_errors
def list_group_lessons(p_subject: str = None, p_category: str = None) -> list:
    me = context.uid()
    if me is None:
        return []
    qs = (Lesson.objects.filter(kind='group', status='scheduled', starts_at__gt=context.now(),
                                tutor__status='approved')
          .select_related('tutor', 'tutor__user').order_by('starts_at'))
    if p_subject is not None:
        qs = qs.filter(subject_id=p_subject)
    if p_category is not None:
        qs = qs.filter(subject_id__in=LessonSubject.objects.filter(category=p_category).values('id'))
    out = []
    for l in qs[:200]:
        p = l.tutor.user
        out.append({
            'id': l.id, 'tutor_id': l.tutor_id, 'tutor_name': _full_name(p.first_name, p.last_name),
            'tutor_photo_path': p.photo_path, 'subject': l.subject_id, 'title': l.title,
            'starts_at': l.starts_at, 'duration_min': l.duration_min, 'format': l.format,
            'location_note': l.location_note, 'max_students': l.max_students,
            'seats_taken': LessonParticipant.objects.filter(lesson_id=l.id, status__in=('accepted', 'confirmed')).count(),
            'price_cents': l.price_cents, 'city': l.tutor.city,
            'my_status': LessonParticipant.objects.filter(lesson_id=l.id, student_id=me)
                         .values_list('status', flat=True).first(),
        })
    return out


@rpc('my_lessons')
@_db_errors
def my_lessons() -> dict:
    me = context.uid()
    as_student = []
    for lp in (LessonParticipant.objects.filter(student_id=me).select_related('lesson', 'lesson__tutor__user')
               .order_by('-lesson__starts_at')[:100] if me else []):
        l = lp.lesson
        p = l.tutor.user
        as_student.append({
            'id': l.id, 'kind': l.kind, 'subject': l.subject_id, 'title': l.title, 'starts_at': l.starts_at,
            'duration_min': l.duration_min, 'format': l.format, 'location_note': l.location_note,
            'price_cents': l.price_cents, 'lesson_status': l.status, 'my_status': lp.status,
            'tutor_id': l.tutor_id, 'tutor_name': _full_name(p.first_name, p.last_name),
            'tutor_photo_path': p.photo_path,
            'ticket_code': Payment.objects.filter(lesson_id=l.id, user_id=me).values_list('ticket_code', flat=True).first(),
        })
    as_tutor = []
    for l in (Lesson.objects.filter(tutor_id=me).order_by('-starts_at')[:100] if me else []):
        students = []
        for lp in LessonParticipant.objects.filter(lesson_id=l.id).select_related('student'):
            sp = lp.student
            students.append({'student_id': lp.student_id, 'status': lp.status, 'note': lp.note,
                             'name': _full_name(sp.first_name, sp.last_name), 'photo_path': sp.photo_path,
                             'age': sp.age})
        as_tutor.append({
            'id': l.id, 'kind': l.kind, 'subject': l.subject_id, 'title': l.title, 'starts_at': l.starts_at,
            'duration_min': l.duration_min, 'format': l.format, 'location_note': l.location_note,
            'price_cents': l.price_cents, 'lesson_status': l.status, 'max_students': l.max_students,
            'students': students,
        })
    t = Tutor.objects.filter(user_id=me).first() if me else None
    return {'as_student': as_student, 'as_tutor': as_tutor, 'tutor': row_json(t) if t else None}


# ───────────── booking flow ─────────────

@rpc('book_lesson')
@_db_errors
def book_lesson(p_tutor: UUID, p_subject: str, p_starts_at: datetime.datetime, p_duration: int, p_format: str,
                p_note: str = None) -> UUID:
    me = common.require_onboarded_me()
    now = context.now()
    t = Tutor.objects.filter(user_id=p_tutor, status='approved').first()
    if t is None:
        fail('Mësuesi nuk është i disponueshëm')
    if p_tutor == me:
        fail('Nuk mund të rezervosh mësim me veten')
    if _blocked(p_tutor, me):
        fail('Veprimi nuk lejohet')
    if p_subject is None or p_subject not in (t.subjects or []):
        if p_subject is not None:
            fail('Ky mësues nuk e jep këtë lëndë')
    if p_format is not None and (p_format not in ('online', 'in_person') or (p_format == 'online' and not t.online)
                                 or (p_format == 'in_person' and not t.in_person)):
        fail('Ky mësues nuk e ofron këtë mënyrë mësimi')
    if p_starts_at is not None and (p_starts_at < now + 30 * MIN or p_starts_at > now + datetime.timedelta(days=90)):
        fail('Zgjidh një orë të paktën 30 minuta nga tani')
    if LessonParticipant.objects.filter(lesson__tutor_id=p_tutor, student_id=me, status='requested').count() >= 3:
        fail('Ke tashmë 3 kërkesa në pritje te ky mësues')
    if p_starts_at is not None and p_duration is not None:
        if p_duration < 0:
            fail('range lower bound must be less than or equal to range upper bound', '22000')
        end = p_starts_at + p_duration * MIN
        for l in Lesson.objects.filter(tutor_id=p_tutor, status='scheduled',
                                       participants__status__in=('accepted', 'confirmed')).distinct():
            l_end = l.starts_at + l.duration_min * MIN
            if l.starts_at < l_end and p_starts_at < end and l.starts_at < end and p_starts_at < l_end:
                fail('Mësuesi është i zënë në këtë orë')
    price = None
    if p_duration is not None:
        price = int((Decimal(t.price_cents) * p_duration / Decimal(60)).quantize(Decimal(1), ROUND_HALF_UP))
    lesson = Lesson(tutor_id=p_tutor, subject_id=p_subject, kind='individual', starts_at=p_starts_at,
                    duration_min=p_duration, format=p_format, max_students=1, price_cents=price)
    lesson.save(force_insert=True)
    LessonRoom(lesson_id=lesson.id).save(force_insert=True)
    LessonParticipant(lesson_id=lesson.id, student_id=me, status='requested',
                      note=_nullif_trim(p_note)).save(force_insert=True)
    v_name = _name_of(me)
    _lesson_notify(p_tutor, 'lessonRequested', _lesson_params(v_name, p_subject, p_starts_at),
                   _cat(v_name, ' kërkon një mësim me ty.'))
    return lesson.id


@rpc('respond_lesson_request')
@_db_errors
def respond_lesson_request(p_lesson: UUID, p_student: UUID, p_accept: bool) -> None:
    me = context.uid()
    l = Lesson.objects.filter(pk=p_lesson).first()
    # SQL: `l.tutor_id <> auth.uid()` is NULL (not true) when signed out, so no error here.
    if l is None or (me is not None and l.tutor_id != me):
        fail('Vetëm mësuesi mund të përgjigjet')
    lp = LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=p_student, status='requested').first()
    if lp is None:
        fail('Kërkesa nuk u gjet')
    lp.status = 'accepted' if p_accept else 'declined'
    lp.save()
    if p_accept is False and l.kind == 'individual':
        l.status = 'cancelled'
        l.save()
    v_name = _name_of(me)
    _lesson_notify(p_student, 'lessonAccepted' if p_accept else 'lessonDeclined',
                   _lesson_params(v_name, l.subject_id, l.starts_at),
                   _cat(v_name, ' e pranoi mësimin. Konfirmo rezervimin.') if p_accept
                   else _cat(v_name, ' nuk mund ta mbajë këtë mësim.'))


@rpc('confirm_lesson_seat')
@_db_errors
def confirm_lesson_seat(p_lesson: UUID) -> str:
    me = context.uid()
    now = context.now()
    l = Lesson.objects.filter(pk=p_lesson, status='scheduled').first()
    if l is None or l.starts_at + l.duration_min * MIN <= now:
        fail('Mësimi nuk është i disponueshëm')
    lp = LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=me, status='accepted').first() if me else None
    if lp is None:
        fail('Mësuesi nuk e ka pranuar ende kërkesën')
    lp.status = 'confirmed'
    lp.save()
    v_ticket = 'EBM-' + str(1000 + math.floor(random.random() * 9000)).rjust(4, '0')
    # ON CONFLICT DO NOTHING (unique: ticket_code, (user, lesson))
    if not (Payment.objects.filter(user_id=me, lesson_id=p_lesson).exists()
            or Payment.objects.filter(ticket_code=v_ticket).exists()):
        Payment(user_id=me, table_id=None, lesson_id=p_lesson, amount_cents=200, provider='stub',
                provider_ref='STUB-L-' + str(math.floor(now.timestamp() * 1000)), ticket_code=v_ticket,
                table_title='Mësim: ' + l.subject_id).save(force_insert=True)
    v_name = _name_of(me)
    _lesson_notify(l.tutor_id, 'lessonConfirmed', _lesson_params(v_name, l.subject_id, l.starts_at),
                   _cat(v_name, ' e konfirmoi mësimin.'))
    return v_ticket


@rpc('cancel_lesson')
@_db_errors
def cancel_lesson(p_lesson: UUID) -> None:
    me = context.uid()
    l = Lesson.objects.filter(pk=p_lesson).first()
    if l is None:
        fail('Mësimi nuk u gjet')
    v_name = _name_of(me)
    params = _lesson_params(v_name, l.subject_id, l.starts_at)
    body = _cat(v_name, ' e anuloi mësimin.')
    if me is not None and l.tutor_id == me:
        l.status = 'cancelled'
        l.save()
        parts = list(LessonParticipant.objects.filter(lesson_id=p_lesson, status__in=ACTIVE))
        for lp in parts:
            _lesson_notify(lp.student_id, 'lessonCancelled', params, body)
        for lp in parts:
            lp.status = 'cancelled'
            lp.save()
    else:
        parts = list(LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=me, status__in=ACTIVE)) if me else []
        if not parts:
            fail('Mësimi nuk u gjet')
        for lp in parts:
            lp.status = 'cancelled'
            lp.save()
        if l.kind == 'individual':
            l.status = 'cancelled'
            l.save()
        _lesson_notify(l.tutor_id, 'lessonCancelled', params, body)


@rpc('create_group_lesson')
@_db_errors
def create_group_lesson(p_subject: str, p_title: str, p_starts_at: datetime.datetime, p_duration: int,
                        p_format: str, p_max_students: int, p_price_cents: int, p_location_note: str = None) -> UUID:
    me = common.require_onboarded_me()
    t = Tutor.objects.filter(user_id=me, status='approved').first()
    if t is None:
        fail('Vetëm mësuesit e aprovuar hapin mësime në grup')
    if not t.group_ok:
        fail('Aktivizo mësimet në grup te profili yt i mësuesit')
    if p_subject is not None and p_subject not in (t.subjects or []):
        fail('Ky mësues nuk e jep këtë lëndë')
    if (p_format == 'online' and not t.online) or (p_format == 'in_person' and not t.in_person):
        fail('Ky mësues nuk e ofron këtë mënyrë mësimi')
    if p_starts_at is not None and p_starts_at < context.now() + 30 * MIN:
        fail('Zgjidh një orë të paktën 30 minuta nga tani')
    if p_max_students is not None and not (2 <= p_max_students <= 30):
        fail('Grupi ka 2 deri 30 studentë')
    loc = _nullif_trim(p_location_note)
    if p_format == 'in_person' and loc is None:
        fail('Shkruaj vendin e mësimit')
    lesson = Lesson(tutor_id=me, subject_id=p_subject, kind='group',
                    title=p_title.strip() if p_title is not None else None, starts_at=p_starts_at,
                    duration_min=p_duration, format=p_format, location_note=loc, max_students=p_max_students,
                    price_cents=max(0, p_price_cents) if p_price_cents is not None else None)
    lesson.save(force_insert=True)
    LessonRoom(lesson_id=lesson.id).save(force_insert=True)
    return lesson.id


@rpc('join_group_lesson')
@_db_errors
def join_group_lesson(p_lesson: UUID) -> None:
    me = common.require_onboarded_me()
    l = Lesson.objects.select_for_update().filter(pk=p_lesson, kind='group', status='scheduled').first()
    if l is None or l.starts_at <= context.now():
        fail('Mësimi nuk është i disponueshëm')
    if l.tutor_id == me:
        fail("Nuk mund t'i bashkohesh mësimit tënd")
    if _blocked(l.tutor_id, me):
        fail('Veprimi nuk lejohet')
    taken = LessonParticipant.objects.filter(lesson_id=p_lesson, status__in=('accepted', 'confirmed')).count()
    if taken >= l.max_students:
        fail('Grupi është plot')
    lp = LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=me).first()
    if lp is None:
        LessonParticipant(lesson_id=p_lesson, student_id=me, status='accepted').save(force_insert=True)
    elif lp.status in ('cancelled', 'declined'):
        lp.status = 'accepted'
        lp.save()


@rpc('get_lesson_room')
@_db_errors
def get_lesson_room(p_lesson: UUID) -> dict:
    me = context.uid()
    now = context.now()
    l = Lesson.objects.filter(pk=p_lesson, status='scheduled', format='online').first()
    if l is None:
        fail('Mësimi nuk u gjet')
    if not ((me is not None and l.tutor_id == me) or
            (me is not None and LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=me,
                                                                 status='confirmed').exists())):
        fail('Nuk ke qasje në këtë mësim')
    if now < l.starts_at - 15 * MIN:
        fail('Dhoma hapet 15 minuta para mësimit')
    if now > l.starts_at + l.duration_min * MIN + 30 * MIN:
        fail('Mësimi ka përfunduar')
    key = LessonRoom.objects.filter(lesson_id=p_lesson).values_list('room_key', flat=True).first()
    return {'room': None if key is None else 'ejaBashkohu-' + key, 'starts_at': l.starts_at,
            'duration_min': l.duration_min}
