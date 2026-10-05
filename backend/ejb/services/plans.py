"""Plans (Basic / Premium): subscriptions, manual orders and the admin tools."""
import datetime
import functools
from uuid import UUID

from django.db import DatabaseError, IntegrityError
from django.db.models import Sum

from core.db import db_error_from

from .. import context
from ..errors import fail
from ..models import AuthUser, Payment, Plan, Profile, Request, Subscription, SubscriptionOrder, Table
from ..rpc import rpc
from . import common

UTC = datetime.timezone.utc


def db_errors(fn):
    """Postgres errors raised through the ORM (CHECK / NOT NULL / unique violations)
    reach the caller like they did from the SQL function (rpc.call does not convert them)."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        try:
            return fn(*a, **kw)
        except (IntegrityError, DatabaseError) as exc:
            raise db_error_from(exc, anonymous=context.uid() is None) from exc
    return wrapper


def pg_json_ts(dt):
    """How a timestamptz looks inside jsonb (session TimeZone UTC): trailing zeros of the fraction dropped."""
    if dt is None:
        return None
    dt = dt.astimezone(UTC)
    s = dt.strftime('%Y-%m-%dT%H:%M:%S')
    if dt.microsecond:
        s += ('.%06d' % dt.microsecond).rstrip('0')
    return s + '+00:00'


def _pg_trim_null(s):
    """NULLIF(trim(COALESCE(s, '')), '')"""
    t = (s or '').strip(' ')
    return t or None


def _plan_row(p):
    return {'id': p.id, 'tier': p.tier, 'months': p.months, 'price_cents': p.price_cents,
            'monthly_table_limit': p.monthly_table_limit, 'monthly_join_limit': p.monthly_join_limit,
            'active': p.active, 'sort': p.sort}


# ───────────── internal ─────────────

def _grant_premium(p_user, p_plan, p_source, p_amount, p_ref, p_note, p_by):
    months = Plan.objects.filter(pk=p_plan, tier='premium').values_list('months', flat=True).first()
    if months is None:
        fail('Pako e panjohur')
    now = context.now()
    until = common.premium_until(p_user)
    start = max(now, until if until is not None else now).astimezone(UTC)
    ends = common.add_months(start, months)
    sub = Subscription(user_id=p_user, plan_id=p_plan, starts_at=start, ends_at=ends, source=p_source,
                       amount_cents=p_amount or 0, provider_ref=p_ref, note=p_note, created_by_id=p_by,
                       created_at=now)
    sub.save(force_insert=True)
    if (p_amount or 0) > 0:
        Payment(user_id=p_user, table_id=None, subscription_id=sub.id, amount_cents=p_amount,
                provider='provider' if p_source == 'provider' else 'manual',
                provider_ref=p_ref if p_ref is not None else f'SUB-{sub.id}', ticket_code=None,
                table_title=f'Premium: {p_plan}', created_at=now).save(force_insert=True)
    common.notify(p_user, 'info', f'Premium u aktivizua deri më {common.fmt_local(ends)}.',
                  'premiumActivated', {'at': pg_json_ts(ends)})
    return sub.id


def activate_subscription(p_user, p_plan, p_amount_cents, p_provider_ref):
    """Called when a payment provider confirms a payment (idempotent per provider_ref)."""
    existing = (Subscription.objects.filter(provider_ref=p_provider_ref, source='provider')
                .values_list('id', flat=True).first())
    if existing is not None:
        return existing
    SubscriptionOrder.objects.filter(user_id=p_user, status='pending', plan_id=p_plan).update(
        status='paid', handled_at=context.now())
    return _grant_premium(p_user, p_plan, 'provider', p_amount_cents, p_provider_ref, None, None)


# ───────────── user ─────────────

@rpc('my_plan')
@db_errors
def my_plan():
    u = common.require_uid()
    p = Profile.objects.filter(pk=u).first()
    b = Plan.objects.filter(pk='basic').first()
    ms = common.month_start()
    o = (SubscriptionOrder.objects.filter(user_id=u, status='pending')
         .values('id', 'code', 'plan_id', 'amount_cents', 'created_at').first())
    plans = [{'id': x.id, 'tier': x.tier, 'months': x.months, 'price_cents': x.price_cents,
              'monthly_table_limit': x.monthly_table_limit, 'sort': x.sort}
             for x in Plan.objects.filter(active=True).order_by('sort')]
    changed = p.home_city_changed_at if p else None
    return {
        'tier': 'premium' if common.is_premium(u) else 'basic',
        'premium_until': common.premium_until(u),
        'is_admin': p.is_admin if p else None,
        'home_city': p.home_city if p else None,
        'home_city_changed_at': changed,
        'can_change_city_at': None if changed is None else changed + datetime.timedelta(days=30),
        'table_limit': b.monthly_table_limit if b else None,
        'join_limit': b.monthly_join_limit if b else None,
        'tables_this_month': Table.objects.filter(host_id=u, created_at__gte=ms).exclude(kind='darka_e_merkures').count(),
        'joins_this_month': Request.objects.filter(user_id=u, created_at__gte=ms).count(),
        'pending_order': o,
        'plans': plans or None,
    }


@rpc('request_premium')
@db_errors
def request_premium(p_plan: str):
    u = common.require_uid()
    price = (Plan.objects.filter(pk=p_plan, tier='premium', active=True)
             .values_list('price_cents', flat=True).first())
    if price is None:
        fail('Pako e panjohur')
    SubscriptionOrder.objects.filter(user_id=u, status='pending').update(status='cancelled')
    o = SubscriptionOrder(user_id=u, plan_id=p_plan, amount_cents=price, created_at=context.now())
    o.save(force_insert=True)
    return {'id': o.id, 'code': o.code, 'plan_id': p_plan, 'amount_cents': price}


@rpc('cancel_premium_order')
@db_errors
def cancel_premium_order():
    u = context.uid()
    if u is not None:
        SubscriptionOrder.objects.filter(user_id=u, status='pending').update(status='cancelled')
    return None


# ───────────── admin ─────────────

@rpc('admin_grant_premium')
@db_errors
def admin_grant_premium(p_user: UUID, p_plan: str, p_note: str = None):
    common.admin_guard()
    if not Profile.objects.filter(pk=p_user).exists():
        fail('Përdoruesi nuk u gjet')
    note = _pg_trim_null(p_note)
    sub = _grant_premium(p_user, p_plan, 'admin_grant', 0, None, note, context.uid())
    common.admin_log('premium_granted', 'user', p_user, common.user_label(p_user),
                     {'plan': p_plan, 'reason': note})
    return sub


@rpc('admin_mark_order_paid')
@db_errors
def admin_mark_order_paid(p_order: UUID):
    common.admin_guard()
    o = SubscriptionOrder.objects.select_for_update().filter(pk=p_order).first()
    if o is None or o.status != 'pending':
        fail('Porosia nuk është në pritje')
    sub = _grant_premium(o.user_id, o.plan_id, 'manual_payment', o.amount_cents, o.code, None, context.uid())
    SubscriptionOrder.objects.filter(pk=p_order).update(
        status='paid', subscription_id=sub, handled_by_id=context.uid(), handled_at=context.now())
    common.admin_log('premium_order_paid', 'user', o.user_id, common.user_label(o.user_id),
                     {'plan': o.plan_id, 'amount_cents': o.amount_cents, 'code': o.code})
    return sub


@rpc('admin_cancel_order')
@db_errors
def admin_cancel_order(p_order: UUID):
    common.admin_guard()
    n = SubscriptionOrder.objects.filter(pk=p_order, status='pending').update(
        status='cancelled', handled_by_id=context.uid(), handled_at=context.now())
    if not n:
        fail('Porosia nuk është në pritje')
    return None


@rpc('admin_revoke_premium')
@db_errors
def admin_revoke_premium(p_user: UUID, p_reason: str):
    common.admin_guard()
    if _pg_trim_null(p_reason) is None:
        fail('Shkruaj arsyen')
    n = Subscription.objects.filter(user_id=p_user, status='active', ends_at__gt=context.now()).update(status='revoked')
    common.admin_log('premium_revoked', 'user', p_user, common.user_label(p_user), {'reason': p_reason})
    return n


@rpc('admin_update_plan')
@db_errors
def admin_update_plan(p_plan: str, p_price_cents: int, p_table_limit: int, p_join_limit: int, p_active: bool):
    common.admin_guard()
    old = Plan.objects.filter(pk=p_plan).first()
    if old is None:
        fail('Pako e panjohur')
    before = {'price_cents': old.price_cents, 'table_limit': old.monthly_table_limit}
    p = old
    basic = p.tier == 'basic'
    p.price_cents = max(0, p_price_cents if p_price_cents is not None else p.price_cents) if p.tier == 'premium' else 0
    p.monthly_table_limit = p_table_limit if basic else None
    p.monthly_join_limit = p_join_limit if basic else None
    p.active = True if basic else (p_active if p_active is not None else p.active)
    p.save()
    common.admin_log('plan_updated', 'plan', None, p_plan,
                     {'price_cents': p_price_cents, 'table_limit': p_table_limit, 'join_limit': p_join_limit,
                      'active': p_active, 'before': before})
    return None


@rpc('admin_plans_overview')
@db_errors
def admin_plans_overview():
    common.admin_guard()
    now = context.now()
    active = Subscription.objects.filter(status='active')
    plans = [_plan_row(p) for p in Plan.objects.order_by('sort')]
    exp_users = set(active.filter(ends_at__gte=now, ends_at__lte=now + datetime.timedelta(days=7))
                    .values_list('user_id', flat=True))
    long_users = set(active.filter(ends_at__gt=now + datetime.timedelta(days=7)).values_list('user_id', flat=True))

    profiles = {}

    def prof(uid):
        if uid not in profiles:
            profiles[uid] = Profile.objects.filter(pk=uid).values('first_name', 'last_name', 'photo_path').first()
        return profiles[uid]

    def name(p):
        if p['first_name'] is None or p['last_name'] is None:
            return None
        return (p['first_name'] + ' ' + p['last_name']).strip(' ')

    orders = []
    rows = []
    for o in SubscriptionOrder.objects.all():
        p = prof(o.user_id)
        if p is None:
            continue
        rows.append(o)
    rows.sort(key=lambda o: o.created_at, reverse=True)
    rows.sort(key=lambda o: o.status != 'pending')
    rows = sorted(rows[:200], key=lambda o: o.created_at, reverse=True)
    for o in rows:
        p = prof(o.user_id)
        orders.append({'id': o.id, 'code': o.code, 'plan_id': o.plan_id, 'amount_cents': o.amount_cents,
                       'status': o.status, 'created_at': o.created_at, 'handled_at': o.handled_at,
                       'user_id': o.user_id, 'name': name(p), 'photo_path': p['photo_path'],
                       'email': AuthUser.objects.filter(pk=o.user_id).values_list('email', flat=True).first()})

    subs = []
    for s in Subscription.objects.order_by('-created_at'):
        p = prof(s.user_id)
        if p is None:
            continue
        subs.append({'id': s.id, 'plan_id': s.plan_id, 'starts_at': s.starts_at, 'ends_at': s.ends_at,
                     'status': s.status, 'source': s.source, 'amount_cents': s.amount_cents, 'note': s.note,
                     'created_at': s.created_at, 'user_id': s.user_id, 'name': name(p),
                     'photo_path': p['photo_path'],
                     'current': s.status == 'active' and s.starts_at <= now < s.ends_at})
        if len(subs) == 300:
            break

    return {
        'plans': plans or None,
        'active_premium': len(set(active.filter(starts_at__lte=now, ends_at__gt=now).values_list('user_id', flat=True))),
        'revenue_30d_cents': active.filter(created_at__gte=now - datetime.timedelta(days=30))
                                   .aggregate(s=Sum('amount_cents'))['s'] or 0,
        'revenue_total_cents': active.aggregate(s=Sum('amount_cents'))['s'] or 0,
        'expiring_7d': len(exp_users - long_users),
        'orders': orders,
        'subscriptions': subs,
    }
