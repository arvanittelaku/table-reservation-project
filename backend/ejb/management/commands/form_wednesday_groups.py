"""Forms the Wednesday dinner groups whose sign-up deadline has passed.

Replaces the pg_cron job 'form-wednesday-groups' ('5 * * * *'): run it hourly,
at minute 5, e.g. `5 * * * * python manage.py form_wednesday_groups`.
"""
import json

from django.core.management.base import BaseCommand

from ejb import context
from ejb.context import Actor
from ejb.services.wednesday import form_due_wednesday_groups


class Command(BaseCommand):
    help = 'Form due Wednesday dinner groups (run hourly at minute 5).'

    def handle(self, *args, **options):
        with context.acting(Actor.service()):
            res = form_due_wednesday_groups()
        self.stdout.write(json.dumps(res, default=str, ensure_ascii=False))
