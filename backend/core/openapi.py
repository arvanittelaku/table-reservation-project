"""OpenAPI 3.1 description of the HTTP API (served at /api/openapi.json, read at /api/docs).

The server functions (/rest/v1/rpc/<name>) are generated from ejb.rpc.REGISTRY:
names, argument names and types from the annotations, required vs optional
from defaults, and whether they can be called signed out (anon). Table
schemas come from the Django models. Everything else (auth, query, storage,
functions, realtime) is described here by hand; backend/API.md is the guide.
"""
import datetime
import inspect
import types
import typing
import uuid

from django.conf import settings
from django.db import models

SUMMARIES = {
    # tables
    'request_join': 'Ask to join a table (host approves). Returns the request id.',
    'approve_request': 'Host: approve a join request.',
    'reject_request': 'Host: reject a join request.',
    'confirm_free_seat': 'Confirm your approved seat at a free table.',
    'leave_table': 'Leave a table you joined (the next person on the waitlist is notified).',
    'table_share_preview': 'Public preview of a table from its share code (works signed out).',
    'complete_onboarding': 'Finish onboarding: name, age, tourist flag, where from.',
    'set_home_city': 'Set your home city (Basic plan: limited changes).',
    'award_badge': 'Award yourself an app badge the app earned locally (e.g. first table).',
    # lessons
    'list_tutors': 'Approved tutors, filterable by subject/category/format/price and distance (lat/lng/radius km).',
    'list_group_lessons': 'Upcoming group lessons with free seats.',
    'book_lesson': 'Request a one-to-one lesson with a tutor. Returns the lesson id.',
    'respond_lesson_request': 'Tutor: accept or decline a lesson request.',
    'create_group_lesson': 'Tutor: create a group lesson. Returns the lesson id.',
    'join_group_lesson': 'Join a group lesson.',
    'confirm_lesson_seat': 'Confirm (pay the booking fee for) an accepted lesson. Returns the ticket code.',
    'cancel_lesson': 'Cancel a lesson (tutor) or your seat (student).',
    'get_lesson_room': ('Video room of an online lesson, from 15 min before the start until 30 min after the end, '
                        'for the tutor and confirmed students. Returns room, starts_at, duration_min, provider '
                        '("jaas" | "jitsi"), domain, room_name, jwt (JaaS participant token, tutor = moderator), '
                        'jwt_expires_at, script_url, moderator, display_name.'),
    'my_lessons': 'Your lessons as student and as tutor.',
    # plans
    'my_plan': 'Your plan (Basic/Premium), limits and usage this month, open order.',
    'request_premium': 'Order a Premium plan (paid by bank transfer / in person; an admin marks it paid).',
    'cancel_premium_order': 'Cancel your open Premium order.',
    # wednesday dinners
    'my_wednesday': 'Your sign-up for the next Wednesday dinner.',
    'signup_wednesday': 'Sign up for the next Wednesday dinner in a city.',
    'cancel_wednesday_signup': 'Cancel your Wednesday dinner sign-up.',
    'get_my_wednesday_groups': 'Wednesday dinner groups you are in.',
    'get_wednesday_restaurant': 'The restaurant of your group (revealed 24 h before the dinner).',
    # basics
    'is_admin_user': 'Whether you are an admin.',
    'is_premium': 'Whether a user has Premium now.',
    'can_see_city': 'Whether you may see tables of a city (Basic: home city only).',
}


def _schema(ann):
    """JSON schema for a Python annotation used by @rpc functions."""
    if ann is inspect.Parameter.empty or ann is None or ann is type(None):
        return {}
    origin = typing.get_origin(ann)
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        s = _schema(args[0]) if args else {}
        return {**s, 'type': [s['type'], 'null']} if 'type' in s and isinstance(s['type'], str) else s
    if origin is list or ann is list:
        inner = (typing.get_args(ann) or (None,))[0]
        return {'type': 'array', 'items': _schema(inner) if inner else {}}
    return {
        uuid.UUID: {'type': 'string', 'format': 'uuid'},
        int: {'type': 'integer'},
        float: {'type': 'number'},
        bool: {'type': 'boolean'},
        str: {'type': 'string'},
        datetime.datetime: {'type': 'string', 'format': 'date-time'},
        datetime.date: {'type': 'string', 'format': 'date'},
        dict: {'type': 'object'},
    }.get(ann, {})


def _tag_for(spec):
    if spec.name.startswith('admin_') or spec.name == 'form_due_wednesday_groups':
        return 'Functions: admin'
    mod = spec.fn.__module__.rsplit('.', 1)[-1]
    return {'tables': 'Functions: tables', 'basics': 'Functions: basics', 'lessons': 'Functions: lessons',
            'plans': 'Functions: plans', 'wednesday': 'Functions: Wednesday dinners'}.get(mod, 'Functions: other')


def rpc_operations():
    from ejb.rpc import REGISTRY
    paths = {}
    for name in sorted(REGISTRY):
        spec = REGISTRY[name]
        sig = inspect.signature(spec.fn)
        props, required = {}, []
        for pname, ann, has_default in spec.params:
            s = _schema(ann)
            if has_default:
                d = sig.parameters[pname].default
                if d is not None and isinstance(d, (str, int, float, bool, list)):
                    s = {**s, 'default': d}
            else:
                required.append(pname)
            props[pname] = s
        returns = _schema(typing.get_type_hints(spec.fn).get('return', inspect.Parameter.empty))
        desc = SUMMARIES.get(name) or (inspect.getdoc(spec.fn) or '').split('\n\n')[0] or None
        if name.startswith('admin_'):
            desc = (desc + ' ' if desc else '') + 'Admins only.'
        if name.startswith('_'):
            desc = (desc + ' ' if desc else '') + 'Internal helper (kept for compatibility).'
        op = {
            'operationId': f'rpc_{name}',
            'tags': [_tag_for(spec)],
            'summary': name,
            'x-anon': spec.anon,
            'requestBody': {'required': True, 'content': {'application/json': {'schema': {
                'type': 'object', 'additionalProperties': False, 'properties': props,
                **({'required': required} if required else {})}}}},
            'responses': {
                '200': {'description': 'Result', 'content': {'application/json': {'schema': {
                    'type': 'object', 'properties': {'data': returns or {'description': 'JSON result'}}}}}},
                '400': {'$ref': '#/components/responses/DbError'},
                '401': {'$ref': '#/components/responses/DbError'},
                '404': {'description': 'Unknown function or wrong argument names (PGRST202)',
                        'content': {'application/json': {'schema': {'$ref': '#/components/schemas/DbError'}}}},
            },
            'security': [{'bearer': []}, {}] if spec.anon else [{'bearer': []}],
        }
        if desc:
            op['description'] = desc + (' Callable signed out (the function may still refuse).' if spec.anon else '')
        paths[f'/rest/v1/rpc/{name}'] = {'post': op}
    return paths


def _column_schema(f):
    if isinstance(f, models.UUIDField):
        s = {'type': 'string', 'format': 'uuid'}
    elif isinstance(f, (models.IntegerField, models.BigIntegerField, models.AutoField)):
        s = {'type': 'integer'}
    elif isinstance(f, (models.FloatField, models.DecimalField)):
        s = {'type': 'number'}
    elif isinstance(f, models.BooleanField):
        s = {'type': 'boolean'}
    elif isinstance(f, models.DateTimeField):
        s = {'type': 'string', 'format': 'date-time'}
    elif isinstance(f, models.DateField):
        s = {'type': 'string', 'format': 'date'}
    elif isinstance(f, models.JSONField):
        s = {}
    elif f.get_internal_type() == 'ArrayField':
        s = {'type': 'array', 'items': _column_schema(f.base_field)}
    elif isinstance(f, models.ForeignKey):
        s = _column_schema(f.target_field)
    else:
        s = {'type': 'string'}
    if f.null:
        s = {**s, 'type': [s['type'], 'null']} if isinstance(s.get('type'), str) else s
    return s


def table_schemas():
    from ejb.realtime import LIVE_TABLES
    from ejb.registry import column_fields, public_tables
    out = {}
    for table, model in sorted(public_tables().items()):
        cols = column_fields(model)
        out[f'table.{table}'] = {
            'type': 'object', 'title': table,
            'description': f'Row of `{table}`' + (' (live updates available)' if table in LIVE_TABLES else ''),
            'properties': {c: _column_schema(f) for c, f in cols.items()},
        }
    return out


def _body(schema, required=True):
    return {'required': required, 'content': {'application/json': {'schema': schema}}}


def _json(schema, description='OK'):
    return {'description': description, 'content': {'application/json': {'schema': schema}}}


SESSION = {'$ref': '#/components/schemas/Session'}
AUTH_ERR = {'$ref': '#/components/responses/AuthError'}


def static_paths():
    from ejb.realtime import LIVE_TABLES
    tables = sorted(t for t in table_schemas_names())
    return {
        '/auth/v1/signup': {'post': {
            'tags': ['Auth'], 'operationId': 'auth_signup', 'summary': 'Create an account (email + password)',
            'description': 'Sends a confirmation email unless AUTH_EMAIL_CONFIRM is off (then a session is returned). '
                           '`options.data` becomes the user metadata (first_name, last_name, age...).',
            'requestBody': _body({'type': 'object', 'required': ['email', 'password'], 'properties': {
                'email': {'type': 'string', 'format': 'email'}, 'password': {'type': 'string', 'minLength': 6},
                'options': {'type': 'object', 'properties': {
                    'data': {'type': 'object'}, 'emailRedirectTo': {'type': 'string', 'format': 'uri'}}}}}),
            'responses': {'200': _json({'type': 'object', 'properties': {
                'user': {'$ref': '#/components/schemas/User'}, 'session': {'oneOf': [SESSION, {'type': 'null'}]}}}),
                '400': AUTH_ERR, '422': AUTH_ERR, '429': AUTH_ERR}, 'security': [{}]}},
        '/auth/v1/token': {'post': {
            'tags': ['Auth'], 'operationId': 'auth_token', 'summary': 'Sign in, or refresh the session',
            'description': '`grant_type=password`: body {email, password}. `grant_type=refresh_token`: body '
                           '{refresh_token}; the refresh token is single-use (rotation) — store the new one.',
            'parameters': [{'name': 'grant_type', 'in': 'query', 'required': True,
                            'schema': {'type': 'string', 'enum': ['password', 'refresh_token']}}],
            'requestBody': _body({'type': 'object', 'properties': {
                'email': {'type': 'string'}, 'password': {'type': 'string'}, 'refresh_token': {'type': 'string'}}}),
            'responses': {'200': _json(SESSION), '400': AUTH_ERR, '429': AUTH_ERR}, 'security': [{}]}},
        '/auth/v1/logout': {'post': {
            'tags': ['Auth'], 'operationId': 'auth_logout', 'summary': 'Sign out everywhere (revokes refresh tokens)',
            'responses': {'200': _json({'type': 'object'}), '401': AUTH_ERR}}},
        '/auth/v1/user': {
            'get': {'tags': ['Auth'], 'operationId': 'auth_user', 'summary': 'The signed-in account',
                    'responses': {'200': _json({'$ref': '#/components/schemas/User'}), '401': AUTH_ERR, '403': AUTH_ERR}},
            'put': {'tags': ['Auth'], 'operationId': 'auth_update_user', 'summary': 'Change password and/or metadata',
                    'requestBody': _body({'type': 'object', 'properties': {
                        'password': {'type': 'string'}, 'data': {'type': 'object'}}}),
                    'responses': {'200': _json({'$ref': '#/components/schemas/User'}), '400': AUTH_ERR, '401': AUTH_ERR}}},
        '/auth/v1/recover': {'post': {
            'tags': ['Auth'], 'operationId': 'auth_recover', 'summary': 'Send a password-reset email',
            'description': 'Always answers 200 (does not reveal whether the email exists).',
            'requestBody': _body({'type': 'object', 'required': ['email'], 'properties': {
                'email': {'type': 'string'}, 'redirect_to': {'type': 'string', 'format': 'uri'}}}),
            'responses': {'200': _json({'type': 'object'}), '429': AUTH_ERR}, 'security': [{}]}},
        '/auth/v1/resend': {'post': {
            'tags': ['Auth'], 'operationId': 'auth_resend', 'summary': 'Resend the confirmation email',
            'requestBody': _body({'type': 'object', 'required': ['type', 'email'], 'properties': {
                'type': {'const': 'signup'}, 'email': {'type': 'string'},
                'options': {'type': 'object', 'properties': {'emailRedirectTo': {'type': 'string'}}}}}),
            'responses': {'200': _json({'type': 'object'}), '429': AUTH_ERR}, 'security': [{}]}},
        '/auth/v1/verify': {'get': {
            'tags': ['Auth'], 'operationId': 'auth_verify', 'summary': 'Email link target (confirmation / reset)',
            'description': 'Redirects (302) to the redirect URL with the session in the fragment: '
                           '`#access_token=…&refresh_token=…&expires_in=…&expires_at=…&token_type=bearer&type=signup|recovery`, '
                           'or `#error=…&error_code=…&error_description=…`.',
            'parameters': [{'name': 'token', 'in': 'query', 'required': True, 'schema': {'type': 'string'}},
                           {'name': 'type', 'in': 'query', 'required': True,
                            'schema': {'type': 'string', 'enum': ['signup', 'recovery']}}],
            'responses': {'302': {'description': 'Back to the app'}}, 'security': [{}]}},
        '/auth/v1/settings': {'get': {
            'tags': ['Auth'], 'operationId': 'auth_settings', 'summary': 'Which sign-in methods are enabled',
            'responses': {'200': _json({'type': 'object', 'properties': {
                'external': {'type': 'object', 'properties': {
                    'email': {'type': 'boolean'}, 'google': {'type': 'boolean'}, 'apple': {'type': 'boolean'}}},
                'mailer_autoconfirm': {'type': 'boolean'}}})}, 'security': [{}]}},
        '/auth/v1/authorize': {'get': {
            'tags': ['Auth'], 'operationId': 'auth_authorize', 'summary': 'Start Google / Apple sign-in (browser)',
            'description': 'Open in a browser / ASWebAuthenticationSession / Custom Tab. After the provider, '
                           '`/auth/v1/callback` redirects to `redirect_to` with the session in the fragment (as /verify). '
                           '`redirect_to` must start with an entry of AUTH_REDIRECT_ALLOWLIST, else SITE_URL is used.',
            'parameters': [{'name': 'provider', 'in': 'query', 'required': True,
                            'schema': {'type': 'string', 'enum': ['google', 'apple']}},
                           {'name': 'redirect_to', 'in': 'query', 'schema': {'type': 'string'}}],
            'responses': {'302': {'description': 'To the provider'}}, 'security': [{}]}},
        '/auth/v1/callback': {'get': {
            'tags': ['Auth'], 'operationId': 'auth_callback', 'summary': 'OAuth provider callback (GET/POST)',
            'responses': {'302': {'description': 'Back to redirect_to with the session or an error in the fragment'}},
            'security': [{}]}},
        '/rest/v1/query': {'post': {
            'tags': ['Tables'], 'operationId': 'table_query', 'summary': 'Read or change table rows',
            'description': (
                'PostgREST-style request as JSON. Row access is decided per user by the server (former RLS). '
                'Tables: ' + ', '.join(f'`{t}`' for t in tables) + '. Row shapes: components/schemas/table.*.\n\n'
                '`select` uses PostgREST syntax incl. embeds, e.g. `*, host:profiles!tables_host_id_fkey(id, first_name)`. '
                'Filter ops: eq, neq, gt, gte, lt, lte, like, ilike, is, in, cs, cd, ov (with `negate`), or '
                '`{"or": "status.eq.open,spots.gt.2"}` / `{"and": "..."}`.'),
            'requestBody': _body({'$ref': '#/components/schemas/Query'}),
            'responses': {'200': _json({'type': 'object', 'properties': {
                'data': {'description': 'rows (array), one row (single/maybeSingle) or null'},
                'count': {'type': ['integer', 'null']}}}),
                '400': {'$ref': '#/components/responses/DbError'}, '401': {'$ref': '#/components/responses/DbError'},
                '403': {'$ref': '#/components/responses/DbError'}, '404': {'$ref': '#/components/responses/DbError'},
                '406': {'$ref': '#/components/responses/DbError'}},
            'security': [{'bearer': []}, {}]}},
        '/storage/v1/object/{bucket}/{path}': {
            'post': {'tags': ['Storage'], 'operationId': 'storage_upload', 'summary': 'Upload a file (raw body)',
                     'description': 'Only into your own folder: `path` must start with your user id '
                                    '(e.g. `avatars/<uid>/avatar.jpg`). Bucket `avatars`: max 5 MB, image/jpeg|png|webp. '
                                    'Header `x-upsert: true` (or PUT) to replace.',
                     'parameters': [{'$ref': '#/components/parameters/bucket'}, {'$ref': '#/components/parameters/path'},
                                    {'name': 'x-upsert', 'in': 'header', 'schema': {'type': 'string', 'enum': ['true', 'false']}}],
                     'requestBody': {'required': True, 'content': {'image/jpeg': {}, 'image/png': {}, 'image/webp': {}}},
                     'responses': {'200': _json({'type': 'object', 'properties': {
                         'Key': {'type': 'string'}, 'path': {'type': 'string'}, 'id': {'type': 'string'},
                         'fullPath': {'type': 'string'}}}),
                         '403': {'$ref': '#/components/responses/StorageError'},
                         '409': {'$ref': '#/components/responses/StorageError'},
                         '413': {'$ref': '#/components/responses/StorageError'},
                         '415': {'$ref': '#/components/responses/StorageError'}}},
            'put': {'tags': ['Storage'], 'operationId': 'storage_upsert', 'summary': 'Upload or replace a file',
                    'parameters': [{'$ref': '#/components/parameters/bucket'}, {'$ref': '#/components/parameters/path'}],
                    'requestBody': {'required': True, 'content': {'image/jpeg': {}, 'image/png': {}, 'image/webp': {}}},
                    'responses': {'200': {'description': 'as POST'}}}},
        '/storage/v1/object/{bucket}': {'delete': {
            'tags': ['Storage'], 'operationId': 'storage_remove', 'summary': 'Delete your files',
            'parameters': [{'$ref': '#/components/parameters/bucket'}],
            'requestBody': _body({'type': 'object', 'properties': {'prefixes': {'type': 'array', 'items': {'type': 'string'}}}}),
            'responses': {'200': _json({'type': 'array', 'items': {'type': 'object', 'properties': {
                'name': {'type': 'string'}, 'bucket_id': {'type': 'string'}}}})}}},
        '/storage/v1/object/sign/{bucket}': {'post': {
            'tags': ['Storage'], 'operationId': 'storage_sign', 'summary': 'Signed (expiring) URLs for files',
            'description': 'Any signed-in user may read avatars through signed URLs. `expiresIn` seconds (max 7 days). '
                           'The URLs point at this API; with S3 storage they redirect to the object store.',
            'parameters': [{'$ref': '#/components/parameters/bucket'}],
            'requestBody': _body({'type': 'object', 'required': ['paths'], 'properties': {
                'paths': {'type': 'array', 'items': {'type': 'string'}}, 'expiresIn': {'type': 'integer', 'default': 3600}}}),
            'responses': {'200': _json({'type': 'array', 'items': {'type': 'object', 'properties': {
                'path': {'type': 'string'}, 'signedUrl': {'type': ['string', 'null']},
                'signedURL': {'type': ['string', 'null']}, 'error': {'type': ['string', 'null']}}}}),
                '401': {'$ref': '#/components/responses/StorageError'}}}},
        '/storage/v1/object/sign/{bucket}/{path}': {'get': {
            'tags': ['Storage'], 'operationId': 'storage_signed_get', 'summary': 'Download through a signed URL',
            'parameters': [{'$ref': '#/components/parameters/bucket'}, {'$ref': '#/components/parameters/path'},
                           {'name': 'token', 'in': 'query', 'required': True, 'schema': {'type': 'string'}}],
            'responses': {'200': {'description': 'The file'}, '302': {'description': 'Redirect to a presigned S3 URL'},
                          '400': {'$ref': '#/components/responses/StorageError'},
                          '404': {'$ref': '#/components/responses/StorageError'}},
            'security': [{}]}},
        '/functions/v1/check-email-domain': {'post': {
            'tags': ['Server functions'], 'operationId': 'fn_check_email_domain',
            'summary': 'Whether an email domain can receive mail (MX lookup)',
            'requestBody': _body({'type': 'object', 'required': ['email'], 'properties': {'email': {'type': 'string'}}}),
            'responses': {'200': _json({'type': 'object', 'properties': {
                'valid': {'type': 'boolean'}, 'domain': {'type': 'string'}, 'reason': {'type': 'string'},
                'checked': {'type': 'string'}}})}, 'security': [{}]}},
        '/realtime/v1/websocket': {'get': {
            'tags': ['Realtime'], 'operationId': 'realtime_websocket', 'summary': 'Live updates (WebSocket)',
            'description': (
                'Upgrade to a WebSocket at `wss://<api>/realtime/v1/websocket?token=<access_token>` (or send '
                '`{"type":"auth","token":…}` after connecting, and again after every token refresh). JSON messages:\n\n'
                '* client → `{"type":"subscribe","id":"s1","table":"tables","event":"*|INSERT|UPDATE|DELETE","filter":"city=eq.Pejë"}` '
                '(filter ops eq, neq, lt, lte, gt, gte, in; max 50 subscriptions)\n'
                '* server → `{"type":"subscribed","id":"s1"}` or `{"type":"error","id":"s1","message":"cannot subscribe"}`\n'
                '* server → `{"type":"change","id":"s1","payload":{"schema":"public","table":…,"eventType":"INSERT|UPDATE|DELETE",'
                '"new":{row},"old":{primary key},"commit_timestamp":…}}` — only rows you may read; a row that stops being '
                'visible to you arrives as DELETE\n'
                '* client → `{"type":"unsubscribe","id":"s1"}`, `{"type":"ping"}` → `{"type":"pong"}` (send every ~25 s)\n\n'
                'Live tables: ' + ', '.join(f'`{t}`' for t in sorted(LIVE_TABLES)) + '.'),
            'x-websocket': True,
            'parameters': [{'name': 'token', 'in': 'query', 'schema': {'type': 'string'}}],
            'responses': {'101': {'description': 'Switching protocols'}}, 'security': [{}]}},
    }


def table_schemas_names():
    from ejb.registry import public_tables
    return [t for t in public_tables()]


def components():
    return {
        'securitySchemes': {'bearer': {
            'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT',
            'description': 'access_token from /auth/v1/token (HS256, valid JWT_ACCESS_TTL seconds, default 1 h)'}},
        'parameters': {
            'bucket': {'name': 'bucket', 'in': 'path', 'required': True, 'schema': {'type': 'string', 'enum': ['avatars']}},
            'path': {'name': 'path', 'in': 'path', 'required': True, 'schema': {'type': 'string'},
                     'description': 'Object path, e.g. `<uid>/avatar.jpg`'},
        },
        'responses': {
            'AuthError': _json({'$ref': '#/components/schemas/AuthError'}, 'Error'),
            'DbError': _json({'$ref': '#/components/schemas/DbError'}, 'Error'),
            'StorageError': _json({'type': 'object', 'properties': {
                'statusCode': {'type': 'string'}, 'error': {'type': 'string'}, 'message': {'type': 'string'}}}, 'Error'),
        },
        'schemas': {
            'Session': {'type': 'object', 'required': ['access_token', 'refresh_token', 'expires_at'], 'properties': {
                'access_token': {'type': 'string'}, 'token_type': {'const': 'bearer'},
                'expires_in': {'type': 'integer'}, 'expires_at': {'type': 'integer', 'description': 'unix seconds'},
                'refresh_token': {'type': 'string'}, 'user': {'$ref': '#/components/schemas/User'}}},
            'User': {'type': 'object', 'properties': {
                'id': {'type': 'string', 'format': 'uuid'}, 'email': {'type': 'string'},
                'email_confirmed_at': {'type': ['string', 'null']}, 'user_metadata': {'type': 'object'},
                'app_metadata': {'type': 'object'}, 'identities': {'type': 'array', 'items': {'type': 'object'}},
                'created_at': {'type': 'string'}, 'last_sign_in_at': {'type': ['string', 'null']}}},
            'AuthError': {'type': 'object', 'properties': {
                'message': {'type': 'string'}, 'msg': {'type': 'string'},
                'code': {'type': ['string', 'null'], 'description': 'e.g. invalid_credentials, email_not_confirmed, '
                         'user_banned, refresh_token_not_found, user_already_exists, bad_jwt, over_request_rate_limit'},
                'error': {'type': 'string'}}},
            'DbError': {'type': 'object', 'properties': {
                'message': {'type': 'string', 'description': 'human readable (Albanian for business rules)'},
                'code': {'type': ['string', 'null'], 'description': 'Postgres / PostgREST code, e.g. P0001, 42501, PGRST202'},
                'details': {'type': ['string', 'null']}, 'hint': {'type': ['string', 'null']}}},
            'Filter': {'type': 'object', 'properties': {
                'col': {'type': 'string'},
                'op': {'type': 'string', 'enum': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov']},
                'value': {}, 'negate': {'type': 'boolean'}, 'or': {'type': 'string'}, 'and': {'type': 'string'}}},
            'Query': {'type': 'object', 'required': ['table'], 'properties': {
                'table': {'type': 'string', 'enum': sorted(table_schemas_names())},
                'action': {'type': 'string', 'enum': ['select', 'insert', 'upsert', 'update', 'delete'], 'default': 'select'},
                'select': {'type': 'string', 'default': '*'},
                'filters': {'type': 'array', 'items': {'$ref': '#/components/schemas/Filter'}},
                'order': {'type': 'array', 'items': {'type': 'object', 'properties': {
                    'col': {'type': 'string'}, 'ascending': {'type': 'boolean', 'default': True},
                    'nullsFirst': {'type': 'boolean'}}}},
                'limit': {'type': 'integer'}, 'offset': {'type': 'integer'},
                'single': {'type': 'boolean', 'description': 'exactly one row, else 406 PGRST116'},
                'maybeSingle': {'type': 'boolean'},
                'count': {'type': ['string', 'null'], 'enum': ['exact', 'planned', 'estimated', None]},
                'head': {'type': 'boolean'},
                'values': {'description': 'insert/upsert: row or rows; update: changed columns'},
                'onConflict': {'type': 'string', 'description': 'upsert: comma-separated conflict columns'},
                'ignoreDuplicates': {'type': 'boolean'},
                'returning': {'type': 'boolean', 'description': 'return the written rows (with `select`)'}}},
            **table_schemas(),
        },
    }


def build_spec():
    from ejb.rpc import REGISTRY
    paths = {**static_paths(), **rpc_operations()}
    return {
        'openapi': '3.1.0',
        'info': {
            'title': 'ejaBashkohu API',
            'version': '1.0',
            'description': ('API of the ejaBashkohu backend (Django), used by the web app and the mobile apps. '
                            'Send `Authorization: Bearer <access_token>` when signed in. Errors keep Supabase/PostgREST '
                            f'shapes. {len(REGISTRY)} server functions are generated from the code. '
                            'Guide: backend/API.md.'),
        },
        'servers': [{'url': settings.API_URL}],
        'tags': [{'name': n} for n in ('Auth', 'Tables', 'Storage', 'Realtime', 'Server functions', 'Functions: tables',
                                        'Functions: lessons', 'Functions: plans', 'Functions: Wednesday dinners',
                                        'Functions: basics', 'Functions: admin')],
        'security': [{'bearer': []}],
        'paths': paths,
        'components': components(),
    }
