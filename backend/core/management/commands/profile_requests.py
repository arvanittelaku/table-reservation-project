"""Measure every request the web app makes: time, database time and number of queries.

    python manage.py profile_requests                 # as the first admin account
    python manage.py profile_requests --email you@x   # as a specific account
    python manage.py profile_requests --repeat 3      # best of 3 (first call also warms the connection)

Each request goes through the real middleware and views in-process (no HTTP), inside a
transaction that is rolled back, so nothing is changed. Only server functions whose arguments
are all optional are called (listing/overview functions), plus the app's feed and detail queries.
Output is sorted slowest first. "!!" marks a statement repeated many times (an N+1 loop).
"""
import json
import time

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.test import Client

from core.perf import QueryRecorder
from core.tokens import issue_access_token
from ejb import rpc
from ejb.models import AuthUser, Profile

# Functions that only read; anything else with optional args could write, so it is not called.
READ_PREFIXES = ('list_', 'get_', 'my_', 'admin_list', 'admin_dashboard', 'admin_search', 'admin_plans_overview',
                 'admin_wednesday_signups', 'startup_bundle', 'admin_overview', 'admin_activity', 'admin_audit',
                 'admin_payments', 'admin_users', 'admin_tables', 'admin_reports', 'admin_strikes', 'search_',
                 'admin_get', 'admin_wednesday')
SKIP_WORDS = ('sign_url', 'upload', 'delete', 'send', 'form_', 'reset', 'notify')

HOST = 'profiles!tables_host_id_fkey(id, first_name, last_name, age, photo_path, rating, verified)'
FEED_SELECT = ('*, host:%s, memberships(user_id, role, profile:profiles!memberships_user_id_fkey(id, first_name, last_name, age, photo_path)),'
               ' requests(id, user_id, status, profile:profiles!requests_user_id_fkey(id, first_name, last_name, age, photo_path)),'
               ' waitlist(user_id), official_events(premium_hours)') % HOST

QUERIES = [
    ('feed: tables (Prishtinë)', {'table': 'tables', 'action': 'select', 'select': FEED_SELECT,
                                   'filters': [], 'order': [{'column': 'event_datetime', 'ascending': True}], 'limit': 50}),
    ('my notifications', {'table': 'notifications', 'action': 'select', 'select': '*', 'limit': 50}),
    ('my memberships', {'table': 'memberships', 'action': 'select', 'select': 'table_id'}),
    ('my profile', {'table': 'profiles', 'action': 'select', 'select': '*', 'limit': 5}),
    ('messages', {'table': 'messages', 'action': 'select', 'select': 'id, table_id, body, sender:profiles!messages_sender_id_fkey(id, first_name, photo_path)', 'limit': 50}),
    ('requests', {'table': 'requests', 'action': 'select', 'select': 'id, table_id, user_id, status, profile:profiles!requests_user_id_fkey(id, first_name, last_name, age, photo_path, rating)', 'limit': 50}),
    ('blocks', {'table': 'blocks', 'action': 'select', 'select': 'blocked_id'}),
    ('ratings', {'table': 'ratings', 'action': 'select', 'select': 'table_id, stars'}),
    ('connections', {'table': 'connections', 'action': 'select', 'select': 'a, b'}),
]


class Command(BaseCommand):
    help = 'Time every request the app makes (read-only; rolled back).'

    def add_arguments(self, parser):
        parser.add_argument('--email', help='account to act as (default: first admin)')
        parser.add_argument('--repeat', type=int, default=2, help='calls per request; the fastest is reported')

    def handle(self, *args, **opts):
        user = self._user(opts.get('email'))
        token, _ = issue_access_token(user)
        self.stdout.write(f'Acting as {user.email} ({user.id})\n')
        client = Client(HTTP_HOST='localhost', HTTP_AUTHORIZATION=f'Bearer {token}')

        # Warm-up: open the connection so the first request is not charged for it.
        t0 = time.perf_counter()
        connection.ensure_connection()
        connect_ms = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        with connection.cursor() as cur:
            cur.execute('select 1')
        rtt_ms = (time.perf_counter() - t0) * 1000
        self.stdout.write(f'new connection: {connect_ms:.0f} ms   one round trip (select 1): {rtt_ms:.0f} ms\n')

        jobs = []
        for name, spec in sorted(rpc.REGISTRY.items()):
            if any(w in name for w in SKIP_WORDS) or not name.startswith(READ_PREFIXES):
                continue
            if all(has_default for _, _, has_default in spec.params):
                jobs.append((f'rpc {name}', '/rest/v1/rpc/' + name, {}))
        # Functions that need an argument: use real ids from the database.
        from ejb.models import Table
        one_user = Profile.objects.values_list('pk', flat=True).first()
        one_table = Table.objects.values_list('pk', flat=True).first()
        jobs.append(('rpc admin_global_search("a")', '/rest/v1/rpc/admin_global_search', {'p_q': 'a'}))
        if one_user:
            jobs.append(('rpc admin_get_user', '/rest/v1/rpc/admin_get_user', {'p_user': str(one_user)}))
        if one_table:
            jobs.append(('rpc admin_get_table', '/rest/v1/rpc/admin_get_table', {'p_table': str(one_table)}))
        for label, body in QUERIES:
            jobs.append((f'query {label}', '/rest/v1/query', body))

        results = []
        for label, path, body in jobs:
            best = None
            for _ in range(max(1, opts['repeat'])):
                res = self._call(client, path, body)
                if best is None or res['total'] < best['total']:
                    best = res
            best['label'] = label
            results.append(best)

        results.sort(key=lambda r: r['total'], reverse=True)
        self.stdout.write(f"\n{'request':46} {'status':>6} {'total ms':>9} {'db ms':>8} {'queries':>8}  note")
        for r in results:
            note = ''
            if r['repeat']:
                note = f"!! {r['repeat'][1]}x {r['repeat'][0][:70]}"
            elif r['total'] > 800:
                note = 'slow'
            self.stdout.write(f"{r['label'][:46]:46} {r['status']:>6} {r['total']:9.0f} {r['db']:8.0f} {r['queries']:8d}  {note}")
        slow = [r for r in results if r['repeat'] or r['total'] > 800]
        self.stdout.write(f'\n{len(results)} requests measured, {len(slow)} flagged.')

    def _user(self, email):
        if email:
            u = AuthUser.objects.filter(email__iexact=email).first()
        else:
            admin = Profile.objects.filter(is_admin=True).values_list('pk', flat=True).first()
            u = AuthUser.objects.filter(pk=admin).first() if admin else AuthUser.objects.first()
        if not u:
            raise SystemExit('No such account.')
        return u

    def _call(self, client, path, body):
        rec = QueryRecorder()
        start = time.perf_counter()
        status = 0
        try:
            with transaction.atomic():
                with connection.execute_wrapper(rec):
                    resp = client.post(path, data=json.dumps(body), content_type='application/json')
                status = resp.status_code
                transaction.set_rollback(True)     # nothing is kept
        except Exception as exc:                    # keep going; report as 599
            status = 599
            rec.shapes.setdefault(f'ERROR {type(exc).__name__}: {exc}'[:120], (1, 0.0))
        return {'status': status, 'total': (time.perf_counter() - start) * 1000, 'db': rec.seconds * 1000,
                'queries': rec.count, 'repeat': rec.worst_repeat()}
