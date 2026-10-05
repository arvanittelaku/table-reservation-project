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


def _send(events):
    from channels.layers import get_channel_layer
    layer = get_channel_layer()
    if layer is None:
        return
    for ev in events:
        try:
            async_to_sync(layer.group_send)(f"rt.{ev['table']}", {'type': 'rt.change', 'payload': ev})
        except Exception:
            log.exception('realtime publish failed')


def record(obj, op):
    table = table_name(type(obj))
    if table not in LIVE_TABLES:
        return
    row = row_json(obj)
    ev = {'schema': 'public', 'table': table, 'type': op,
          'commit_timestamp': to_json(context.now()),
          'record': None if op == 'DELETE' else row,
          'old_record': None if op == 'INSERT' else {c: row.get(c) for c in pk_columns(type(obj))}}
    transaction.on_commit(lambda: _send([ev]))
