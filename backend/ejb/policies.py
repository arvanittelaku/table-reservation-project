"""Who may read and write which rows: the former row-level security policies.

For each table:
  select(a)          -> Q of rows `a` may read            (SELECT policies, OR'd;
                                                            restrictive ones AND'd)
  insert(a, obj)     -> may `a` insert this new row?     (INSERT ... WITH CHECK)
  update(a)          -> Q of rows `a` may update         (UPDATE ... USING)
  update_check(a, o) -> may the updated row look like o? (UPDATE ... WITH CHECK)
  delete(a)          -> Q of rows `a` may delete         (DELETE ... USING)

A table without an entry, or a missing hook, means "nobody" (RLS enabled and no
policy). These apply only to the app's direct table queries; services (the
former SECURITY DEFINER functions) do their own checks, as before.
"""
from django.db.models import Exists, OuterRef, Q

from . import context
from .models import (
    Block, LessonParticipant, Membership, Profile, Request, Subscription, Table, Tutor,
)

NOTHING = Q(pk__in=[])
EVERYTHING = Q()


def _auth(a):
    return a.uid is not None


# ───────────── shared helpers (former SQL helper functions) ─────────────

def is_premium(user_id):
    """public.is_premium(p_user)."""
    if user_id is None:
        return False
    now = context.now()
    return (Profile.objects.filter(pk=user_id, is_admin=True).exists()
            or Subscription.objects.filter(user_id=user_id, status='active',
                                           starts_at__lte=now, ends_at__gt=now).exists())


def viewer_sees_all_cities(a):
    return a.uid is not None and is_premium(a.uid)


def viewer_home_city(a):
    if a.uid is None:
        return None
    return Profile.objects.filter(pk=a.uid).values_list('home_city', flat=True).first()


def my_table_ids(a):
    if a.uid is None:
        return []
    ids = set(Membership.objects.filter(user_id=a.uid).values_list('table_id', flat=True))
    ids |= set(Request.objects.filter(user_id=a.uid).values_list('table_id', flat=True))
    return list(ids)


def my_hosted_table_ids(a):
    if a.uid is None:
        return []
    return list(Table.objects.filter(host_id=a.uid).values_list('id', flat=True))


def is_member(user_id, table_id):
    return Membership.objects.filter(table_id=table_id, user_id=user_id).exists()


# ───────────── per-table rules ─────────────

class Rules:
    def select(self, a):
        return NOTHING

    def insert(self, a, obj):
        return False

    def update(self, a):
        return NOTHING

    def update_check(self, a, obj):
        return False

    def delete(self, a):
        return NOTHING


def own(field='user_id'):
    def q(a):
        return Q(**{field: a.uid}) if _auth(a) else NOTHING
    return q


class R(Rules):
    """Rules from small callables; omitted ones deny."""

    def __init__(self, select=None, insert=None, update=None, update_check=None, delete=None):
        self._s, self._i, self._u, self._uc, self._d = select, insert, update, update_check, delete

    def select(self, a):
        return self._s(a) if (self._s and _auth(a)) else NOTHING

    def insert(self, a, obj):
        return bool(self._i and _auth(a) and self._i(a, obj))

    def update(self, a):
        return self._u(a) if (self._u and _auth(a)) else NOTHING

    def update_check(self, a, obj):
        return bool(self._uc and _auth(a) and self._uc(a, obj))

    def delete(self, a):
        return self._d(a) if (self._d and _auth(a)) else NOTHING


def admin_only(a):
    return EVERYTHING if a.is_admin else NOTHING


def everyone(a):
    return EVERYTHING


def own_or_admin(field='user_id'):
    def q(a):
        return EVERYTHING if a.is_admin else Q(**{field: a.uid})
    return q


def _tables_select(a):
    if a.uid is None:
        return NOTHING
    now = context.now()
    blocked = Block.objects.filter(Q(blocker_id=a.uid) | Q(blocked_id=a.uid))
    blocked_ids = {b if bl == a.uid else bl for bl, b in blocked.values_list('blocker_id', 'blocked_id')}
    permissive = (Q(event_datetime__gt=now, status='open')
                  & ~Q(host_id__in=blocked_ids)
                  & ~Q(host__deactivated_at__isnull=False)) | Q(host_id=a.uid)
    if viewer_sees_all_cities(a) or a.is_admin:
        return permissive
    restrictive = Q(host_id=a.uid) | Q(id__in=my_table_ids(a))
    home = viewer_home_city(a)
    if home is not None:
        restrictive |= Q(city=home)
    return permissive & restrictive


def _lessons_select(a):
    if a.is_admin:
        return EVERYTHING
    now = context.now()
    approved = Tutor.objects.filter(user_id=OuterRef('tutor_id'), status='approved')
    return (Q(tutor_id=a.uid)
            | Q(Exists(LessonParticipant.objects.filter(lesson_id=OuterRef('pk'), student_id=a.uid)))
            | (Q(kind='group', status='scheduled', starts_at__gt=now) & Q(Exists(approved))))


def _lesson_participants_select(a):
    if a.is_admin:
        return EVERYTHING
    return Q(student_id=a.uid) | Q(lesson__tutor_id=a.uid)


def _requests_insert(a, r):
    if r.user_id != a.uid:
        return False
    now = context.now()
    t = Table.objects.filter(pk=r.table_id, event_datetime__gt=now, status='open').values('host_id').first()
    if not t:
        return False
    return not Block.objects.filter(Q(blocker_id=a.uid, blocked_id=t['host_id'])
                                    | Q(blocker_id=t['host_id'], blocked_id=a.uid)).exists()


def _request_update_check(a, r):
    # The old policy let people set any status on their own request (even
    # 'approved', then join). The app only ever confirms an approved seat.
    if r.user_id != a.uid:
        return False
    old = getattr(r, '_old_status', None)
    return r.status == old or (old == 'approved' and r.status == 'confirmed')


def _waitlist_insert(a, w):
    return (w.user_id == a.uid
            and Table.objects.filter(pk=w.table_id, event_datetime__gt=context.now(), status='open').exists())


RULES = {
    'admin_audit_log': R(select=admin_only),
    'affinity': R(select=own()),
    'badges': R(select=everyone, insert=lambda a, o: o.user_id == a.uid),
    'bans': R(select=own_or_admin()),
    'blocks': R(select=lambda a: Q(blocker_id=a.uid) | Q(blocked_id=a.uid),
                insert=lambda a, o: o.blocker_id == a.uid,
                delete=own('blocker_id')),
    'connection_picks': R(select=own('picker_id'),
                          insert=lambda a, o: o.picker_id == a.uid and is_member(a.uid, o.table_id)),
    'connections': R(select=lambda a: Q(a_id=a.uid) | Q(b_id=a.uid)),
    'lesson_participants': R(select=_lesson_participants_select),
    'lesson_subjects': R(select=everyone),
    'lessons': R(select=_lessons_select),
    'memberships': R(select=everyone,
                     insert=lambda a, o: o.user_id == a.uid and Request.objects.filter(
                         table_id=o.table_id, user_id=a.uid, status='approved').exists()),
    'messages': R(select=lambda a: Q(Exists(Membership.objects.filter(table_id=OuterRef('table_id'), user_id=a.uid))),
                  insert=lambda a, o: o.sender_id == a.uid and is_member(a.uid, o.table_id)),
    'notifications': R(select=own(), update=own(), update_check=lambda a, o: o.user_id == a.uid),
    'payments': R(select=own(), insert=lambda a, o: o.user_id == a.uid and o.provider == 'stub'),
    'plans': R(select=everyone),
    'profiles': R(select=everyone, update=own('user_id'),
                  update_check=lambda a, o: o.user_id == a.uid and o.age is not None and o.age >= 18),
    'ratings': R(select=everyone, insert=lambda a, o: o.rater_id == a.uid and is_member(a.uid, o.table_id)),
    'reports': R(select=own_or_admin('reporter_id'), insert=lambda a, o: o.reporter_id == a.uid,
                 update=admin_only, update_check=lambda a, o: True),
    'requests': R(select=lambda a: Q(user_id=a.uid) | Q(table_id__in=my_hosted_table_ids(a)),
                  insert=_requests_insert, update=own(), update_check=_request_update_check),
    'subscription_orders': R(select=own_or_admin()),
    'subscriptions': R(select=own_or_admin()),
    'tables': R(select=_tables_select,
                insert=lambda a, o: o.host_id == a.uid and o.event_datetime is not None
                and o.event_datetime > context.now(),
                update=own('host_id'), update_check=lambda a, o: o.host_id == a.uid,
                delete=own('host_id')),
    'taste_profiles': R(select=own(), insert=lambda a, o: o.user_id == a.uid,
                        update=own(), update_check=lambda a, o: o.user_id == a.uid, delete=own()),
    'tutors': R(select=lambda a: Q(status='approved') | Q(user_id=a.uid) | (EVERYTHING if a.is_admin else NOTHING),
                insert=lambda a, o: o.user_id == a.uid and Profile.objects.filter(
                    pk=a.uid, onboarded_at__isnull=False).exists(),
                update=own(), update_check=lambda a, o: o.user_id == a.uid, delete=own()),
    'waitlist': R(select=lambda a: Q(user_id=a.uid) | Q(table_id__in=my_hosted_table_ids(a)),
                  insert=_waitlist_insert, delete=own()),
    'wednesday_groups': R(select=admin_only),
    'wednesday_participants': R(select=own()),
    'wednesday_restaurants': R(select=admin_only),
    'wednesday_signups': R(select=own_or_admin()),
}

DENY = Rules()


def rules_for(table):
    return RULES.get(table, DENY)
