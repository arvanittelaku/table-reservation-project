"""Helpers shared by the services: the former internal SQL helper functions."""
import datetime
import math
import secrets
import zoneinfo

from django.db.models import Max

from .. import context
from ..errors import fail
from ..hooks import month_start, notify  # noqa: F401  (re-exported)
from ..policies import is_premium  # noqa: F401  (re-exported)

BELGRADE = zoneinfo.ZoneInfo('Europe/Belgrade')
NOT_SIGNED_IN = 'Duhet të jesh i kyçur'
NOT_ONBOARDED = 'Plotëso profilin (emri, mosha, foto) para se të vazhdosh'


def uid():
    return context.uid()


def require_uid():
    u = context.uid()
    if u is None:
        fail(NOT_SIGNED_IN)
    return u


def is_admin():
    """public.is_admin_user()"""
    return context.actor().is_admin


def admin_guard():
    """_admin_guard()"""
    if context.uid() is None or not context.actor().is_admin:
        fail('Vetëm adminët mund ta bëjnë këtë', '42501')


def require_onboarded_me():
    """_require_onboarded_me()"""
    from ..models import Profile
    u = require_uid()
    if not Profile.objects.filter(pk=u, onboarded_at__isnull=False, deactivated_at__isnull=True).exists():
        fail(NOT_ONBOARDED)
    return u


def user_label(user_id):
    """_admin_user_label(p_user): 'First Last' trimmed, or None."""
    from ..models import Profile
    p = Profile.objects.filter(pk=user_id).values('first_name', 'last_name').first()
    if not p:
        return None
    return f"{p['first_name']} {p['last_name']}".strip()


def admin_log(action, target_type, target_id, target_label, details=None):
    """_admin_log(...)"""
    from ..models import AdminAuditLog
    u = context.uid()
    AdminAuditLog(admin_id=u,
                  admin_name=user_label(u) if u else None,
                  action=action, target_type=target_type, target_id=target_id,
                  target_label=target_label, details=details if details is not None else {}).save()


def now():
    return context.now()


def kosovo_now():
    """_kosovo_now(): local wall-clock time in Kosovo (naive)."""
    return now().astimezone(BELGRADE).replace(tzinfo=None)


def to_local_naive(dt):
    return dt.astimezone(BELGRADE).replace(tzinfo=None) if dt is not None else None


def from_local_naive(naive):
    """'<naive local time> AT TIME ZONE Europe/Belgrade' -> aware UTC datetime."""
    return naive.replace(tzinfo=BELGRADE).astimezone(datetime.timezone.utc)


def next_wednesday_dinner():
    """_next_wednesday_dinner(): next Wednesday 20:00 Kosovo time, at least 24h away."""
    local = kosovo_now()
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    dinner = day + datetime.timedelta(days=(3 - local.isoweekday() + 7) % 7, hours=20)
    if dinner - datetime.timedelta(hours=24) <= local:
        dinner += datetime.timedelta(days=7)
    return from_local_naive(dinner)


def premium_until(user_id):
    """_premium_until(p_user)"""
    from ..models import Subscription
    return (Subscription.objects.filter(user_id=user_id, status='active', ends_at__gt=now())
            .aggregate(m=Max('ends_at'))['m'])


SHARE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'


def new_share_code():
    """_new_share_code(): 8 chars, unused."""
    from ..models import Table
    while True:
        code = ''.join(secrets.choice(SHARE_ALPHABET) for _ in range(8))
        if not Table.objects.filter(share_code=code).exists():
            return code


def add_months(dt, months):
    """Postgres `ts + make_interval(months => n)` (clamps to month end), in UTC like the DB session."""
    m = dt.month - 1 + months
    y = dt.year + m // 12
    m = m % 12 + 1
    import calendar
    d = min(dt.day, calendar.monthrange(y, m)[1])
    return dt.replace(year=y, month=m, day=d)


def distance_km(lat1, lng1, lat2, lng2):
    """_distance_km(): haversine, None if any coordinate is missing."""
    if None in (lat1, lng1, lat2, lng2):
        return None
    r = math.radians
    a = (math.sin(r(lat2 - lat1) / 2) ** 2
         + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def fmt_local(dt, fmt='%d.%m.%Y'):
    """to_char(ts AT TIME ZONE 'Europe/Belgrade', 'DD.MM.YYYY') and similar."""
    return dt.astimezone(BELGRADE).strftime(fmt)
