"""python manage.py preflight — checks before (and after) switching production.

Verifies settings, the database connection and which stage its schema is in,
Redis, outgoing email login and file storage. Changes nothing.
"""
import smtplib

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = 'Check that this server is ready to run ejaBashkohu (read-only).'

    def handle(self, *args, **opts):
        ok = True

        def report(name, good, info=''):
            nonlocal ok
            ok = ok and good
            self.stdout.write(f"{'OK  ' if good else 'FAIL'} {name}{(' — ' + info) if info else ''}")

        report('DEBUG is off', not settings.DEBUG)
        report('API_URL / SITE_URL are https', settings.API_URL.startswith('https://') and settings.SITE_URL.startswith('https://'),
               f'{settings.API_URL} / {settings.SITE_URL}')
        try:
            with connection.cursor() as c:
                c.execute('select version()')
                ver = c.fetchone()[0].split(' on ')[0]
                c.execute("select to_regclass('public.django_migrations') is not null")
                has_dj = c.fetchone()[0]
                applied = []
                if has_dj:
                    c.execute("select name from django_migrations where app = 'ejb' order by id")
                    applied = [r[0] for r in c.fetchall()]
                c.execute("select count(*) from information_schema.columns where table_schema = 'public'"
                          " and table_name = 'profiles' and column_name = 'onboarded_at'")
                new_schema = c.fetchone()[0] == 1
                c.execute("select count(*) from pg_proc where pronamespace = 'public'::regnamespace")
                sql_funcs = c.fetchone()[0]
                c.execute('select count(*) from auth.users')
                users = c.fetchone()[0]
            report('database reachable', True, ver)
            if not applied:
                stage = ('before the switch: run deploy/switch.sh' if not new_schema
                         else 'UNEXPECTED: new columns exist but no Django migrations recorded')
                report('schema stage', not new_schema, stage)
            else:
                report('schema stage', True, f'migrations applied: {", ".join(applied)}')
            report('old SQL functions', True, f'{sql_funcs} still in the database' if sql_funcs else 'removed')
            report('accounts', users > 0, f'{users} in auth.users')
        except Exception as exc:
            report('database reachable', False, str(exc).splitlines()[0])
        try:
            import redis
            redis.Redis.from_url(settings.REDIS_URL).ping()
            report('redis', True)
        except Exception as exc:
            report('redis', False, str(exc))
        if settings.EMAIL_BACKEND.endswith('smtp.EmailBackend'):
            try:
                cls = smtplib.SMTP_SSL if settings.EMAIL_USE_SSL else smtplib.SMTP
                with cls(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=10) as s:
                    if settings.EMAIL_USE_TLS:
                        s.starttls()
                    s.login(settings.EMAIL_HOST_USER, settings.EMAIL_HOST_PASSWORD)
                report('email (SMTP login)', True, settings.EMAIL_HOST)
            except Exception as exc:
                report('email (SMTP login)', False, str(exc))
        else:
            report('email', False, f'EMAIL_BACKEND is {settings.EMAIL_BACKEND}, emails will not be delivered')
        try:
            settings.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
            probe = settings.STORAGE_ROOT / '.preflight'
            probe.write_text('ok')
            probe.unlink()
            report('file storage writable', True, str(settings.STORAGE_ROOT))
        except Exception as exc:
            report('file storage writable', False, str(exc))
        g = settings.OAUTH['google']
        report('Google sign-in configured', bool(g['client_id'] and g['client_secret']),
               '' if g['client_id'] else 'GOOGLE_* empty: the Google button will be hidden')
        self.stdout.write(self.style.SUCCESS('READY') if ok else self.style.ERROR('NOT READY'))
