"""The Django admin site at /django-admin/ (Django staff users, see core/admin_auth.py)."""
from django import forms
from django.contrib import admin, messages
from django.contrib.admin.forms import AdminAuthenticationForm
from django.utils.translation import gettext_lazy as _

from core.db import DbError


class StaffLoginForm(AdminAuthenticationForm):
    error_messages = {
        **AdminAuthenticationForm.error_messages,
        'invalid_login': _('Wrong username or password for a Django staff user. App accounts cannot sign in '
                           'here; create staff users with "manage.py createsuperuser".'),
    }


class EjbAdminSite(admin.AdminSite):
    site_header = 'ejaBashkohu — database admin'
    site_title = 'ejaBashkohu admin'
    index_title = 'Data'
    site_url = None
    login_form = StaffLoginForm
    enable_nav_sidebar = True

    def has_permission(self, request):
        return bool(request.user.is_active and request.user.is_staff)


site = EjbAdminSite(name='ejb_admin')


def run_service(modeladmin, request, label, fn, *args):
    """Call a server function as the signed-in admin (same checks, audit log,
    notifications and live updates as the app's admin console). True on success."""
    from ejb import context
    from ejb.context import Actor
    from core.admin_auth import NotLinked, linked_account
    try:
        account = linked_account(request.user)
    except NotLinked as exc:
        modeladmin.message_user(request, f'{label}: not run, {exc}.', messages.ERROR)
        return False
    try:
        with context.acting(Actor(uid=account.id, email=account.email, role='authenticated')):
            fn(*args)
        return True
    except DbError as exc:
        modeladmin.message_user(request, f'{label}: {exc.message}', messages.ERROR)
        return False


def run_for_each(modeladmin, request, queryset, label, call):
    done = sum(1 for obj in queryset if run_service(modeladmin, request, f'{label} ({obj})', call, obj))
    if done:
        modeladmin.message_user(request, f'{label}: {done} done', messages.SUCCESS)


# Django's own staff users and groups (public.auth_user / auth_group)
from django.contrib.auth.admin import GroupAdmin, UserAdmin  # noqa: E402
from django.contrib.auth.models import Group, User  # noqa: E402

site.register(User, UserAdmin)
site.register(Group, GroupAdmin)
