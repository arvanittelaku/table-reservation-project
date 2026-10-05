"""Group A: tables, join requests, social helpers, onboarding."""
import datetime
import functools
import re
import secrets
from uuid import UUID

from django.db import DatabaseError
from django.db.models import Q

from core.db import DbError, db_error_from

from .. import context
from ..errors import fail
from ..models import (Badge, Block, Lesson, LessonParticipant, Membership, Payment, Profile, Request,
                      Table)
from ..registry import pg_timestamp
from ..rpc import rpc
from . import common



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


UUID_TEXT_RE = re.compile(r'^[0-9a-f-]{36}$', re.I)


# ───────────── small helpers ─────────────

@rpc('_is_table_participant')
def _is_table_participant(p_table: UUID) -> bool:
    u = context.uid()
    return (Membership.objects.filter(table_id=p_table, user_id=u).exists()
            or Request.objects.filter(table_id=p_table, user_id=u).exists())


@rpc('_is_lesson_student', anon=True)
def _is_lesson_student(p_lesson: UUID) -> bool:
    return LessonParticipant.objects.filter(lesson_id=p_lesson, student_id=context.uid()).exists()


@rpc('_is_lesson_tutor', anon=True)
def _is_lesson_tutor(p_lesson: UUID) -> bool:
    return Lesson.objects.filter(id=p_lesson, tutor_id=context.uid()).exists()


@rpc('_distance_km', anon=True)
def _distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    return common.distance_km(lat1, lng1, lat2, lng2)


@rpc('_kosovo_now', anon=True)
def _kosovo_now() -> datetime.datetime:
    return common.kosovo_now()          # naive -> serialized without offset, like to_json(timestamp)


@rpc('_month_start', anon=True)
def _month_start() -> datetime.datetime:
    return common.month_start()


@rpc('_next_wednesday_dinner', anon=True)
def _next_wednesday_dinner() -> datetime.datetime:
    return common.next_wednesday_dinner()


@rpc('_new_share_code')
def _new_share_code() -> str:
    return common.new_share_code()


# ───────────── requests / seats ─────────────

@rpc('request_join')
@_db_errors
def request_join(p_table: UUID) -> UUID:
    u = context.uid()
    t = Table.objects.filter(id=p_table, status='open').values('host_id', 'spots', 'event_datetime').first()
    if t is None or t['host_id'] is None:
        fail('Tavolina nuk ekziston ose është mbyllur')
    if t['event_datetime'] <= common.now():
        fail('Kjo tavolinë ka skaduar')
    if u is not None and t['host_id'] == u:
        fail('Je vetë nikoqiri')
    host = t['host_id']
    if Block.objects.filter(Q(blocker_id=host, blocked_id=u) | Q(blocker_id=u, blocked_id=host)).exists():
        fail('Veprimi nuk lejohet')
    if Membership.objects.filter(table_id=p_table).count() >= t['spots']:
        fail('Tavolina është plot. Futu në listën e pritjes')
    r = Request(table_id=p_table, user_id=u)
    r.save()
    return r.id


@rpc('approve_request', anon=True)
def approve_request(p_request: UUID) -> None:
    u = context.uid()
    r = (Request.objects.filter(id=p_request, status='pending').select_related('table').first())
    if r is None:
        fail('Kërkesa nuk u gjet')
    # The SQL check `v_host <> auth.uid()` was NULL when signed out, so anyone
    # could approve a request by id without signing in. Closed: only the host.
    if u is None or r.table.host_id != u:
        fail('Vetëm nikoqiri mund të aprovojë')
    for row in Request.objects.filter(id=p_request):
        row.status = 'approved'
        row.save()


@rpc('reject_request', anon=True)
def reject_request(p_request: UUID) -> None:
    u = context.uid()
    if u is None:
        return
    for r in Request.objects.filter(id=p_request, status='pending', table__host_id=u):
        r.status = 'rejected'
        r.save()


@rpc('leave_table', anon=True)
def leave_table(p_table: UUID) -> None:
    u = context.uid()
    if u is None:
        return
    for m in Membership.objects.filter(table_id=p_table, user_id=u, role='member'):
        m.delete()
    for r in Request.objects.filter(table_id=p_table, user_id=u):
        r.delete()


@rpc('confirm_free_seat', anon=True)
@_db_errors
def confirm_free_seat(p_table: UUID) -> None:
    u = context.uid()
    t = Table.objects.filter(id=p_table).values('kind', 'spots').first()
    # SQL: `v_kind <> 'vozitje'` is NULL for a missing table -> falls through.
    if t is not None and t['kind'] is not None and t['kind'] != 'vozitje':
        fail('Vetëm vozitjet konfirmohen falas')
    if not Request.objects.filter(table_id=p_table, user_id=u, status='approved').exists():
        fail("S'je i aprovuar për këtë vozitje")
    # (an approved request implies the table exists)
    if Membership.objects.filter(table_id=p_table).count() >= t['spots']:
        fail('Ulëset u mbushën')
    Membership(table_id=p_table, user_id=u).save(force_insert=True)
    for r in Request.objects.filter(table_id=p_table, user_id=u):
        r.status = 'confirmed'
        r.save()


@_db_errors
def confirm_paid_seat(p_user, p_table, p_amount_cents, p_provider, p_provider_ref):
    """confirm_paid_seat(): internal (called by the payment webhook), returns the ticket code."""
    if not Request.objects.filter(table_id=p_table, user_id=p_user, status='approved').exists():
        fail('Pagesë pa aprovim — refuzohet')
    v_ticket = 'EBK-' + str(1000 + secrets.randbelow(9000)).rjust(4, '0')
    Payment(user_id=p_user, table_id=p_table, amount_cents=p_amount_cents, provider=p_provider,
            provider_ref=p_provider_ref, ticket_code=v_ticket).save(force_insert=True)
    Membership(table_id=p_table, user_id=p_user).save(force_insert=True)
    for r in Request.objects.filter(table_id=p_table, user_id=p_user):
        r.status = 'confirmed'
        r.save()
    common.notify(p_user, '🎟️', 'Vendi u konfirmua! Bileta jote: ' + v_ticket)
    return v_ticket


# ───────────── badges / onboarding / city ─────────────

BADGE_KEYS = {'profil': 'profileComplete', 'first-join': 'firstJoin',
              'first-rate': 'firstRate', 'first-host': 'firstHost'}
BADGE_LABELS = {'profileComplete': 'Profil i plotë', 'firstJoin': 'Tavolina e parë',
                'firstRate': 'Vlerësuesi', 'firstHost': 'Nikoqiri i ri'}


@rpc('award_badge')
@_db_errors
def award_badge(p_badge: str) -> bool:
    u = common.require_uid()
    key = BADGE_KEYS.get(p_badge)
    if key is None:
        fail('Distinktiv i panjohur')
    if Badge.objects.filter(user_id=u, badge_id=p_badge).exists():
        return False
    Badge(user_id=u, badge_id=p_badge).save(force_insert=True)
    label = BADGE_LABELS[key]
    common.notify(u, '', 'Fitove distinktivin "' + label + '"! Shikoje te Tavolinat e mia.',
                  'badgeEarned', {'badge': key, 'label': label})
    return True


@rpc('complete_onboarding')
@_db_errors
def complete_onboarding(p_first_name: str, p_last_name: str, p_age: int,
                        p_is_tourist: bool = False, p_from_place: str = None) -> None:
    u = common.require_uid()
    first = (p_first_name or '').strip()
    last = (p_last_name or '').strip()
    if not (1 <= len(first) <= 40) or not (1 <= len(last) <= 40) or first == 'Përdorues' or last == '-':
        fail('Shkruaj emrin dhe mbiemrin')
    if p_age is None or not (18 <= p_age <= 99):
        fail('Duhet të kesh të paktën 18 vjeç')
    now = common.now()
    for p in Profile.objects.filter(pk=u):
        p.first_name = first
        p.last_name = last
        p.age = p_age
        p.is_tourist = bool(p_is_tourist) if p_is_tourist is not None else False
        p.from_place = ((p_from_place or '').strip() or None) if p_is_tourist else None
        p.user_preferences = {**(p.user_preferences or {}), 'terms_agreed': True,
                              'terms_agreed_at': pg_timestamp(now), 'terms_version': '2026-08'}
        if p.onboarded_at is None:
            p.onboarded_at = now
        p.save()


@rpc('set_home_city')
@_db_errors
def set_home_city(p_city: str) -> None:
    u = common.require_uid()
    city = (p_city or '').strip() or None
    if city is None or len(city) > 60:
        fail('Qytet i pavlefshëm')
    p = Profile.objects.filter(pk=u).first()
    if p is None:
        return  # SQL: record is NULL; the UPDATE touches nothing
    if p.home_city == city:
        return
    if (p.home_city is not None and not common.is_premium(u)
            and p.home_city_changed_at is not None
            and p.home_city_changed_at > common.now() - datetime.timedelta(days=30)):
        fail('Qytetin mund ta ndryshosh një herë në 30 ditë')
    p.home_city_changed_at = None if p.home_city is None else common.now()
    p.home_city = city
    p.save()


# ───────────── share preview ─────────────

@rpc('table_share_preview', anon=True)
def table_share_preview(p_code: str) -> dict:
    if p_code is None or len(p_code) > 64:
        return None
    cond = Q(share_code=p_code.lower())
    if UUID_TEXT_RE.match(p_code):
        try:
            cond |= Q(id=UUID(p_code))
        except ValueError:
            fail(f'invalid input syntax for type uuid: "{p_code}"', '22P02')
    t = Table.objects.filter(cond).first()
    if t is None or t.kind == 'darka_e_merkures':
        return None
    uid = context.uid()
    secret = bool(t.mystery) and not bool(t.revealed)
    taken = Membership.objects.filter(table_id=t.id).count()
    host_first = Profile.objects.filter(pk=t.host_id).values_list('first_name', flat=True).first()
    can_open = False
    reason = None
    if uid is None:
        reason = 'sign_in'
    else:
        sees_city = common.is_premium(uid) or Profile.objects.filter(pk=uid, home_city=t.city).exists()
        is_admin = bool(Profile.objects.filter(pk=uid).values_list('is_admin', flat=True).first())
        if (t.host_id != uid and not sees_city
                and not Membership.objects.filter(table_id=t.id, user_id=uid).exists()
                and not is_admin):
            reason = 'premium_city'
        elif Block.objects.filter(Q(blocker_id=t.host_id, blocked_id=uid)
                                  | Q(blocker_id=uid, blocked_id=t.host_id)).exists():
            return None
        else:
            can_open = True
    now = common.now()
    if t.status != 'open':
        status = 'closed'
    elif t.event_datetime is not None and t.event_datetime < now:
        status = 'past'
    elif taken >= t.spots:
        status = 'full'
    else:
        status = 'open'
    return {
        'id': t.id if can_open else None,
        'share_code': t.share_code,
        'title': None if secret else t.title,
        'secret': secret,
        'kind': t.kind,
        'category': t.category,
        'sport': t.sport,
        'city': t.city,
        'to_city': t.to_city,
        'area': None if secret else t.area,
        'event_datetime': t.event_datetime,
        'time_label': t.time_label,
        'spots': t.spots,
        'taken': taken,
        'status': status,
        'women_only': bool(t.women_only),
        'men_only': bool(t.men_only),
        'host_first_name': host_first,
        'can_open': can_open,
        'reason': reason,
    }
