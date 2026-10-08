"""Live updates over websockets (what Supabase Realtime did), with Django Channels.

  model save/delete (ejb/realtime.py, sent after commit) -> Channels group
  "rt.<table>" (Redis) -> each connected client's subscriptions -> filter
  match + row permission check -> pushed to the browser.

Permission check: before sending an INSERT/UPDATE, the row is re-read as that
user, so row-level security decides who receives what (Supabase did the same).
DELETE events carry only the primary key, as Supabase's did.

Client messages:   {"type": "auth", "token": "..."}
                   {"type": "subscribe", "id": "s1", "table": "tables", "event": "*", "filter": "city=eq.Pejë"}
                   {"type": "unsubscribe", "id": "s1"}
Server messages:   {"type": "subscribed", "id": "s1"}
                   {"type": "change", "id": "s1", "payload": {schema, table, eventType, new, old, commit_timestamp}}
"""
import asyncio
import json
import logging

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.db import close_old_connections

from ejb import context
from ejb.context import Actor
from ejb.policies import rules_for
from ejb.realtime import LIVE_TABLES
from ejb.registry import model_for, pk_columns, row_json

from .tokens import TokenError, decode_access_token

log = logging.getLogger('ejb.realtime')
MAX_SUBSCRIPTIONS = 50


def match_filter(flt, row):
    """Supabase filter syntax: 'col=eq.value' (eq, neq, lt, lte, gt, gte, in)."""
    if not flt:
        return True
    if row is None:
        return False
    col, _, rest = flt.partition('=')
    op, _, val = rest.partition('.')
    if col not in row:
        return False
    cur = row[col]
    cur_s = '' if cur is None else (json.dumps(cur) if isinstance(cur, (dict, list)) else str(cur))
    if isinstance(cur, bool):
        cur_s = 'true' if cur else 'false'
    if op == 'eq':
        return cur_s == val
    if op == 'neq':
        return cur_s != val
    if op == 'in':
        return cur_s in [v.strip().strip('"') for v in val.strip('()').split(',')]
    try:
        a, b = float(cur_s), float(val)
    except ValueError:
        a, b = cur_s, val
    return {'lt': a < b, 'lte': a <= b, 'gt': a > b, 'gte': a >= b}.get(op, False)


def _visible_row(claims, table, record):
    """The row as this user may see it right now, or None."""
    model = model_for(table)
    if model is None or not record:
        return None
    pks = pk_columns(model)
    if any(k not in record for k in pks):
        return None
    close_old_connections()
    try:
        with context.acting(Actor.from_claims(claims), direct=True) as a:
            lookup = {f.attname: record[f.column]
                      for f in model._meta.concrete_fields if f.column in pks}
            obj = model.objects.filter(rules_for(table).select(a)).filter(**lookup).first()
            return row_json(obj) if obj is not None else None
    except Exception:
        log.exception('realtime visibility check failed')
        return None


def _pk_only(table, record):
    model = model_for(table)
    if model is None or not record:
        return record or {}
    return {c: record.get(c) for c in pk_columns(model)}


class RealtimeConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.claims = None
        self.subs = {}
        self.groups_joined = set()
        await self.accept()
        token = dict(x.split('=', 1) for x in self.scope.get('query_string', b'').decode().split('&') if '=' in x).get('token')
        if token:
            await self._auth(token)

    async def _auth(self, token):
        try:
            self.claims = decode_access_token(token)
            return True
        except TokenError:
            self.claims = None
            await self.send_json({'type': 'error', 'message': 'invalid token'})
            return False

    async def disconnect(self, code):
        for g in self.groups_joined:
            await self.channel_layer.group_discard(g, self.channel_name)

    async def receive_json(self, msg, **kwargs):
        kind = msg.get('type')
        if kind == 'auth':
            await self._auth(msg.get('token') or '')
        elif kind == 'subscribe':
            table = str(msg.get('table') or '')
            if table not in LIVE_TABLES or len(self.subs) >= MAX_SUBSCRIPTIONS:
                await self.send_json({'type': 'error', 'id': msg.get('id'), 'message': 'cannot subscribe'})
                return
            self.subs[str(msg.get('id'))] = {'table': table, 'event': (msg.get('event') or '*').upper(),
                                            'filter': msg.get('filter') or ''}
            group = f'rt.{table}'
            if group not in self.groups_joined:
                await self.channel_layer.group_add(group, self.channel_name)
                self.groups_joined.add(group)
            await self.send_json({'type': 'subscribed', 'id': msg.get('id')})
        elif kind == 'unsubscribe':
            self.subs.pop(str(msg.get('id')), None)
        elif kind == 'ping':
            await self.send_json({'type': 'pong'})

    async def rt_change(self, event):
        p = event['payload']
        table, op = p['table'], p['type']
        matching = [(sid, s) for sid, s in self.subs.items()
                    if s['table'] == table and (s['event'] in ('*', op) or (op == 'UPDATE' and s['event'] == 'DELETE'))]
        if not matching:
            return
        server_row, old_row = p.get('record'), p.get('old_record')
        new_row = None
        if op in ('INSERT', 'UPDATE'):
            new_row = await sync_to_async(_visible_row)(self.claims, table, server_row)
        old_out = _pk_only(table, old_row) if old_row else {}
        for sid, s in matching:
            if op == 'DELETE':
                if not match_filter(s['filter'], old_row):
                    continue
                out_type, out_new = 'DELETE', {}
            elif new_row is not None:
                if s['event'] not in ('*', op) or not match_filter(s['filter'], new_row):
                    continue
                out_type, out_new = op, new_row
            elif op == 'UPDATE' and s['event'] in ('*', 'DELETE') and match_filter(s['filter'], server_row):
                # the row became invisible to this user (e.g. a listing was closed):
                # tell them it is gone, with its primary key only
                out_type, out_new = 'DELETE', {}
            else:
                continue
            await self.send_json({'type': 'change', 'id': sid, 'payload': {
                'schema': p.get('schema', 'public'), 'table': table, 'eventType': out_type,
                'new': out_new, 'old': old_out, 'commit_timestamp': p.get('commit_timestamp'), 'errors': None}})


# ───────────── background: job runner + scheduled work ─────────────

async def job_runner():
    """Runs queued jobs when woken through Redis (ejb.jobs.wake) and every 30 s."""
    import redis.asyncio as aioredis
    from ejb.jobs import WAKE_CHANNEL
    from .jobs import run_pending
    run = sync_to_async(run_pending, thread_sensitive=False)
    while True:
        try:
            r = aioredis.from_url(settings.REDIS_URL)
            pubsub = r.pubsub()
            await pubsub.subscribe(WAKE_CHANNEL)
            await run()
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30)
                await run()   # on a wake-up, or the periodic sweep (retries with backoff)
                if msg is None:
                    continue
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('job runner crashed; restarting')
            await asyncio.sleep(2)


async def _leader(name, ttl=120):
    """True if this process may run a once-per-cluster task now (Redis lock)."""
    import os
    import socket
    import redis.asyncio as aioredis
    r = aioredis.from_url(settings.REDIS_URL)
    me = f'{socket.gethostname()}:{os.getpid()}'
    return bool(await r.set(f'ejb:leader:{name}', me, nx=True, ex=ttl))


async def scheduler():
    """Hourly at minute 5 (was pg_cron '5 * * * *'): form due Wednesday groups."""
    import datetime
    from django.core.management import call_command
    while True:
        try:
            now = datetime.datetime.now(datetime.timezone.utc)
            nxt = now.replace(minute=5, second=0, microsecond=0)
            if nxt <= now:
                nxt += datetime.timedelta(hours=1)
            await asyncio.sleep((nxt - now).total_seconds())
            if await _leader('wednesday-groups'):
                await sync_to_async(call_command, thread_sensitive=False)('form_wednesday_groups')
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('scheduled task failed')
            await asyncio.sleep(60)
