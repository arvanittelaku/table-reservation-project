"""Live updates over websockets (what Supabase Realtime did), with Django Channels.

  Postgres trigger -> NOTIFY 'realtime' -> one listener (Redis lock picks one
  process) -> Channels group "rt.<table>" -> each connected client's
  subscriptions -> filter match + row permission check -> pushed to the browser.

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
import os
import socket
import uuid

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.conf import settings

from .catalog import get_catalog
from .db import as_user
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
    cat = get_catalog()
    t = cat.tables.get(table)
    if not t or not t.pk or not record or any(k not in record for k in t.pk):
        return None
    cond = ' AND '.join(f'r."{c}" = %s::{t.columns[c]}' for c in t.pk)
    try:
        with as_user(claims) as cur:
            cur.execute(f'SELECT to_jsonb(r) FROM public."{table}" r WHERE {cond}', [record[c] for c in t.pk])
            row = cur.fetchone()
            return row[0] if row else None
    except Exception:
        return None


def _pk_only(table, record):
    t = get_catalog().tables.get(table)
    if not t or not record:
        return record or {}
    return {c: record.get(c) for c in t.pk} if t.pk else record


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
            cat = await sync_to_async(get_catalog)()
            if table not in cat.tables or len(self.subs) >= MAX_SUBSCRIPTIONS:
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
                    if s['table'] == table and s['event'] in ('*', op)]
        if not matching:
            return
        new_row, old_row = p.get('record'), p.get('old_record')
        if op in ('INSERT', 'UPDATE'):
            new_row = await sync_to_async(_visible_row)(self.claims, table, new_row)
            if new_row is None:
                return  # this user may not see the row
            old_out = _pk_only(table, old_row) if old_row else {}
        else:
            old_out = _pk_only(table, old_row)
        for sid, s in matching:
            probe = new_row if op != 'DELETE' else old_row
            if not match_filter(s['filter'], probe):
                continue
            await self.send_json({'type': 'change', 'id': sid, 'payload': {
                'schema': p.get('schema', 'public'), 'table': table, 'eventType': op,
                'new': new_row or {}, 'old': old_out, 'commit_timestamp': p.get('commit_timestamp'), 'errors': None}})


# ───────────── background: NOTIFY listener + job runner ─────────────

def _conninfo():
    db = settings.DATABASES['default']
    parts = {'dbname': db['NAME'], 'user': db['USER'], 'password': db['PASSWORD'], 'host': db['HOST'],
             'port': db['PORT'], 'sslmode': db.get('OPTIONS', {}).get('sslmode', 'prefer')}
    return ' '.join(f"{k}='{v}'" for k, v in parts.items() if v)


async def _leader_lock(name, ttl=6):
    """Only one process forwards NOTIFY events (Redis lock, renewed)."""
    import redis.asyncio as aioredis
    r = aioredis.from_url(settings.REDIS_URL)
    me = f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}'
    key = f'ejb:leader:{name}'
    while True:
        if await r.set(key, me, nx=True, ex=ttl) or (await r.get(key) or b'').decode() == me:
            await r.expire(key, ttl)
            return r, key, me
        await asyncio.sleep(ttl / 3)


async def realtime_listener():
    import psycopg
    layer = get_channel_layer()
    while True:
        try:
            r, key, me = await _leader_lock('realtime')
            async with await psycopg.AsyncConnection.connect(_conninfo(), autocommit=True) as conn:
                await conn.execute('LISTEN realtime')
                log.info('realtime listener active')

                async def renew():
                    while True:
                        await asyncio.sleep(2)
                        if (await r.get(key) or b'').decode() != me:
                            raise RuntimeError('lost leadership')
                        await r.expire(key, 6)
                renewer = asyncio.create_task(renew())
                try:
                    async for note in conn.notifies():
                        try:
                            payload = json.loads(note.payload)
                        except ValueError:
                            continue
                        await layer.group_send(f"rt.{payload.get('table')}", {'type': 'rt.change', 'payload': payload})
                finally:
                    renewer.cancel()
                    # hand over at once on shutdown/redeploy instead of waiting for the TTL
                    try:
                        if (await r.get(key) or b'').decode() == me:
                            await r.delete(key)
                    except Exception:
                        pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('realtime listener crashed; restarting')
            await asyncio.sleep(2)


async def job_runner():
    import psycopg
    from .jobs import run_pending
    run = sync_to_async(run_pending, thread_sensitive=False)
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(_conninfo(), autocommit=True) as conn:
                await conn.execute('LISTEN backend_jobs')
                await run()
                gen = conn.notifies(timeout=30)
                while True:
                    async for _ in gen:
                        await run()
                    await run()  # periodic sweep (retries with backoff)
                    gen = conn.notifies(timeout=30)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('job runner crashed; restarting')
            await asyncio.sleep(2)
