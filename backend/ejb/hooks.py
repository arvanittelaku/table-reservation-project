"""What the database triggers did, as model hooks (wired in signals.py).

Hooks run on every ORM `save()` / `delete()` (including cascades), whether the
write came from the app's direct table queries or from a service. Rule for
service code: change hook-bearing rows with `obj.save()` / `obj.delete()`, not
`QuerySet.update()` / `bulk_create()`, which skip hooks.

Former trigger                        -> here
  auth.users  on_auth_user_created    -> user_created
  profiles    trg_profiles_fill_oauth_names (BEFORE INSERT)          -> profile_before_insert
  profiles    trg_prevent_reactivation, trg_profiles_protect_onboarded_at
                                       (BEFORE UPDATE)                -> profile_before_update
  tables      trg_enforce_plan_tables, trg_tables_require_onboarded  -> table_before_insert
  tables      trg_tables_keep_share_code (BEFORE UPDATE)             -> table_before_update
  tables      trg_bump_hosted, trg_host_member (AFTER INSERT)        -> table_after_insert
  requests    trg_enforce_plan_requests, trg_requests_require_onboarded -> join_before_insert
  requests    trg_notify_request, trg_email_request, trg_requests_touch_table*
                                                                     -> request_after_save / _delete
  waitlist    trg_enforce_plan_waitlist, trg_waitlist_require_onboarded -> join_before_insert
  memberships trg_memberships_touch_table, trg_waitlist_leave        -> membership_after_*
  notifications trg_notifications_tag_kind                           -> notification_before_insert
  payments    trg_payments_fill_snapshot                             -> payment_before_insert
  ratings     trg_apply_rating                                       -> rating_after_insert
  connection_picks trg_mutual_pick                                   -> pick_after_insert
  tutors      trg_tutors_before_write                                -> tutor_before_write
  7 tables    trg_realtime_notify                                    -> realtime.py
"""
import re
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Avg

from . import context, jobs
from .errors import fail

NOT_ONBOARDED = 'Plotëso profilin (emri, mosha, foto) para se të vazhdosh'


# ───────────── notifications ─────────────

def pg_regex(pattern):
    """A Postgres ARE as a Python regex: '.' matches newlines, '$' only at the very end."""
    out, i, in_class = [], 0, False
    while i < len(pattern):
        ch = pattern[i]
        if ch == '\\' and i + 1 < len(pattern):
            out.append(pattern[i:i + 2])
            i += 2
            continue
        if ch == '[' and not in_class:
            in_class = True
        elif ch == ']' and in_class:
            in_class = False
        elif ch == '$' and not in_class:
            ch = r'\Z'
        out.append(ch)
        i += 1
    return re.compile(''.join(out), re.S)


def classify(body):
    """notification_classify(): the rule-table regexes → (kind, params)."""
    from .models import NotificationBadgeLabel, NotificationTextRule
    if body is None:
        return None, {}
    for r in NotificationTextRule.objects.order_by('priority', 'id'):
        m = pg_regex(r.pattern).search(body)
        if m:
            groups = m.groups() or (m.group(0),)   # no groups: regexp_match returns the whole match
            params = {name: (groups[i] if i < len(groups) else None)
                      for i, name in enumerate(r.param_names or [])}
            if r.kind == 'badgeEarned' and 'label' in params:
                key = (NotificationBadgeLabel.objects.filter(label=params['label'])
                       .values_list('badge_key', flat=True).first())
                if key is not None:
                    params['badge'] = key
            return r.kind, params
    return None, {}


def notify(user_id, icon, body, kind=None, params=None):
    """INSERT INTO notifications (...) — the hooks fill kind/params as before."""
    from .models import Notification
    n = Notification(user_id=user_id, icon=icon, body=body, kind=kind,
                     params=params if params is not None else {})
    n.save()
    return n


def notification_before_insert(n):
    if n.params is None:
        n.params = {}
    if n.kind is None:
        kind, params = classify(n.body)
        if kind is not None:
            n.kind = kind
            n.params = {**(n.params or {}), **params}


# ───────────── accounts / profiles ─────────────

def user_created(user):
    """handle_new_user(): every new account gets a profile."""
    from .models import Profile
    meta = user.raw_user_meta_data or {}
    try:
        age = int(meta.get('age')) if meta.get('age') is not None else 18
    except (TypeError, ValueError):
        fail(f'invalid input syntax for type integer: "{meta.get("age")}"', '22P02')
    p = Profile(user_id=user.id,
                first_name=meta.get('first_name') if meta.get('first_name') is not None else 'Përdorues',
                last_name=meta.get('last_name') if meta.get('last_name') is not None else '',
                age=max(18, age))
    p.save(force_insert=True)


def _trim(s):
    return (s or '').strip()


def profile_before_insert(p):
    """profiles_fill_oauth_names(): names from Google/Apple metadata."""
    from .models import AuthUser
    if _trim(p.last_name) != '' and p.first_name != 'Përdorues':
        return
    m = AuthUser.objects.filter(pk=p.user_id).values_list('raw_user_meta_data', flat=True).first() or {}
    full = _trim(m.get('full_name') or m.get('name') or '') or None
    first_word = full.split(' ')[0] if full else ''
    if p.first_name is None or p.first_name == 'Përdorues' or _trim(p.first_name) == '':
        p.first_name = _trim(m.get('given_name')) or first_word or 'Përdorues'
    if p.last_name is None or _trim(p.last_name) == '':
        rest = _trim(full[len(first_word) + 1:]) if full else ''
        p.last_name = _trim(m.get('family_name')) or rest or '-'
    p.first_name = p.first_name[:40]
    p.last_name = p.last_name[:40]


# Columns the app may change directly on its own profile. Everything else goes
# through services (onboarding, home city, admin tools) or is system-maintained.
# (The old policy allowed any column; is_admin, rating, verified and the
# counters were writable by their owner. Closed here.)
PROFILE_CLIENT_COLUMNS = {'first_name', 'last_name', 'age', 'photo_path', 'photo_face_ok', 'is_tourist',
                          'from_place', 'langs', 'user_preferences', 'deactivated_at', 'onboarded_at'}


def profile_before_update(p, old):
    a = context.actor()
    # prevent_reactivation()
    if old.deactivated_at is not None and p.deactivated_at is None and not a.is_admin:
        fail('Llogaritë e çaktivizuara nuk mund të riaktivizohen')
    if context.is_direct() and not a.is_admin:
        # profiles_protect_onboarded_at(): only complete_onboarding() / admins set it
        p.onboarded_at = old.onboarded_at
        for f in ('is_admin', 'verified', 'rating', 'tables_hosted', 'created_at',
                  'home_city', 'home_city_changed_at'):
            setattr(p, f, getattr(old, f))


# ───────────── plan rules (Basic vs Premium) ─────────────

def month_start():
    """_month_start(): first instant of the current month in Europe/Belgrade."""
    import zoneinfo
    tz = zoneinfo.ZoneInfo('Europe/Belgrade')
    local = context.now().astimezone(tz)
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _require_onboarded(user_id):
    from .models import Profile
    if not Profile.objects.filter(pk=user_id, onboarded_at__isnull=False).exists():
        fail(NOT_ONBOARDED)


def table_before_insert(t):
    from .models import Plan, Profile, Table
    from .policies import is_premium
    uid = context.uid()
    # trg_enforce_plan_tables
    if not (t.kind == 'darka_e_merkures' or uid is None or is_premium(t.host_id)):
        home = Profile.objects.filter(pk=t.host_id).values_list('home_city', flat=True).first()
        if home is None:
            fail('Zgjidh qytetin tënd fillimisht')
        if t.city != home:
            fail('Me pakon Bazike hap tavolina vetëm në qytetin tënd')
        limit = Plan.objects.filter(pk='basic').values_list('monthly_table_limit', flat=True).first()
        if limit is not None:
            used = (Table.objects.filter(host_id=t.host_id, created_at__gte=month_start())
                    .exclude(kind='darka_e_merkures').count())
            if used >= limit:
                fail('Ke arritur limitin mujor të tavolinave për pakon Bazike')
    # trg_tables_require_onboarded
    _require_onboarded(t.host_id)


def table_before_update(t, old):
    t.share_code = old.share_code      # tables_keep_share_code()
    # the host closing from the app; admin cancellation sends its own message
    if old.status == 'open' and t.status in ('cancelled', 'closed') and context.is_direct():
        _notify_table_closed(t)


def _notify_table_closed(t):
    """The host closed the listing: everyone with a seat, a request or a waitlist
    spot hears about it (clients cannot write notifications for other users)."""
    from .models import Membership, Request, Waitlist
    users = set(Membership.objects.filter(table_id=t.id).values_list('user_id', flat=True))
    users |= set(Request.objects.filter(table_id=t.id, status__in=('pending', 'approved'))
                 .values_list('user_id', flat=True))
    users |= set(Waitlist.objects.filter(table_id=t.id).values_list('user_id', flat=True))
    users.discard(t.host_id)
    for u in users:
        notify(u, 'info', f'Tavolina "{t.title}" u mbyll nga nikoqiri.',
               'tableClosedByHostNotif', {'table': t.title or ''})


def table_after_insert(t):
    from .models import Membership, Profile
    p = Profile.objects.filter(pk=t.host_id).first()
    if p is not None:                  # bump_tables_hosted()
        p.tables_hosted = (p.tables_hosted or 0) + 1
        with context.definer():
            p.save(update_fields=['tables_hosted'])
    Membership(table_id=t.id, user_id=t.host_id, role='host').save(force_insert=True)  # host_auto_membership()


def join_before_insert(row, table_name):
    """enforce_plan_join() then require_onboarded(), for requests and waitlist."""
    from .models import Plan, Profile, Request, Table
    from .policies import is_premium
    uid = context.uid()
    if not (uid is None or row.user_id != uid or is_premium(row.user_id)):
        t = Table.objects.filter(pk=row.table_id).values('city', 'kind').first() or {}
        if t.get('kind') != 'darka_e_merkures':
            home = Profile.objects.filter(pk=row.user_id).values_list('home_city', flat=True).first()
            if home is None or t.get('city') != home:
                fail('Me pakon Bazike bashkohesh vetëm në qytetin tënd')
            if table_name == 'requests':
                limit = Plan.objects.filter(pk='basic').values_list('monthly_join_limit', flat=True).first()
                if limit is not None:
                    used = Request.objects.filter(user_id=row.user_id, created_at__gte=month_start()).count()
                    if used >= limit:
                        fail('Ke arritur limitin mujor të bashkimeve për pakon Bazike')
    _require_onboarded(row.user_id)


# ───────────── activity / requests / waitlist ─────────────

def touch_table(table_id):
    """touch_table_activity(): any join/leave/request change bumps the listing."""
    from .models import Table
    if table_id is None:
        return
    t = Table.objects.filter(pk=table_id).first()
    if t is not None:
        t.activity_at = context.now()
        with context.definer():
            t.save(update_fields=['activity_at'])


def _name(user_id):
    from .models import Profile
    p = Profile.objects.filter(pk=user_id).values('first_name', 'last_name').first()
    return f"{p['first_name']} {p['last_name']}" if p else None


def request_after_save(r, created, old_status):
    from .models import Table
    t = Table.objects.filter(pk=r.table_id).values('host_id', 'title').first() or {}
    name = _name(r.user_id)
    # trg_notify_request
    if created:
        if t.get('host_id') is not None and name is not None and t.get('title') is not None:
            notify(t['host_id'], '🙋', f'{name} kërkon t\'i bashkohet "{t["title"]}". Shiko profilin dhe vendos.')
        # trg_email_request (production): email the host through the job worker
        jobs.enqueue('notify-email', {'host_id': str(t['host_id']) if t.get('host_id') else None,
                                      'requester_name': name, 'table_title': t.get('title')})
    elif r.status == 'approved' and old_status == 'pending':
        if t.get('title') is not None:
            notify(r.user_id, '✅', f'U aprovove për "{t["title"]}". Konfirmo vendin.')
    touch_table(r.table_id)


def membership_before_insert(m):
    """No seat beyond the table's capacity, whichever path adds it (free seat,
    paid seat from the app, payment webhook)."""
    from .models import Membership, Table
    if m.role == 'host':
        return
    spots = Table.objects.filter(pk=m.table_id).values_list('spots', flat=True).first()
    if spots is not None and Membership.objects.filter(table_id=m.table_id).count() >= spots:
        fail('Ulëset u mbushën')


def membership_after_insert(m):
    """A guest took a seat (paid or free): tell the host."""
    from .models import Table
    if m.role == 'host':
        return
    t = Table.objects.filter(pk=m.table_id).values('host_id', 'title', 'kind').first()
    if not t or t['host_id'] in (None, m.user_id) or t['kind'] == 'darka_e_merkures':
        return
    p = (_name(m.user_id) or '').split(' ')[0]
    notify(t['host_id'], 'check', f'{p} konfirmoi vendin te "{t["title"]}".',
           'hostSeatConfirmedNotif', {'guest': p, 'table': t['title'] or ''})


def membership_after_delete(m):
    from .models import Request, Table, Waitlist
    touch_table(m.table_id)
    # notify_waitlist_on_leave()
    nxt = Waitlist.objects.filter(table_id=m.table_id).order_by('created_at').first()
    if nxt is None:
        return
    title = Table.objects.filter(pk=m.table_id).values_list('title', flat=True).first()
    req = Request.objects.filter(table_id=m.table_id, user_id=nxt.user_id).first()
    if req is None:
        req = Request(table_id=m.table_id, user_id=nxt.user_id, status='approved')
        req.save(force_insert=True)
    else:
        req.status = 'approved'
        req.save(update_fields=['status'])
    user_id = nxt.user_id
    Waitlist.objects.filter(table_id=m.table_id, user_id=user_id).delete()
    if title is not None:
        notify(user_id, '🔔', f'U lirua një vend te "{title}" — ishe i pari në radhë! Konfirmoje.')


# ───────────── payments / ratings / picks / tutors ─────────────

def payment_before_insert(pay):
    from .models import Profile, Table
    if pay.payer_name is None and pay.user_id is not None:
        p = Profile.objects.filter(pk=pay.user_id).values('first_name', 'last_name').first()
        if p:
            pay.payer_name = f"{p['first_name']} {p['last_name']}".strip()
    if pay.table_title is None and pay.table_id is not None:
        pay.table_title = Table.objects.filter(pk=pay.table_id).values_list('title', flat=True).first()


def rating_after_insert(r):
    """apply_rating(): host's average and the rater's taste affinity."""
    from .models import Affinity, Profile, Rating, Table
    t = Table.objects.filter(pk=r.table_id).values('host_id', 'category').first() or {}
    host, cat = t.get('host_id'), t.get('category')
    avg = Rating.objects.filter(table__host_id=host).aggregate(v=Avg('stars'))['v']
    p = Profile.objects.filter(pk=host).first()
    if p is not None:
        p.rating = (Decimal(str(avg)).quantize(Decimal('0.01'), ROUND_HALF_UP) if avg is not None else None)
        with context.definer():
            p.save(update_fields=['rating'])
    delta = (r.stars - 3) * 4
    aff = Affinity.objects.filter(user_id=r.rater_id, category=cat).first()
    if aff is None:
        Affinity(user_id=r.rater_id, category=cat, score=delta).save(force_insert=True)
    else:
        aff.score = max(-40, min(40, aff.score + delta))
        aff.save(update_fields=['score'])


def pick_after_insert(pk):
    """check_mutual_pick(): two people who picked each other get connected."""
    from .models import Connection, ConnectionPick
    if ConnectionPick.objects.filter(table_id=pk.table_id, picker_id=pk.picked_id, picked_id=pk.picker_id).exists():
        lo, hi = sorted([pk.picker_id, pk.picked_id], key=str)
        if not Connection.objects.filter(a_id=lo, b_id=hi).exists():
            Connection(a_id=lo, b_id=hi).save(force_insert=True)
        for u in (lo, hi):
            notify(u, '💫', 'Përputhje e ndërsjellë! Chat-i privat u hap te "Lidhjet e mia".')


def tutor_before_write(tu, old):
    from .models import LessonSubject
    known = set(LessonSubject.objects.values_list('id', flat=True))
    if any(s not in known for s in (tu.subjects or [])):
        fail('Lëndë e panjohur')
    if tu.subjects is not None:
        tu.subjects = sorted(set(tu.subjects))
    if tu.lat is not None:
        tu.lat = float(Decimal(str(tu.lat)).quantize(Decimal('0.01'), ROUND_HALF_UP))
    if tu.lng is not None:
        tu.lng = float(Decimal(str(tu.lng)).quantize(Decimal('0.01'), ROUND_HALF_UP))
    tu.updated_at = context.now()
    a = context.actor()
    if a.uid is not None and not a.is_admin:
        if old is None:
            tu.status = 'pending'
            tu.reviewed_by_id = None
            tu.reviewed_at = None
            tu.rejection_reason = None
        else:
            tu.reviewed_by_id = old.reviewed_by_id
            tu.reviewed_at = old.reviewed_at
            tu.status = 'pending' if old.status == 'rejected' else old.status
            tu.rejection_reason = None if old.status == 'rejected' else old.rejection_reason
