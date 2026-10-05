"""Data steps of migration 0002, ported from the SQL migrations of 2026-10-03.

Each function takes (apps, schema_editor) and uses historical models only, so
it keeps working as models change later. All are idempotent: on a database
that already has the data, they change nothing.
"""
import re
import secrets
from collections import Counter, defaultdict

from django.db.models import Q

from . import reference_data

SHARE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'


def drop_changed_constraints(apps, schema_editor):
    """Constraints recreated with new definitions in this migration."""
    with schema_editor.connection.cursor() as c:
        c.execute('create schema if not exists backend')
        c.execute('alter table public.tables drop constraint if exists tables_kind_check')
        c.execute('alter table public.tables drop constraint if exists tables_spots_check')


def backfill_share_codes(apps, schema_editor):
    Table = apps.get_model('ejb', 'Table')
    used = set(Table.objects.exclude(share_code=None).values_list('share_code', flat=True))
    for t in Table.objects.filter(share_code=None).only('id'):
        while True:
            code = ''.join(secrets.choice(SHARE_ALPHABET) for _ in range(8))
            if code not in used:
                break
        used.add(code)
        Table.objects.filter(pk=t.pk).update(share_code=code)


def seed_reference_data(apps, schema_editor):
    Plan = apps.get_model('ejb', 'Plan')
    for row in reference_data.PLANS:
        Plan.objects.get_or_create(id=row['id'], defaults={k: v for k, v in row.items() if k != 'id'})
    Subject = apps.get_model('ejb', 'LessonSubject')
    for row in reference_data.LESSON_SUBJECTS:
        Subject.objects.get_or_create(id=row['id'], defaults={'category': row['category'], 'sort': row['sort']})
    Rule = apps.get_model('ejb', 'NotificationTextRule')
    for row in reference_data.NOTIFICATION_TEXT_RULES:
        Rule.objects.get_or_create(kind=row['kind'], lang=row['lang'], pattern=row['pattern'],
                                   defaults={'param_names': row['param_names'], 'priority': row['priority']})
    Label = apps.get_model('ejb', 'NotificationBadgeLabel')
    for row in reference_data.NOTIFICATION_BADGE_LABELS:
        Label.objects.get_or_create(label=row['label'], defaults={'badge_key': row['badge_key']})


def backfill_payment_snapshots(apps, schema_editor):
    Payment = apps.get_model('ejb', 'Payment')
    for p in Payment.objects.filter(payer_name=None).exclude(user=None).select_related('user'):
        p.payer_name = f'{p.user.first_name} {p.user.last_name}'.strip()
        p.save(update_fields=['payer_name'])
    for p in Payment.objects.filter(table_title=None).exclude(table=None).select_related('table'):
        p.table_title = p.table.title
        p.save(update_fields=['table_title'])


def pg_regex_to_python(pattern):
    """The rule patterns are Postgres AREs ('.' matches newlines, '$' = end of text)."""
    from .hooks import pg_regex
    return pg_regex(pattern)


def classify(body, rules, labels):
    """Same as the old notification_classify(): first matching rule by (priority, id)."""
    if body is None:
        return None, {}
    for r in rules:
        m = pg_regex_to_python(r.pattern).search(body)
        if m:
            params = {}
            groups = m.groups() or (m.group(0),)
            for i, name in enumerate(r.param_names or []):
                params[name] = groups[i] if i < len(groups) else None
            if r.kind == 'badgeEarned' and 'label' in params and params['label'] in labels:
                params['badge'] = labels[params['label']]
            return r.kind, params
    return None, {}


def classify_old_notifications(apps, schema_editor):
    Notification = apps.get_model('ejb', 'Notification')
    Rule = apps.get_model('ejb', 'NotificationTextRule')
    Label = apps.get_model('ejb', 'NotificationBadgeLabel')
    rules = list(Rule.objects.order_by('priority', 'id'))
    labels = dict(Label.objects.values_list('label', 'badge_key'))
    for n in Notification.objects.filter(kind=None).iterator():
        kind, params = classify(n.body, rules, labels)
        if kind:
            n.kind = kind
            n.params = {**(n.params or {}), **params}
            n.save(update_fields=['kind', 'params'])


BADGE_FROM_KEY = {'profileComplete': 'profil', 'firstJoin': 'first-join',
                  'firstRate': 'first-rate', 'firstHost': 'first-host'}


def backfill_badges(apps, schema_editor):
    Badge = apps.get_model('ejb', 'Badge')
    Table = apps.get_model('ejb', 'Table')
    Membership = apps.get_model('ejb', 'Membership')
    Rating = apps.get_model('ejb', 'Rating')
    Taste = apps.get_model('ejb', 'TasteProfile')
    Notification = apps.get_model('ejb', 'Notification')
    want = set()
    want |= {(u, 'first-host') for u in Table.objects.values_list('host_id', flat=True).distinct()}
    want |= {(u, 'first-join') for u in Membership.objects.filter(role='member').values_list('user_id', flat=True).distinct()}
    want |= {(u, 'first-rate') for u in Rating.objects.values_list('rater_id', flat=True).distinct()}
    want |= {(u, 'profil') for u in Taste.objects.filter(done=True).values_list('user_id', flat=True)}
    for uid, params in Notification.objects.filter(kind='badgeEarned', params__has_key='badge').values_list('user_id', 'params'):
        b = BADGE_FROM_KEY.get(params.get('badge'))
        if b:
            want.add((uid, b))
    have = set(Badge.objects.values_list('user_id', 'badge_id'))
    Badge.objects.bulk_create([Badge(user_id=u, badge_id=b) for u, b in want - have], ignore_conflicts=True)

    # keep only the first "badge earned" notification per user and badge
    seen = set()
    drop = []
    for n in Notification.objects.filter(kind='badgeEarned').order_by('created_at', 'id'):
        key = (n.user_id, (n.params or {}).get('badge') or (n.params or {}).get('label'))
        if key in seen:
            drop.append(n.pk)
        seen.add(key)
    Notification.objects.filter(pk__in=drop).delete()


def backfill_onboarded_at(apps, schema_editor):
    Profile = apps.get_model('ejb', 'Profile')
    Table = apps.get_model('ejb', 'Table')
    Membership = apps.get_model('ejb', 'Membership')
    Request = apps.get_model('ejb', 'Request')
    active = (set(Table.objects.values_list('host_id', flat=True))
              | set(Membership.objects.values_list('user_id', flat=True))
              | set(Request.objects.values_list('user_id', flat=True)))
    for p in Profile.objects.filter(onboarded_at=None):
        prefs = p.user_preferences or {}
        if (prefs.get('terms_agreed') is True or p.is_admin or p.pk in active
                or (p.first_name != 'Përdorues' and p.photo_path is not None)):
            p.onboarded_at = p.created_at
            p.save(update_fields=['onboarded_at'])


def backfill_home_city(apps, schema_editor):
    """Home city = the city a user hosted/joined in most (ties: alphabetical)."""
    Profile = apps.get_model('ejb', 'Profile')
    Table = apps.get_model('ejb', 'Table')
    Membership = apps.get_model('ejb', 'Membership')
    counts = defaultdict(Counter)
    for uid, city in Table.objects.exclude(kind='darka_e_merkures').values_list('host_id', 'city'):
        counts[uid][city] += 1
    for uid, city in (Membership.objects.exclude(table__kind='darka_e_merkures')
                      .values_list('user_id', 'table__city')):
        counts[uid][city] += 1
    for p in Profile.objects.filter(home_city=None, pk__in=list(counts)):
        best = sorted(counts[p.pk].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        p.home_city = best
        p.save(update_fields=['home_city'])


def seed_wednesday_restaurants(apps, schema_editor):
    """Baseline data (an early SQL migration): only into an empty table."""
    R = apps.get_model('ejb', 'WednesdayRestaurant')
    if R.objects.exists():
        return
    for row in reference_data.WEDNESDAY_RESTAURANTS:
        R.objects.create(**row)


def drop_legacy_sql(apps, schema_editor):
    """Remove the old SQL implementation (functions, triggers, policies) once
    Django serves the app. Row-level security stays ENABLED with no policies,
    so Supabase's own API (if still reachable) can no longer read or write
    anything. No-op on databases built by Django.
    """
    with schema_editor.connection.cursor() as c:
        # triggers on app tables (not the internal FK triggers), plus the profile trigger on auth.users
        c.execute("""
            SELECT n.nspname, cl.relname, t.tgname FROM pg_trigger t
            JOIN pg_class cl ON cl.oid = t.tgrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
            WHERE NOT t.tgisinternal AND (n.nspname IN ('public', 'backend')
                  OR (n.nspname = 'auth' AND t.tgname = 'on_auth_user_created'))""")
        for schema, table, trig in c.fetchall():
            c.execute(f'DROP TRIGGER IF EXISTS "{trig}" ON "{schema}"."{table}"')
        # policies on app tables
        c.execute("SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'")
        for schema, table, pol in c.fetchall():
            c.execute(f'DROP POLICY IF EXISTS "{pol}" ON "{schema}"."{table}"')
        # functions in public / backend that do not belong to an extension
        c.execute("""
            SELECT p.oid::regprocedure::text FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public', 'backend') AND p.prokind IN ('f', 'p')
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')""")
        for (sig,) in c.fetchall():
            c.execute(f'DROP FUNCTION IF EXISTS {sig} CASCADE')
        # the pg_cron job that formed Wednesday groups (now the backend's scheduler)
        c.execute("SELECT 1 FROM pg_namespace WHERE nspname = 'cron'")
        if c.fetchone():
            c.execute("SELECT jobid FROM cron.job WHERE jobname = 'form-wednesday-groups'")
            for (jobid,) in c.fetchall():
                c.execute('SELECT cron.unschedule(%s)', [jobid])
        # row-level security on for every table in public (deny-all without policies),
        # including django_migrations, which Supabase's default grants would expose
        c.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        for (table,) in c.fetchall():
            c.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
