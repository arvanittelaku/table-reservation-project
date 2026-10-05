"""Wednesday dinners with strangers: sign-ups, group formation, restaurants."""
import datetime
import random
import re
from uuid import UUID

from django.db.models import Count, Min

from .. import context
from ..errors import fail
from ..models import (Membership, Profile, Table, WednesdayGroup, WednesdayParticipant, WednesdayRestaurant,
                      WednesdaySignup)
from ..rpc import rpc
from . import common
from .plans import db_errors, pg_json_ts

H24 = datetime.timedelta(hours=24)


def _trim(s):
    return (s or '').strip(' ')


def _members(group_id, cols):
    out = []
    for wp in WednesdayParticipant.objects.filter(group_id=group_id).select_related('user'):
        p = wp.user
        row = {'user_id': p.pk}
        for c in cols:
            row[c] = getattr(p, c)
        out.append(row)
    return out


# ───────────── grouping ─────────────

def _form_wednesday_groups(p_dinner):
    """Groups of 3-6 per city, one unused active restaurant each.

    Order: Premium first, then people waitlisted in the previous 15 days, then
    sign-up time. Restaurants are assigned in random order (SQL: ORDER BY random())."""
    groups = grouped = waitlisted = 0
    cities = list(WednesdaySignup.objects.filter(dinner_date=p_dinner, status='signed_up')
                  .values_list('city', flat=True).distinct())
    for city in cities:
        signups = list(WednesdaySignup.objects.filter(dinner_date=p_dinner, city=city, status='signed_up')
                       .order_by('created_at'))
        prem = {s.user_id: common.is_premium(s.user_id) for s in signups}
        prev_wait = set(WednesdaySignup.objects.filter(
            user_id__in=[s.user_id for s in signups], status='waitlisted', dinner_date__lt=p_dinner,
            dinner_date__gte=p_dinner - datetime.timedelta(days=15)).values_list('user_id', flat=True))
        signups.sort(key=lambda s: (not prem[s.user_id], s.user_id not in prev_wait))
        members = [s.user_id for s in signups]
        for s in signups:
            WednesdaySignup.objects.filter(user_id=s.user_id, dinner_date=p_dinner).update(premium=prem[s.user_id])

        used = WednesdayGroup.objects.filter(dinner_date=p_dinner).values('restaurant_id')
        restaurants = list(WednesdayRestaurant.objects.filter(city=city, active=True)
                           .exclude(id__in=used).values_list('id', flat=True))
        random.shuffle(restaurants)
        n = len(members)
        cap = min(len(restaurants), -(-n // 6))

        i = 0
        for g in range(cap):
            size = min(6, n - i)
            if size < 3:     # a table of 1-2 strangers isn't a dinner: they wait
                break
            grp = WednesdayGroup(city=city, dinner_date=p_dinner, restaurant_id=restaurants[g], created_at=context.now())
            grp.save(force_insert=True)
            now = context.now()
            t = Table(host_id=members[i], kind='darka_e_merkures', category='ushqim', title='Darka e së Mërkurës',
                      area='Vendi zbulohet 24 orë para', city=city,
                      time_label=common.fmt_local(p_dinner, '%d.%m %H:%M'), event_datetime=p_dinner,
                      starts_at=p_dinner, spots=size, mystery=True, revealed=False, langs=['sq'],
                      tags=['wednesday'], description='Darkë me të panjohur të përzgjedhur sipas kuizit.',
                      created_at=now, activity_at=now)
            t.save(force_insert=True)
            grp.table_id = t.id
            grp.save(update_fields=['table'])
            for k in range(i, i + size):
                uid = members[k]
                if not WednesdayParticipant.objects.filter(group_id=grp.id, user_id=uid).exists():
                    WednesdayParticipant(group_id=grp.id, user_id=uid).save(force_insert=True)
                if not Membership.objects.filter(table_id=t.id, user_id=uid).exists():
                    Membership(table_id=t.id, user_id=uid, role='host' if k == i else 'member',
                               joined_at=now).save(force_insert=True)
                WednesdaySignup.objects.filter(user_id=uid, dinner_date=p_dinner).update(status='grouped', group_id=grp.id)
                common.notify(uid, 'info',
                              f'U përputhe me {size - 1} persona për Darkën e së Mërkurës! Restoranti zbulohet 24 orë para.',
                              'wednesdayGrouped', {'count': size - 1, 'at': pg_json_ts(p_dinner)})
            groups += 1
            grouped += size
            i += size

        for uid in list(WednesdaySignup.objects.filter(dinner_date=p_dinner, city=city, status='signed_up')
                        .values_list('user_id', flat=True)):
            WednesdaySignup.objects.filter(user_id=uid, dinner_date=p_dinner).update(status='waitlisted')
            common.notify(uid, 'info',
                          'Këtë të mërkurë nuk u formua grup për ty. Je në listën e pritjes dhe ke përparësi javën tjetër.',
                          'wednesdayWaitlisted', {'at': pg_json_ts(p_dinner)})
            waitlisted += 1
    return {'groups': groups, 'grouped': grouped, 'waitlisted': waitlisted}


@rpc('form_due_wednesday_groups')
@db_errors
def form_due_wednesday_groups():
    """Forms every dinner whose sign-up deadline (24h before) has passed. Run hourly (cron '5 * * * *')."""
    u = context.uid()
    if u is not None:
        common.admin_guard()
    now = context.now()
    dates = sorted(set(WednesdaySignup.objects.filter(status='signed_up', dinner_date__lte=now + H24,
                                                      dinner_date__gt=now).values_list('dinner_date', flat=True)))
    res = []
    for d in dates:
        # SQL: res || jsonb_build_object('dinner_date', d) || _form(...) is evaluated left to right
        # (array || object appends), so each dinner adds TWO elements: {dinner_date} then the counts.
        res.append({'dinner_date': d})
        res.append(_form_wednesday_groups(d))
    if u is not None:
        common.admin_log('wednesday_formed', 'wednesday', None, None,
                         {'result': [dict(r, dinner_date=pg_json_ts(r['dinner_date'])) if 'dinner_date' in r else r
                                     for r in res]})
    return res


@rpc('admin_form_wednesday')
@db_errors
def admin_form_wednesday(p_dinner: datetime.datetime = None):
    common.admin_guard()
    dinner = p_dinner
    if dinner is None:
        dinner = (WednesdaySignup.objects.filter(status='signed_up', dinner_date__gt=context.now())
                  .aggregate(m=Min('dinner_date'))['m'])
    if dinner is None:
        return {'groups': 0, 'grouped': 0, 'waitlisted': 0}
    v = _form_wednesday_groups(dinner)
    common.admin_log('wednesday_formed', 'wednesday', None, common.fmt_local(dinner), v)
    return {**v, 'dinner_date': dinner}


# ───────────── user ─────────────

@rpc('my_wednesday')
@db_errors
def my_wednesday():
    u = context.uid()
    nxt = common.next_wednesday_dinner()
    s = None
    if u is not None:
        s = (WednesdaySignup.objects.filter(user_id=u, dinner_date__gt=context.now() - datetime.timedelta(hours=3))
             .exclude(status='cancelled').order_by('dinner_date').first())
    signup = None
    if s is not None:
        signup = {
            'dinner_date': s.dinner_date, 'deadline': s.dinner_date - H24, 'city': s.city, 'status': s.status,
            'group_id': s.group_id,
            'table_id': (WednesdayGroup.objects.filter(pk=s.group_id).values_list('table_id', flat=True).first()
                         if s.group_id is not None else None),
            'members': [] if s.group_id is None else _members(s.group_id, ('first_name', 'age', 'photo_path')),
        }
    return {'next_dinner': nxt, 'deadline': nxt - H24, 'premium': common.is_premium(u), 'signup': signup}


@rpc('signup_wednesday')
@db_errors
def signup_wednesday(p_city: str, p_langs: list[str] = []):  # noqa: B006 (never mutated)
    dinner = common.next_wednesday_dinner()
    u = common.require_onboarded_me()
    if not WednesdayRestaurant.objects.filter(city=p_city, active=True).exists():
        fail('Nuk ka restorante për këtë qytet')
    if not common.is_premium(u):
        home = Profile.objects.filter(pk=u).values_list('home_city', flat=True).first()
        if home != p_city:
            fail('Me pakon Bazike bashkohesh vetëm në qytetin tënd')
    langs = list(p_langs) if p_langs is not None else []
    s = WednesdaySignup.objects.select_for_update().filter(user_id=u, dinner_date=dinner).first()
    if s is None:
        WednesdaySignup(user_id=u, dinner_date=dinner, city=p_city, langs=langs,
                        created_at=context.now()).save(force_insert=True)
    elif s.status in ('signed_up', 'cancelled'):
        WednesdaySignup.objects.filter(user_id=u, dinner_date=dinner).update(
            city=p_city, langs=langs, status='signed_up',
            created_at=context.now() if s.status == 'cancelled' else s.created_at)
    return my_wednesday()


@rpc('cancel_wednesday_signup')
@db_errors
def cancel_wednesday_signup():
    u = context.uid()
    if u is not None:
        WednesdaySignup.objects.filter(user_id=u, status='signed_up', dinner_date__gt=context.now()).update(status='cancelled')
    return None


@rpc('get_my_wednesday_groups', anon=True)
@db_errors
def get_my_wednesday_groups():
    u = context.uid()
    if u is None:
        return []
    return [{'group_id': g.id, 'city': g.city, 'dinner_date': g.dinner_date}
            for g in WednesdayGroup.objects.filter(participants__user_id=u).order_by('dinner_date')]


@rpc('get_wednesday_restaurant', anon=True)
@db_errors
def get_wednesday_restaurant(p_group: UUID):
    u = context.uid()
    g = None
    if u is not None:
        g = WednesdayGroup.objects.filter(pk=p_group, participants__user_id=u).values('dinner_date', 'restaurant_id').first()
    if g is None or g['dinner_date'] is None:
        fail("Grupi nuk ekziston ose s'je pjesëmarrës")
    if context.now() < g['dinner_date'] - H24:
        return {'name': None, 'address': None, 'maps_link': None, 'revealed': False}
    r = WednesdayRestaurant.objects.filter(pk=g['restaurant_id']).values('name', 'address', 'maps_link').first() or {}
    return {'name': r.get('name'), 'address': r.get('address'), 'maps_link': r.get('maps_link'), 'revealed': True}


@rpc('create_wednesday_dinner_group', anon=True)
@db_errors
def create_wednesday_dinner_group(p_city: str, p_dinner_date: datetime.datetime):
    u = context.uid()
    if u is None:
        fail('Duhet të jesh i kyçur')
    ids = list(WednesdayRestaurant.objects.filter(city=p_city, active=True).values_list('id', flat=True))
    if not ids:
        fail('Nuk ka restorante për këtë qytet')
    g = WednesdayGroup(city=p_city, dinner_date=p_dinner_date, restaurant_id=random.choice(ids),
                       created_at=context.now())
    g.save(force_insert=True)
    WednesdayParticipant(group_id=g.id, user_id=u).save(force_insert=True)
    return g.id


# ───────────── admin ─────────────

@rpc('admin_list_wednesday')
@db_errors
def admin_list_wednesday():
    common.admin_guard()
    now = context.now()
    groups = []
    for g in WednesdayGroup.objects.order_by('-dinner_date')[:200]:
        r = WednesdayRestaurant.objects.filter(pk=g.restaurant_id).first()
        groups.append({'id': g.id, 'city': g.city, 'dinner_date': g.dinner_date, 'created_at': g.created_at,
                       'restaurant_id': g.restaurant_id,
                       'restaurant_name': r.name if r else None, 'restaurant_address': r.address if r else None,
                       'revealed': now >= g.dinner_date - H24,
                       'participants': _members(g.id, ('first_name', 'last_name', 'photo_path', 'age'))})
    restaurants = [{'id': r.id, 'name': r.name, 'city': r.city, 'address': r.address, 'maps_link': r.maps_link,
                    'active': r.active, 'times_used': 0}
                   for r in WednesdayRestaurant.objects.order_by('city', 'name')]
    used = dict(WednesdayGroup.objects.values('restaurant_id').annotate(n=Count('id')).values_list('restaurant_id', 'n'))
    for r in restaurants:
        r['times_used'] = used.get(r['id'], 0)
    return {'groups': groups, 'restaurants': restaurants}


@rpc('admin_wednesday_signups')
@db_errors
def admin_wednesday_signups():
    common.admin_guard()
    rows = []
    qs = (WednesdaySignup.objects.filter(dinner_date__gt=context.now() - datetime.timedelta(days=1))
          .exclude(status='cancelled').select_related('user').order_by('dinner_date', 'city', 'created_at'))
    for s in qs:
        p = s.user
        rows.append({'user_id': s.user_id, 'dinner_date': s.dinner_date, 'city': s.city, 'status': s.status,
                     'created_at': s.created_at, 'group_id': s.group_id,
                     'is_premium': common.is_premium(s.user_id) if s.status == 'signed_up' else s.premium,
                     'first_name': p.first_name, 'last_name': p.last_name, 'photo_path': p.photo_path, 'age': p.age})
    rows.sort(key=lambda r: (r['dinner_date'], r['city'], not r['is_premium']))  # stable: created_at kept
    return rows


@rpc('admin_set_restaurant_active')
@db_errors
def admin_set_restaurant_active(p_restaurant: UUID, p_active: bool):
    common.admin_guard()
    r = WednesdayRestaurant.objects.filter(pk=p_restaurant).first()
    if r is None:
        fail('Restoranti nuk u gjet')
    r.active = p_active
    r.save(update_fields=['active'])
    common.admin_log('restaurant_activated' if p_active else 'restaurant_deactivated',
                     'restaurant', p_restaurant, r.name, {})
    return None


MAPS_RE = re.compile(r'^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)',
                     re.IGNORECASE)


@rpc('admin_upsert_restaurant')
@db_errors
def admin_upsert_restaurant(p_id: UUID, p_name: str, p_city: str, p_address: str, p_maps_link: str):
    common.admin_guard()
    if len(_trim(p_name)) < 2 or len(_trim(p_city)) < 2 or len(_trim(p_address)) < 2:
        fail('Emri, qyteti dhe adresa janë të detyrueshme')
    link = _trim(p_maps_link) or None
    if link is not None and not MAPS_RE.search(p_maps_link):
        fail('Linku i hartës duhet të jetë link Google Maps')
    if p_id is None:
        r = WednesdayRestaurant(name=_trim(p_name), city=_trim(p_city), address=_trim(p_address),
                                maps_link=link, active=True)
        r.save(force_insert=True)
        common.admin_log('restaurant_created', 'restaurant', r.id, _trim(p_name), {})
    else:
        r = WednesdayRestaurant.objects.filter(pk=p_id).first()
        if r is None:
            fail('Restoranti nuk u gjet')
        r.name, r.city, r.address, r.maps_link = _trim(p_name), _trim(p_city), _trim(p_address), link
        r.save(update_fields=['name', 'city', 'address', 'maps_link'])
        common.admin_log('restaurant_updated', 'restaurant', r.id, _trim(p_name), {})
    return r.id
