"""The sign-up email-domain check never blocks sign-ups because of our own DNS outage."""
import os
import socket
import unittest
from unittest import mock

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django  # noqa: E402

django.setup()

from core import views_data  # noqa: E402


def fake_dns(known):
    def resolve(host, port, *a, **k):
        if host in known:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.2.3.4', port))]
        raise socket.gaierror(-2, 'Name or service not known')
    return resolve


class EmailDomainTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict('sys.modules', {'dns': None, 'dns.resolver': None})   # no dnspython: A-record path
        p.start()
        self.addCleanup(p.stop)

    def test_existing_domain_accepted(self):
        with mock.patch('socket.getaddrinfo', fake_dns({'gmail.com', 'firma.com'})):
            self.assertEqual(views_data._has_mail_records('firma.com'), (True, 'a_fallback'))

    def test_unknown_domain_rejected_when_dns_works(self):
        with mock.patch('socket.getaddrinfo', fake_dns({'gmail.com', 'google.com'})):
            self.assertEqual(views_data._has_mail_records('nonexistent-zz12.invalid'), (False, 'no_mx'))

    def test_dns_outage_does_not_block(self):
        with mock.patch('socket.getaddrinfo', fake_dns(set())):
            self.assertEqual(views_data._has_mail_records('gmail.com'), (None, 'dns_unavailable'))
