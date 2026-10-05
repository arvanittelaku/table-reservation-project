"""Queue work for the backend's worker (emails, account deletion).

Replaces `net.http_post(...)` calls to Edge Functions (and later
`_backend_http_post`): the job kind keeps the Edge Function's name.
The worker is woken through Redis right after the transaction commits.
"""
import logging

from django.conf import settings
from django.db import transaction

log = logging.getLogger('ejb.jobs')
WAKE_CHANNEL = 'ejb:jobs'


def enqueue(kind, payload):
    from .models import Job
    job = Job(kind=kind, payload=payload or {})
    job.save()
    transaction.on_commit(wake)
    return job.id


def wake():
    try:
        import redis
        redis.Redis.from_url(settings.REDIS_URL).publish(WAKE_CHANNEL, '1')
    except Exception:  # the worker also sweeps periodically
        log.warning('could not wake the job worker', exc_info=True)
