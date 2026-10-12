"""Unit tests (python3 -m unittest discover -s core/tests -t .).

Tests that touch the database use the dev DB (DB_* / .env) inside a
transaction that is rolled back, so they can run next to the e2e suites.
"""
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ.setdefault('MSGPACK_PUREPYTHON', '1')

import django  # noqa: E402

django.setup()
