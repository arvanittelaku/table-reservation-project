"""Admin read-only views: dashboard, stats, lists, detail pages, global search.

Ported from the SQL functions admin_*; they only read. The data sets are small,
so rows are fetched with the ORM and shaped / filtered / sorted in Python, which
mirrors the SQL exactly (C.UTF-8 collation = code point order, like Python).
The DB session runs in UTC, so date_trunc buckets are UTC buckets.
"""
import datetime
import re
from uuid import UUID

from .. import context
from ..errors import fail
from ..models import (AdminAuditLog, AuthUser, Ban, Block, Connection, Membership, Message,
                      Payment, Profile, Rating, Report, Request, Table, Waitlist,
                      WednesdayGroup, WednesdayParticipant)
from ..rpc import rpc
from . import common

UTC = datetime.timezone.utc


# ───────────── helpers ─────────────

def _guard_view():
    """IF NOT is_admin_user() THEN RAISE 'Vetëm adminët mund ta shohin këtë'."""
    if not common.is_admin():
        fail('Vetëm adminët mund ta shohin këtë')


def _row(obj):
    """to_jsonb(t.*) of a model instance: every column under its SQL name."""
    return {f.column: getattr(obj, f.attname) for f in obj._meta.concrete_fields}


def _profiles():
    return {p['user_id']: p for p in Profile.objects.values()}


def _emails():
    return dict(AuthUser.objects.values_list('id', 'email'))


def _name(p):
    """trim(first_name || ' ' || last_name) over a LEFT JOIN (None if no profile)."""
    return None if p is None else f"{p['first_name']} {p['last_name']}".strip()


def _like_regex(q):
    """'%' || q || '%' as an ILIKE pattern ('%', '_' wildcards, '\\' escapes)."""
    out, i = [], 0
    while i < len(q):
        c = q[i]
        if c == '\\' and i + 1 < len(q):
            out.append(re.escape(q[i + 1]))
            i += 2
            continue
        out.append('.*' if c == '%' else '.' if c == '_' else re.escape(c))
        i += 1
    return re.compile('.*' + ''.join(out) + '.*', re.IGNORECASE | re.DOTALL)


def _ilike(rx, value):
    return value is not None and rx.fullmatch(value) is not None


def _clean(s):
    """NULLIF(trim(COALESCE(s, '')), '')"""
    s = (s or '').strip()
    return s or None


def _clamp(v, default, hi):
    return max(1, min(default if v is None else v, hi))


def _trunc(dt, unit):
    """date_trunc(unit, ts) in the (UTC) session time zone."""
    dt = dt.astimezone(UTC)
    if unit == 'year':
        return dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    if unit == 'month':
        return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _series(values, unit, weights=None):
    """jsonb_agg({period, count} ORDER BY period) over GROUP BY date_trunc; [] if empty."""
    agg = {}
    for i, v in enumerate(values):
        k = _trunc(v, unit)
        agg[k] = agg.get(k, 0) + (1 if weights is None else weights[i])
    return [{'period': k, 'count': agg[k]} for k in sorted(agg)]


def _since(unit):
    now = common.now()
    if unit == 'day':
        return now - datetime.timedelta(days=30)
    if unit == 'year':
        return common.add_months(now.astimezone(UTC), -60)
    return common.add_months(now.astimezone(UTC), -12)


def _count_by(qs, field):
    out = {}
    for v in qs.values_list(field, flat=True):
        out[v] = out.get(v, 0) + 1
    return out


def _sort(rows, key, desc=False, nulls_last=False):
    """Stable sort by one key; NULLs first on DESC / last on ASC (Postgres default)."""
    nn = [r for r in rows if r[key] is not None]
    nulls = [r for r in rows if r[key] is None]
    nn.sort(key=lambda r: r[key], reverse=desc)
    if nulls_last or not desc:
        return nn + nulls
    return nulls + nn


def _page(rows, offset, limit):
    return rows[offset:offset + limit]


# ───────────── dashboard / stats ─────────────

@rpc('admin_get_dashboard')
def admin_get_dashboard(p_range: str = 'month'):
    common.admin_guard()
    rng = p_range if p_range in ('day', 'month', 'year') else 'month'
    now = common.now()
    today = _trunc(now, 'day')
    since = _since(rng)
    d7, d30 = now - datetime.timedelta(days=7), now - datetime.timedelta(days=30)
    paid = Payment.objects.filter(status='paid')
    future = Table.objects.filter(event_datetime__gt=now)

    def csum(qs):
        return sum(qs.values_list('amount_cents', flat=True))

    totals = {
        'users_total': Profile.objects.count(),
        'users_today': Profile.objects.filter(created_at__gte=today).count(),
        'users_7d': Profile.objects.filter(created_at__gte=d7).count(),
        'users_30d': Profile.objects.filter(created_at__gte=d30).count(),
        'users_deactivated': Profile.objects.filter(deactivated_at__isnull=False).count(),
        'users_unconfirmed': AuthUser.objects.filter(email_confirmed_at__isnull=True).count(),
        'users_active_7d': AuthUser.objects.filter(last_sign_in_at__gte=d7).count(),
        'admins': Profile.objects.filter(is_admin=True).count(),
        'tables_total': Table.objects.count(),
        'tables_upcoming': future.filter(status__in=('open', 'full')).count(),
        'tables_today': Table.objects.filter(created_at__gte=today).count(),
        'tables_cancelled': Table.objects.filter(status='cancelled').count(),
        'seats_taken': Membership.objects.filter(role='member').count(),
        'requests_pending': Request.objects.filter(status='pending', table__event_datetime__gt=now).count(),
        'requests_awaiting_payment': Request.objects.filter(status='approved', table__event_datetime__gt=now).count(),
        'payments_count': paid.count(),
        'revenue_total_cents': csum(paid),
        'revenue_today_cents': csum(paid.filter(created_at__gte=today)),
        'revenue_30d_cents': csum(paid.filter(created_at__gte=d30)),
        'payments_stub': Payment.objects.filter(provider='stub').count(),
        'reports_pending': Report.objects.filter(status='pending').count(),
        'reports_total': Report.objects.count(),
        'bans_total': Ban.objects.count(),
        'banned_users': Ban.objects.values('user_id').distinct().count(),
        'wednesday_upcoming': WednesdayGroup.objects.filter(dinner_date__gt=now).count(),
        'wednesday_participants': WednesdayParticipant.objects.filter(group__dinner_date__gt=now).count(),
    }

    rev = list(paid.filter(created_at__gte=since).values_list('created_at', 'amount_cents'))
    series = {
        'new_users': _series(Profile.objects.filter(created_at__gte=since).values_list('created_at', flat=True), rng),
        'tables_opened': _series(Table.objects.filter(created_at__gte=since).values_list('created_at', flat=True), rng),
        'seats_taken': _series(Membership.objects.filter(role='member', joined_at__gte=since)
                               .values_list('joined_at', flat=True), rng),
        'revenue': _series([r[0] for r in rev], rng, [r[1] for r in rev]),
    }

    # GROUP BY city ORDER BY count DESC LIMIT 8 (ties: undefined order in SQL)
    by_city = sorted(_count_by(Table.objects.all(), 'city').items(), key=lambda kv: -kv[1])[:8]
    by_kind = sorted(_count_by(Table.objects.all(), 'kind').items(), key=lambda kv: -kv[1])

    emails = _emails()
    recent_users = [
        {'id': p['user_id'], 'first_name': p['first_name'], 'last_name': p['last_name'],
         'photo_path': p['photo_path'], 'created_at': p['created_at'], 'email': emails.get(p['user_id'])}
        for p in Profile.objects.order_by('-created_at').values()[:6]]

    seated = _count_by(Membership.objects.all(), 'table_id')
    upcoming = [
        {'id': t['id'], 'title': t['title'], 'city': t['city'], 'kind': t['kind'],
         'event_datetime': t['event_datetime'], 'spots': t['spots'], 'status': t['status'],
         'seated': seated.get(t['id'], 0)}
        for t in future.filter(status__in=('open', 'full')).order_by('event_datetime').values()[:6]]

    profs = _profiles()
    titles = dict(Table.objects.values_list('id', 'title'))
    recent_payments = []
    for pay in Payment.objects.order_by('-created_at').values()[:6]:
        recent_payments.append({
            'id': pay['id'], 'amount_cents': pay['amount_cents'], 'currency': pay['currency'],
            'status': pay['status'], 'provider': pay['provider'], 'ticket_code': pay['ticket_code'],
            'created_at': pay['created_at'], 'user_id': pay['user_id'], 'table_id': pay['table_id'],
            'payer_name': _coalesce(_name(profs.get(pay['user_id'])), pay['payer_name']),
            'table_title': _coalesce(titles.get(pay['table_id']), pay['table_title'])})

    return {
        'range': rng,
        'generated_at': now,
        'totals': totals,
        'series': series,
        'by_city': [{'city': c, 'tables': n} for c, n in by_city],
        'by_kind': [{'kind': k, 'tables': n} for k, n in by_kind],
        'recent_users': recent_users,
        'upcoming_tables': upcoming,
        'recent_payments': recent_payments,
    }


def _coalesce(*vals):
    for v in vals:
        if v is not None:
            return v
    return None


@rpc('admin_get_stats')
def admin_get_stats(p_range: str = 'month'):
    _guard_view()
    unit = p_range if p_range in ('day', 'month', 'year') else 'month'
    since = _since(unit)
    labels = {'day': '30 ditët e fundit', 'month': '12 muajt e fundit', 'year': '5 vitet e fundit'}
    return {
        'range': p_range,
        'period_label': labels.get(p_range, '12 muajt e fundit'),
        'new_users': _series(Profile.objects.filter(created_at__gte=since).values_list('created_at', flat=True), unit),
        'tables_opened': _series(Table.objects.filter(created_at__gte=since).values_list('created_at', flat=True), unit),
        'memberships_joined': _series(Membership.objects.filter(joined_at__gte=since)
                                      .values_list('joined_at', flat=True), unit),
        'totals': {
            'total_users': Profile.objects.count(),
            'total_tables': Table.objects.count(),
            'total_memberships': Membership.objects.count(),
            'active_tables_now': Table.objects.filter(status='open').count(),
            'pending_reports': Report.objects.filter(status='pending').count(),
            'total_bans': Ban.objects.count(),
            'banned_users_distinct': Ban.objects.values('user_id').distinct().count(),
        },
    }


@rpc('admin_get_http_responses')
def admin_get_http_responses(p_limit: int = 10):
    """The SQL read pg_net's net._http_response (responses to net.http_post calls),
    newest first, limit clamped to 1..50, with NO admin check (any signed-in user).
    Outgoing HTTP calls are now backend.jobs rows run by the worker, so nothing
    writes pg_net responses any more and the table is empty: always []."""
    return []


# ───────────── reports ─────────────

@rpc('admin_get_reports')
def admin_get_reports(p_status: str = 'pending'):
    _guard_view()
    profs = _profiles()
    titles = dict(Table.objects.values_list('id', 'title'))
    out = []
    for r in Report.objects.filter(status=p_status).order_by('-created_at').values():
        pr, pd = profs.get(r['reporter_id']), profs.get(r['reported_id'])
        if pr is None or pd is None:   # inner JOINs
            continue
        out.append({'id': r['id'], 'reason': r['reason'], 'status': r['status'], 'created_at': r['created_at'],
                    'reporter_name': pr['first_name'] + ' ' + pr['last_name'],
                    'reported_name': pd['first_name'] + ' ' + pd['last_name'],
                    'reported_id': r['reported_id'], 'table_id': r['table_id'],
                    'table_title': titles.get(r['table_id'])})
    return out


@rpc('admin_list_reports')
def admin_list_reports(p_status: str = 'pending'):
    common.admin_guard()
    profs = _profiles()
    titles = dict(Table.objects.values_list('id', 'title'))
    total = _count_by(Report.objects.all(), 'reported_id')
    bans = _count_by(Ban.objects.all(), 'user_id')
    qs = Report.objects.all()
    if p_status is not None and p_status != 'all':
        qs = qs.filter(status=p_status)
    out = []
    for r in qs.order_by('-created_at').values()[:300]:
        pr, pd, rv = profs.get(r['reporter_id']), profs.get(r['reported_id']), profs.get(r['reviewed_by_id'])
        out.append({
            'id': r['id'], 'reason': r['reason'], 'details': r['details'], 'status': r['status'],
            'created_at': r['created_at'], 'reviewed_at': r['reviewed_at'],
            'reporter_id': r['reporter_id'], 'reporter_name': _name(pr),
            'reporter_photo_path': pr and pr['photo_path'],
            'reported_id': r['reported_id'], 'reported_name': _name(pd),
            'reported_photo_path': pd and pd['photo_path'],
            'reported_is_admin': pd and pd['is_admin'],
            'table_id': r['table_id'], 'table_title': titles.get(r['table_id']),
            'reviewed_by_name': _name(rv),
            'reported_total_reports': total.get(r['reported_id'], 0),
            'reported_bans': bans.get(r['reported_id'], 0)})
    return out


# ───────────── detail pages ─────────────

def _audit_for(target_type, target_id):
    return [{'id': a['id'], 'action': a['action'], 'admin_name': a['admin_name'],
             'details': a['details'], 'created_at': a['created_at']}
            for a in AdminAuditLog.objects.filter(target_type=target_type, target_id=target_id)
            .order_by('-created_at').values()[:30]]


@rpc('admin_get_table')
def admin_get_table(p_table: UUID):
    common.admin_guard()
    t = Table.objects.filter(pk=p_table).first() if p_table is not None else None
    if t is None:
        fail('Tavolina nuk u gjet')
    profs = _profiles()
    emails = _emails()
    host = profs.get(t.host_id)
    table = _row(t)
    table.update(host_name=_name(host), host_photo_path=host and host['photo_path'],
                 host_email=emails.get(t.host_id), is_past=t.event_datetime <= common.now())

    pays = {p['user_id']: p for p in Payment.objects.filter(table_id=p_table).values()}
    members = []
    for m in Membership.objects.filter(table_id=p_table).values():
        p = profs.get(m['user_id'])
        if p is None:
            continue
        pay = pays.get(m['user_id']) or {}
        members.append({'user_id': m['user_id'], 'role': m['role'], 'joined_at': m['joined_at'],
                        'first_name': p['first_name'], 'last_name': p['last_name'],
                        'photo_path': p['photo_path'], 'age': p['age'], 'email': emails.get(m['user_id']),
                        'payment_id': pay.get('id'), 'amount_cents': pay.get('amount_cents'),
                        'payment_status': pay.get('status'), 'ticket_code': pay.get('ticket_code'),
                        'provider': pay.get('provider'), 'paid_at': pay.get('created_at')})
    members.sort(key=lambda x: x['joined_at'])
    members.sort(key=lambda x: x['role'] != 'host')

    requests = []
    for r in Request.objects.filter(table_id=p_table).order_by('-created_at').values():
        p = profs.get(r['user_id'])
        if p is None:
            continue
        requests.append({'id': r['id'], 'user_id': r['user_id'], 'status': r['status'],
                         'created_at': r['created_at'], 'first_name': p['first_name'],
                         'last_name': p['last_name'], 'photo_path': p['photo_path'], 'age': p['age']})

    waitlist = [{'user_id': w['user_id'], 'created_at': w['created_at'],
                 'first_name': profs[w['user_id']]['first_name'], 'last_name': profs[w['user_id']]['last_name']}
                for w in Waitlist.objects.filter(table_id=p_table).order_by('created_at').values()
                if w['user_id'] in profs]

    payments = [{'id': p['id'], 'user_id': p['user_id'], 'amount_cents': p['amount_cents'],
                 'currency': p['currency'], 'status': p['status'], 'provider': p['provider'],
                 'provider_ref': p['provider_ref'], 'ticket_code': p['ticket_code'],
                 'created_at': p['created_at'],
                 'payer_name': _coalesce(_name(profs.get(p['user_id'])), p['payer_name'])}
                for p in Payment.objects.filter(table_id=p_table).order_by('-created_at').values()]

    reports = [{'id': r['id'], 'reason': r['reason'], 'status': r['status'], 'created_at': r['created_at'],
                'reporter_name': _name(profs.get(r['reporter_id'])),
                'reported_name': _name(profs.get(r['reported_id'])), 'reported_id': r['reported_id']}
               for r in Report.objects.filter(table_id=p_table).order_by('-created_at').values()]

    msgs = list(Message.objects.filter(table_id=p_table).values_list('created_at', flat=True))
    return {
        'table': table,
        'members': members,
        'requests': requests,
        'waitlist': waitlist,
        'payments': payments,
        'reports': reports,
        'chat': {'messages': len(msgs), 'last_message_at': max(msgs) if msgs else None},
        'audit': _audit_for('table', p_table),
    }


@rpc('admin_get_user')
def admin_get_user(p_user: UUID):
    common.admin_guard()
    p = Profile.objects.filter(pk=p_user).values().first() if p_user is not None else None
    if p is None:
        fail('Përdoruesi nuk u gjet')
    u = AuthUser.objects.filter(pk=p_user).values('email', 'last_sign_in_at', 'email_confirmed_at',
                                                  'created_at').first() or {}
    profile = {k: p[k] for k in ('first_name', 'last_name', 'age', 'photo_path', 'photo_face_ok', 'is_tourist',
                                 'from_place', 'langs', 'verified', 'rating', 'is_admin', 'deactivated_at',
                                 'created_at')}
    profile.update(id=p['user_id'], email=u.get('email'), last_sign_in_at=u.get('last_sign_in_at'),
                   email_confirmed_at=u.get('email_confirmed_at'), auth_created_at=u.get('created_at'))

    paid = Payment.objects.filter(user_id=p_user, status='paid')
    counts = {
        'hosted': Table.objects.filter(host_id=p_user).count(),
        'joined': Membership.objects.filter(user_id=p_user, role='member').count(),
        'requests': Request.objects.filter(user_id=p_user).count(),
        'payments': paid.count(),
        'paid_cents': sum(paid.values_list('amount_cents', flat=True)),
        'messages': Message.objects.filter(sender_id=p_user).count(),
        'ratings_given': Rating.objects.filter(rater_id=p_user).count(),
        'connections': Connection.objects.filter(a_id=p_user).count() + Connection.objects.filter(b_id=p_user).count(),
        'blocked_by': Block.objects.filter(blocked_id=p_user).count(),
        'blocking': Block.objects.filter(blocker_id=p_user).count(),
        'reports_against': Report.objects.filter(reported_id=p_user).count(),
        'reports_made': Report.objects.filter(reporter_id=p_user).count(),
        'bans': Ban.objects.filter(user_id=p_user).count(),
    }

    profs = _profiles()
    guests = _count_by(Membership.objects.filter(role='member'), 'table_id')
    hosted = [{'id': t['id'], 'title': t['title'], 'kind': t['kind'], 'city': t['city'], 'status': t['status'],
               'event_datetime': t['event_datetime'], 'spots': t['spots'], 'created_at': t['created_at'],
               'guests': guests.get(t['id'], 0)}
              for t in Table.objects.filter(host_id=p_user).order_by('-event_datetime').values()[:50]]

    tables = {t['id']: t for t in Table.objects.values('id', 'title', 'kind', 'city', 'status',
                                                         'event_datetime', 'host_id')}
    my_pays = list(Payment.objects.filter(user_id=p_user).order_by('-created_at').values())
    pay_by_table = {x['table_id']: x for x in my_pays if x['table_id'] is not None}
    joined = []
    for m in Membership.objects.filter(user_id=p_user, role='member').order_by('-joined_at').values()[:50]:
        t = tables[m['table_id']]
        pay = pay_by_table.get(t['id']) or {}
        joined.append({'id': t['id'], 'title': t['title'], 'kind': t['kind'], 'city': t['city'],
                       'status': t['status'], 'event_datetime': t['event_datetime'], 'joined_at': m['joined_at'],
                       'host_name': _name(profs.get(t['host_id'])),
                       'amount_cents': pay.get('amount_cents'), 'ticket_code': pay.get('ticket_code'),
                       'payment_status': pay.get('status')})

    requests = []
    for r in Request.objects.filter(user_id=p_user).order_by('-created_at').values()[:50]:
        t = tables[r['table_id']]
        requests.append({'id': r['id'], 'status': r['status'], 'created_at': r['created_at'],
                         'table_id': t['id'], 'table_title': t['title'], 'event_datetime': t['event_datetime']})

    payments = [{'id': x['id'], 'amount_cents': x['amount_cents'], 'currency': x['currency'],
                 'status': x['status'], 'provider': x['provider'], 'provider_ref': x['provider_ref'],
                 'ticket_code': x['ticket_code'], 'created_at': x['created_at'], 'table_id': x['table_id'],
                 'table_title': _coalesce((tables.get(x['table_id']) or {}).get('title'), x['table_title'])}
                for x in my_pays[:100]]

    reports_against = [{'id': r['id'], 'reason': r['reason'], 'details': r['details'], 'status': r['status'],
                        'created_at': r['created_at'], 'reporter_id': r['reporter_id'],
                        'reporter_name': _name(profs.get(r['reporter_id'])),
                        'table_title': (tables.get(r['table_id']) or {}).get('title')}
                       for r in Report.objects.filter(reported_id=p_user).order_by('-created_at').values()[:50]]
    reports_made = [{'id': r['id'], 'reason': r['reason'], 'status': r['status'], 'created_at': r['created_at'],
                     'reported_id': r['reported_id'], 'reported_name': _name(profs.get(r['reported_id']))}
                    for r in Report.objects.filter(reporter_id=p_user).order_by('-created_at').values()[:50]]
    bans = [{'id': b['id'], 'reason': b['reason'], 'created_at': b['created_at']}
            for b in Ban.objects.filter(user_id=p_user).order_by('-created_at').values()]

    return {
        'profile': profile,
        'counts': counts,
        'hosted_tables': hosted,
        'joined_tables': joined,
        'requests': requests,
        'payments': payments,
        'reports_against': reports_against,
        'reports_made': reports_made,
        'bans': bans,
        'audit': _audit_for('user', p_user),
    }


# ───────────── search ─────────────

@rpc('admin_global_search')
def admin_global_search(p_q: str):
    common.admin_guard()
    q = _clean(p_q)
    if q is None or len(q) < 2:
        return {'users': [], 'tables': [], 'payments': []}
    rx = _like_regex(q)
    emails = _emails()
    profs = _profiles()

    users = []
    for p in Profile.objects.order_by('-created_at').values():
        email = emails.get(p['user_id'])
        if (_ilike(rx, p['first_name'] + ' ' + p['last_name']) or _ilike(rx, email)
                or str(p['user_id']) == q):
            users.append({'id': p['user_id'], 'first_name': p['first_name'], 'last_name': p['last_name'],
                          'photo_path': p['photo_path'], 'email': email,
                          'deactivated_at': p['deactivated_at'], 'is_admin': p['is_admin']})
            if len(users) == 6:
                break

    tables = []
    for t in Table.objects.order_by('-created_at').values('id', 'title', 'city', 'kind', 'status', 'event_datetime'):
        if _ilike(rx, t['title']) or _ilike(rx, t['city']) or str(t['id']) == q:
            tables.append(t)
            if len(tables) == 6:
                break

    payments = []
    for x in Payment.objects.order_by('-created_at').values():
        if _ilike(rx, x['ticket_code'] or '') or _ilike(rx, x['provider_ref']) or str(x['id']) == q:
            payments.append({'id': x['id'], 'ticket_code': x['ticket_code'], 'amount_cents': x['amount_cents'],
                             'status': x['status'], 'created_at': x['created_at'], 'user_id': x['user_id'],
                             'table_id': x['table_id'],
                             'payer_name': _coalesce(_name(profs.get(x['user_id'])), x['payer_name'])})
            if len(payments) == 6:
                break
    return {'users': users, 'tables': tables, 'payments': payments}


# ───────────── lists ─────────────

@rpc('admin_list_audit')
def admin_list_audit(p_limit: int = 50, p_offset: int = 0):
    common.admin_guard()
    limit = _clamp(p_limit, 50, 200)
    offset = max(0, p_offset or 0)
    rows = [_row(a) for a in AdminAuditLog.objects.order_by('-created_at', '-id')[offset:offset + limit]]
    return {'total': AdminAuditLog.objects.count(), 'rows': rows}


@rpc('admin_list_bans')
def admin_list_bans():
    common.admin_guard()
    profs = _profiles()
    emails = _emails()
    groups = {}
    for b in Ban.objects.order_by('-created_at').values():
        groups.setdefault(b['user_id'], []).append(b)
    out = []
    for uid, bans in groups.items():
        p = profs.get(uid)
        out.append({'user_id': uid, 'name': _name(p), 'photo_path': p and p['photo_path'],
                    'deactivated_at': p and p['deactivated_at'], 'email': emails.get(uid),
                    'ban_count': len(bans), 'last_ban_at': bans[0]['created_at'],
                    'last_reason': bans[0]['reason'],
                    'history': [{'id': b['id'], 'reason': b['reason'], 'created_at': b['created_at']} for b in bans]})
    out.sort(key=lambda r: r['last_ban_at'], reverse=True)
    return out


@rpc('admin_list_payments')
def admin_list_payments(p_search: str = None, p_status: str = None, p_provider: str = None,
                        p_from: datetime.datetime = None, p_to: datetime.datetime = None,
                        p_limit: int = 25, p_offset: int = 0):
    common.admin_guard()
    q, status, provider = _clean(p_search), _clean(p_status), _clean(p_provider)
    limit = _clamp(p_limit, 25, 200)
    offset = max(0, p_offset or 0)
    rx = _like_regex(q) if q is not None else None
    profs = _profiles()
    emails = _emails()
    tables = {t['id']: t for t in Table.objects.values('id', 'title', 'city', 'event_datetime', 'host_id')}

    rows = []
    for x in Payment.objects.order_by('-created_at').values():
        t = tables.get(x['table_id'])
        b = {'id': x['id'], 'user_id': x['user_id'], 'table_id': x['table_id'],
             'amount_cents': x['amount_cents'], 'currency': x['currency'], 'provider': x['provider'],
             'provider_ref': x['provider_ref'], 'status': x['status'], 'ticket_code': x['ticket_code'],
             'refundable': x['refundable'], 'created_at': x['created_at'],
             'payer_name': _coalesce(_name(profs.get(x['user_id'])), x['payer_name']),
             'payer_email': emails.get(x['user_id']) if x['user_id'] else None,
             'table_title': _coalesce(t and t['title'], x['table_title']),
             'table_city': t and t['city'], 'table_event_datetime': t and t['event_datetime'],
             'host_name': _name(profs.get(t['host_id'])) if t else None}
        if rx is not None and not (
                _ilike(rx, b['ticket_code'] or '') or _ilike(rx, b['provider_ref'])
                or _ilike(rx, b['payer_name'] or '') or _ilike(rx, b['payer_email'] or '')
                or _ilike(rx, b['table_title'] or '') or str(b['id']) == q
                or str(b['user_id'] or '') == q or str(b['table_id'] or '') == q):
            continue
        if status is not None and b['status'] != status:
            continue
        if provider is not None and b['provider'] != provider:
            continue
        if p_from is not None and b['created_at'] < p_from:
            continue
        if p_to is not None and b['created_at'] >= p_to:
            continue
        rows.append(b)
    paid = [r for r in rows if r['status'] == 'paid']
    return {
        'total': len(rows),
        'sum_paid_cents': sum(r['amount_cents'] for r in paid),
        'count_paid': len(paid),
        'providers': sorted(set(Payment.objects.values_list('provider', flat=True))),
        'rows': _page(rows, offset, limit),
    }


_TABLE_SORTS = {'oldest': ('created_at', False), 'event_asc': ('event_datetime', False),
                'event_desc': ('event_datetime', True), 'most_guests': ('guests', True),
                'most_revenue': ('revenue_cents', True), 'most_requests': ('pending_requests', True)}


@rpc('admin_list_tables')
def admin_list_tables(p_search: str = None, p_status: str = 'all', p_kind: str = None, p_city: str = None,
                      p_sort: str = 'newest', p_limit: int = 25, p_offset: int = 0):
    common.admin_guard()
    q, kind, city = _clean(p_search), _clean(p_kind), _clean(p_city)
    limit = _clamp(p_limit, 25, 100)
    offset = max(0, p_offset or 0)
    rx = _like_regex(q) if q is not None else None
    now = common.now()
    profs = _profiles()
    guests = _count_by(Membership.objects.filter(role='member'), 'table_id')
    seated = _count_by(Membership.objects.all(), 'table_id')
    pending = _count_by(Request.objects.filter(status='pending'), 'table_id')
    approved = _count_by(Request.objects.filter(status='approved'), 'table_id')
    wait = _count_by(Waitlist.objects.all(), 'table_id')
    paid_count, revenue = {}, {}
    for tid, cents in Payment.objects.filter(status='paid').values_list('table_id', 'amount_cents'):
        paid_count[tid] = paid_count.get(tid, 0) + 1
        revenue[tid] = revenue.get(tid, 0) + cents
    msgs = _count_by(Message.objects.all(), 'table_id')
    reps = _count_by(Report.objects.all(), 'table_id')

    rows = []
    for t in Table.objects.order_by('-created_at').values():
        h = profs.get(t['host_id'])
        tid = t['id']
        b = {k: t[k] for k in ('id', 'title', 'kind', 'category', 'city', 'to_city', 'area', 'time_label',
                               'event_datetime', 'created_at', 'status', 'spots', 'women_only', 'men_only',
                               'mystery', 'maps_link', 'host_id')}
        b.update(host_name=_name(h), host_photo_path=h and h['photo_path'],
                 is_past=t['event_datetime'] <= now,
                 guests=guests.get(tid, 0), seated=seated.get(tid, 0),
                 pending_requests=pending.get(tid, 0), awaiting_payment=approved.get(tid, 0),
                 waitlist_count=wait.get(tid, 0), paid_count=paid_count.get(tid, 0),
                 revenue_cents=revenue.get(tid, 0), messages_count=msgs.get(tid, 0),
                 reports_count=reps.get(tid, 0))
        if rx is not None and not (
                _ilike(rx, b['title']) or _ilike(rx, b['city']) or _ilike(rx, b['area'] or '')
                or _ilike(rx, b['host_name'] or '') or str(tid) == q or str(b['host_id']) == q):
            continue
        if kind is not None and b['kind'] != kind:
            continue
        if city is not None and b['city'] != city:
            continue
        st = 'all' if p_status is None else p_status
        ok = {
            'upcoming': lambda: b['status'] in ('open', 'full') and not b['is_past'],
            'past': lambda: b['is_past'] and b['status'] != 'cancelled',
            'full': lambda: b['status'] == 'full' or (b['seated'] >= b['spots'] and b['status'] != 'cancelled'),
            'cancelled': lambda: b['status'] == 'cancelled',
            'reported': lambda: b['reports_count'] > 0,
            'paid': lambda: b['paid_count'] > 0,
        }.get(st, lambda: True)()
        if ok:
            rows.append(b)
    if p_sort in _TABLE_SORTS:
        key, desc = _TABLE_SORTS[p_sort]
        rows = _sort(rows, key, desc)
    return {
        'total': len(rows),
        'cities': sorted(set(Table.objects.values_list('city', flat=True))),
        'rows': _page(rows, offset, limit),
    }


@rpc('admin_list_users')
def admin_list_users(p_search: str = None, p_status: str = 'all', p_sort: str = 'newest',
                     p_limit: int = 25, p_offset: int = 0):
    common.admin_guard()
    q = _clean(p_search)
    limit = _clamp(p_limit, 25, 100)
    offset = max(0, p_offset or 0)
    rx = _like_regex(q) if q is not None else None
    users = {u['id']: u for u in AuthUser.objects.values('id', 'email', 'last_sign_in_at', 'email_confirmed_at')}
    hosted = _count_by(Table.objects.all(), 'host_id')
    joined = _count_by(Membership.objects.filter(role='member'), 'user_id')
    pay_count, paid_cents = {}, {}
    for uid, cents in Payment.objects.filter(status='paid').values_list('user_id', 'amount_cents'):
        pay_count[uid] = pay_count.get(uid, 0) + 1
        paid_cents[uid] = paid_cents.get(uid, 0) + cents
    bans = _count_by(Ban.objects.all(), 'user_id')
    rep = _count_by(Report.objects.all(), 'reported_id')
    rep_p = _count_by(Report.objects.filter(status='pending'), 'reported_id')
    blocked = _count_by(Block.objects.all(), 'blocked_id')

    rows = []
    for p in Profile.objects.order_by('-created_at').values():
        uid = p['user_id']
        u = users.get(uid) or {}
        b = {k: p[k] for k in ('first_name', 'last_name', 'age', 'photo_path', 'is_tourist', 'from_place',
                               'verified', 'rating', 'is_admin', 'deactivated_at', 'created_at')}
        b.update(id=uid, email=u.get('email'), last_sign_in_at=u.get('last_sign_in_at'),
                 email_confirmed_at=u.get('email_confirmed_at'),
                 hosted_count=hosted.get(uid, 0), joined_count=joined.get(uid, 0),
                 payments_count=pay_count.get(uid, 0), paid_cents=paid_cents.get(uid, 0),
                 bans_count=bans.get(uid, 0), reports_against=rep.get(uid, 0),
                 reports_pending=rep_p.get(uid, 0), blocked_by_count=blocked.get(uid, 0))
        if rx is not None and not (_ilike(rx, b['first_name'] + ' ' + b['last_name'])
                                   or _ilike(rx, b['email']) or str(uid) == q):
            continue
        st = 'all' if p_status is None else p_status
        ok = {
            'active': lambda: b['deactivated_at'] is None,
            'deactivated': lambda: b['deactivated_at'] is not None,
            'admin': lambda: b['is_admin'],
            'banned': lambda: b['bans_count'] > 0,
            'reported': lambda: b['reports_pending'] > 0,
            'unconfirmed': lambda: b['email_confirmed_at'] is None,
            'paying': lambda: b['payments_count'] > 0,
            'hosts': lambda: b['hosted_count'] > 0,
        }.get(st, lambda: True)()
        if ok:
            rows.append(b)
    if p_sort == 'oldest':
        rows = _sort(rows, 'created_at')
    elif p_sort == 'name':
        rows.sort(key=lambda r: (r['first_name'] + ' ' + r['last_name']).lower())
    elif p_sort == 'last_active':
        rows = _sort(rows, 'last_sign_in_at', desc=True, nulls_last=True)
    elif p_sort in ('most_hosted', 'most_joined', 'most_paid', 'most_reported'):
        key = {'most_hosted': 'hosted_count', 'most_joined': 'joined_count',
               'most_paid': 'paid_cents', 'most_reported': 'reports_against'}[p_sort]
        rows = _sort(rows, key, desc=True)
    return {'total': len(rows), 'rows': _page(rows, offset, limit)}
