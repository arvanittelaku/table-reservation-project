"""Official events: listings hosted by the ejaBashkohu team (an admin account).

Client requirement (Premium package): "prioritet tek Wednesday Dinner apo ndonjë
event që ju hostoni". Rules, enforced here and in hooks (not only in the app):

- An admin marks a listing official (`admin_set_official_event`), only when its
  host is an admin account (events the team hosts). Audit-logged.
- Priority window: until `premium_hours` (default 48) before the event only
  Premium members may request a seat or join the waitlist (hooks.join_before_insert,
  so direct inserts into requests/waitlist are covered too).
- Premium first: a Basic request cannot be approved while the remaining seats
  are needed for pending Premium requests (approve_request), and a freed seat
  goes to the first Premium member on the waitlist before any Basic one
  (hooks.membership_after_delete).
- Like Wednesday Dinner, Basic members' city lock and monthly join limit do not
  apply to official events, and Basic members see them in every city
  (policies._tables_select).
"""
import datetime
from uuid import UUID

from .. import context
from ..errors import fail
from ..models import OfficialEvent, Profile, Table
from ..rpc import rpc
from . import common

DEFAULT_PREMIUM_HOURS = 48
MAX_PREMIUM_HOURS = 720

PREMIUM_ONLY = 'Ky event zyrtar është vetëm për anëtarët Premium deri më {until}'
NOT_TEAM_HOSTED = 'Vetëm eventet që hoston ekipi (llogari admini) mund të jenë zyrtare'
PREMIUM_FIRST = 'Aprovo fillimisht kërkesat Premium: vendet e mbetura u takojnë atyre'


def official_for(table_id):
    """The OfficialEvent row of a listing, or None."""
    if table_id is None:
        return None
    return OfficialEvent.objects.filter(table_id=table_id).select_related('table').first()


def premium_until(ev):
    return ev.table.event_datetime - datetime.timedelta(hours=ev.premium_hours)


def in_priority_window(ev, now=None):
    return (now or common.now()) < premium_until(ev)


def official_table_ids():
    return list(OfficialEvent.objects.values_list('table_id', flat=True))


def premium_only_message(ev):
    return PREMIUM_ONLY.format(until=common.fmt_local(premium_until(ev), '%d.%m.%Y %H:%M'))


def _info(ev):
    return {'table_id': ev.table_id, 'premium_hours': ev.premium_hours,
            'premium_until': premium_until(ev), 'priority_open': in_priority_window(ev),
            'marked_by': ev.marked_by_id, 'created_at': ev.created_at, 'updated_at': ev.updated_at}


@rpc('admin_set_official_event')
def admin_set_official_event(p_table: UUID, p_premium_hours: int = DEFAULT_PREMIUM_HOURS):
    """Mark a team-hosted listing official (or change its Premium window)."""
    common.admin_guard()
    hours = DEFAULT_PREMIUM_HOURS if p_premium_hours is None else p_premium_hours
    if hours < 0 or hours > MAX_PREMIUM_HOURS:
        fail(f'Dritarja Premium duhet të jetë 0–{MAX_PREMIUM_HOURS} orë')
    t = Table.objects.filter(pk=p_table).first() if p_table is not None else None
    if t is None:
        fail('Tavolina nuk u gjet')
    if not Profile.objects.filter(pk=t.host_id, is_admin=True).exists():
        fail(NOT_TEAM_HOSTED)
    if t.status == 'cancelled':
        fail('Tavolina është anuluar tashmë')
    ev = OfficialEvent.objects.filter(table_id=t.id).first()
    previous = ev.premium_hours if ev else None
    now = common.now()
    if ev is None:
        ev = OfficialEvent(table_id=t.id, premium_hours=hours, marked_by_id=context.uid(),
                           created_at=now, updated_at=now)
        ev.save(force_insert=True)
    else:
        ev.premium_hours, ev.marked_by_id, ev.updated_at = hours, context.uid(), now
        ev.save()
    ev.table = t
    common.admin_log('table_marked_official', 'table', t.id, t.title,
                     {'premium_hours': hours, 'previous_premium_hours': previous,
                      'premium_until': premium_until(ev).isoformat()})
    return _info(ev)


@rpc('admin_unset_official_event')
def admin_unset_official_event(p_table: UUID) -> bool:
    common.admin_guard()
    ev = official_for(p_table)
    if ev is None:
        return False
    title, hours = ev.table.title, ev.premium_hours
    ev.delete()
    common.admin_log('table_unmarked_official', 'table', p_table, title, {'premium_hours': hours})
    return True
