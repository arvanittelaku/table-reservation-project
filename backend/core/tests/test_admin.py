"""Django admin: Django staff-user sign-in (auth_user, not auth.users), every page renders,
read-only rules, actions through the services, CSRF.

Runs in-process against the dev DB inside a rolled-back transaction.
Run: cd backend && python3 -m unittest core.tests.test_admin
"""
import re
import unittest

from django.db import transaction
from django.test import Client
from django.urls import reverse

from core.admin_site import site
from ejb.models import AdminAuditLog, AuthUser, Ban, Profile

APP_ADMIN_EMAIL = 'support@ejabashkohu.com'     # seeded app admin (profiles.is_admin)
ADMIN = ('ops-staff', 'Staff-Pass-9271!')            # Django staff user, created per test


class Rollback(Exception):
    pass


def client(**kw):
    return Client(HTTP_HOST='localhost', **kw)


def make_staff(email=APP_ADMIN_EMAIL):
    from django.contrib.auth.models import User
    return User.objects.create_superuser(ADMIN[0], email, ADMIN[1])


class AdminTests(unittest.TestCase):
    def in_tx(self, fn, staff=True):
        try:
            with transaction.atomic():
                if staff:
                    make_staff()
                fn()
                raise Rollback
        except Rollback:
            pass

    def login(self, c, email, password):
        return c.post('/django-admin/login/?next=/django-admin/', {'username': email, 'password': password})

    def test_login_rules(self):
        def run():
            c = client()
            self.assertEqual(c.get('/django-admin/').status_code, 302)
            r = self.login(c, ADMIN[0], 'wrong-password')
            self.assertEqual(r.status_code, 200)
            self.assertIn('App accounts cannot sign in', r.content.decode())
            # app accounts (auth.users), even app admins, cannot sign in
            self.assertEqual(self.login(c, APP_ADMIN_EMAIL, 'Test1234!').status_code, 200)
            self.assertEqual(c.get('/django-admin/').status_code, 302)
            r = self.login(c, *ADMIN)
            self.assertEqual((r.status_code, r['Location']), (302, '/django-admin/'))
            page = c.get('/django-admin/')
            self.assertEqual(page.status_code, 200)
            self.assertIn('ejaBashkohu', page.content.decode())
            # the staff user lives in public.auth_user, not in auth.users
            from django.contrib.auth.models import User
            self.assertEqual(User._meta.db_table, 'auth_user')
            self.assertFalse(AuthUser.objects.filter(email=ADMIN[0]).exists())
            self.assertEqual(c.get('/django-admin/auth/user/').status_code, 200)
            # cookies are scoped to the admin
            self.assertEqual(c.cookies['ejb_admin_session']['path'], '/django-admin/')
            # non-staff users are refused
            User.objects.filter(username=ADMIN[0]).update(is_staff=False)
            self.assertEqual(c.get('/django-admin/').status_code, 302)
        self.in_tx(run)

    def test_actions_need_linked_app_admin(self):
        def run():
            from django.contrib.auth.models import User
            User.objects.create_superuser('unlinked', 'nobody@example.com', ADMIN[1])
            c = client()
            self.login(c, 'unlinked', ADMIN[1])
            target = Profile.objects.filter(is_admin=False, deactivated_at__isnull=True).first()
            before = Ban.objects.filter(user_id=target.pk).count()
            r = c.post('/django-admin/ejb/profile/', {'action': 'ban', '_selected_action': [str(target.pk)],
                                                      'reason': 'x'}, follow=True)
            self.assertIn('not run, no app account with the email nobody@example.com', r.content.decode())
            self.assertEqual(Ban.objects.filter(user_id=target.pk).count(), before)
        self.in_tx(run)

    def test_every_page_renders_and_read_only(self):
        def run():
            c = client()
            self.login(c, *ADMIN)
            checked = 0
            for model, ma in site._registry.items():
                info = (model._meta.app_label, model._meta.model_name)
                url = reverse('ejb_admin:%s_%s_changelist' % info, current_app='ejb_admin')
                r = c.get(url)
                self.assertEqual(r.status_code, 200, url)
                r = c.get(url, {'q': 'a'})
                self.assertEqual(r.status_code, 200, f'{url}?q=a')
                obj = model.objects.first()
                if obj is not None:
                    r = c.get(reverse('ejb_admin:%s_%s_change' % info, args=[obj.pk]))
                    self.assertEqual(r.status_code, 200, f'{url}{obj.pk}')
                checked += 1
            self.assertGreaterEqual(checked, 26)
            # accounts and profiles cannot be added, edited or deleted in place
            self.assertEqual(c.get('/django-admin/ejb/profile/add/').status_code, 403)
            prof = Profile.objects.exclude(user__email=APP_ADMIN_EMAIL).first()
            r = c.post(f'/django-admin/ejb/profile/{prof.pk}/change/', {'first_name': 'Hacked'})
            self.assertEqual(r.status_code, 403)
            self.assertEqual(c.get(f'/django-admin/ejb/authuser/{prof.pk}/delete/').status_code, 403)
            # password hashes are never shown
            r = c.get(f'/django-admin/ejb/authuser/{prof.pk}/change/')
            self.assertNotIn('$2a$', r.content.decode())
            self.assertNotIn('encrypted_password', r.content.decode())
        self.in_tx(run)

    def test_ban_action_runs_the_service(self):
        def run():
            c = client()
            self.login(c, *ADMIN)
            target = Profile.objects.filter(is_admin=False, deactivated_at__isnull=True).order_by('-created_at').first()
            before = Ban.objects.filter(user_id=target.pk).count()
            r = c.post('/django-admin/ejb/profile/', {'action': 'ban', '_selected_action': [str(target.pk)],
                                                      'reason': 'admin test strike'}, follow=True)
            self.assertEqual(r.status_code, 200)
            self.assertIn('Ban: 1 done', r.content.decode())
            self.assertEqual(Ban.objects.filter(user_id=target.pk).count(), before + 1)
            log = AdminAuditLog.objects.order_by('-created_at').first()
            self.assertEqual(str(log.admin_id), str(AuthUser.objects.get(email=APP_ADMIN_EMAIL).id))
            # service errors are shown, nothing changes
            r = c.post('/django-admin/ejb/profile/', {'action': 'revoke_premium', '_selected_action': [str(target.pk)],
                                                      'reason': ''}, follow=True)
            self.assertEqual(r.status_code, 200)
            self.assertIn('class="error"', r.content.decode())
        self.in_tx(run)

    def test_plan_edit_goes_through_service(self):
        def run():
            from ejb.models import Plan
            c = client()
            self.login(c, *ADMIN)
            basic = Plan.objects.filter(tier='basic').first()
            r = c.post(f'/django-admin/ejb/plan/{basic.pk}/change/',
                       {'price_cents': 999, 'monthly_table_limit': 7, 'monthly_join_limit': 9, 'active': ''})
            self.assertEqual(r.status_code, 302)
            basic.refresh_from_db()
            # admin_update_plan keeps Basic free and active
            self.assertEqual((basic.price_cents, basic.monthly_table_limit, basic.active), (0, 7, True))
            self.assertTrue(AdminAuditLog.objects.filter(action='plan_updated', target_label=basic.pk).exists())
        self.in_tx(run)

    def test_csrf_enforced(self):
        def run():
            c = client(enforce_csrf_checks=True)
            r = c.post('/django-admin/login/', {'username': ADMIN[0], 'password': ADMIN[1]})
            self.assertEqual(r.status_code, 403)
            page = c.get('/django-admin/login/')
            token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page.content.decode()).group(1)
            r = c.post('/django-admin/login/?next=/django-admin/',
                       {'username': ADMIN[0], 'password': ADMIN[1], 'csrfmiddlewaretoken': token})
            self.assertEqual(r.status_code, 302)
        self.in_tx(run)

    def test_static_files_served(self):
        r = client().get('/django-admin/static/admin/css/base.css')
        self.assertEqual(r.status_code, 200)


if __name__ == '__main__':
    unittest.main()
