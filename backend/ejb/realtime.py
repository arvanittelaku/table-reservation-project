"""Row changes for live updates (what trg_realtime_notify + NOTIFY did).

After a transaction commits, each change on a live table is sent to the
Channels group "rt.<table>"; core/realtime.py filters it per subscriber and
re-reads the row with that subscriber's permissions before pushing it.
"""
import logging

from asgiref.sync import async_to_sync
from django.db import transaction

from . import context
from .registry import pk_columns, row_json, table_name, to_json

log = logging.getLogger('ejb.realtime')

LIVE_TABLES = {'lesson_participants', 'lessons', 'memberships', 'messages', 'notifications',
               'requests', 'tables'}


_redis_down_warned = False


def _send(events):
    from channels.layers import get_channel_layer
    layer = get_channel_layer()
    if layer is None:
        return
    global _redis_down_warned
    for ev in events:
        try:
            async_to_sync(layer.group_send)(f"rt.{ev['table']}", {'type': 'rt.change', 'payload': ev})
        except Exception as exc:
            if 'ConnectionError' in type(exc).__name__ or 'refused' in str(exc).lower():
                # Redis not running (e.g. local dev on Windows): live updates are
                # skipped, everything else keeps working. Warn once, not per write.
                if not _redis_down_warned:
                    log.warning('Redis unavailable - live updates disabled (%s)', exc)
                    _redis_down_warned = True
            else:
                log.exception('realtime publish failed')


def record(obj, op):
    table = table_name(type(obj))
    if table not in LIVE_TABLES:
        return
    row = row_json(obj)
    ev = {'schema': 'public', 'table': table, 'type': op,
          'commit_timestamp': to_json(context.now()),
          'record': None if op == 'DELETE' else row,
          # full row, used only by the server to match subscription filters; clients
          # receive just the primary key of old rows (core/realtime.py)
          'old_record': None if op == 'INSERT' else row}
    transaction.on_commit(lambda: _send([ev]))
