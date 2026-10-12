"""Who is behind a Django-admin request (/django-admin/).

Sign-in uses Django's own staff users (table public.auth_user, created with
`manage.py createsuperuser`, Django's ModelBackend and password hashers).
They are a separate account store from the app accounts in auth.users (model
ejb.AuthUser): an app account can never sign in to the Django admin, and a
staff user is not an app account.

Admin actions that run the app's server functions (ban, cancel table, mark
order paid, ...) need an app admin as the actor, because those functions check
profiles.is_admin and write the audit log under that person's name. A staff
user is linked to the app account with the same email address, when that
account is an active admin (profiles.is_admin, not banned / deactivated /
deleted); without one, such actions are refused with a message. Viewing data
and plain edits need no link.
"""
from django.utils import timezone


class NotLinked(Exception):
    pass


def linked_account(user):
    """The active app admin account (ejb.AuthUser) with the staff user's email."""
    from ejb.models import AuthUser, Profile
    email = (getattr(user, 'email', '') or '').strip().lower()
    if not email:
        raise NotLinked('your staff user has no email address; set the email of your app admin account on it')
    account = AuthUser.objects.filter(email__iexact=email, deleted_at__isnull=True).first()
    if account is None:
        raise NotLinked(f'no app account with the email {email}')
    if account.banned_until and account.banned_until > timezone.now():
        raise NotLinked(f'the app account {email} is banned')
    if not Profile.objects.filter(pk=account.id, is_admin=True, deactivated_at__isnull=True).exists():
        raise NotLinked(f'the app account {email} is not an active admin (profiles.is_admin)')
    return account
