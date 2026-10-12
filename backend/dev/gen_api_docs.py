"""Generate the API reference for the mobile team from the code.

    cd backend && MSGPACK_PUREPYTHON=1 python3 dev/gen_api_docs.py          # write files
    cd backend && MSGPACK_PUREPYTHON=1 python3 dev/gen_api_docs.py --check  # exit 1 if stale

Writes
  backend/openapi.yaml      OpenAPI 3.1 (core/openapi.build_spec(); same as GET /api/openapi.json)
  backend/API_REFERENCE.md  endpoint list, /rest/v1/query format, every server function
                            (/rest/v1/rpc/<name>, from ejb.rpc.REGISTRY + signatures + the
                            return statements in the code), storage, realtime protocol
                            (core/realtime.py), access rules per table (ejb/policies.RULES)
backend/API.md is the hand-written guide that explains how the pieces fit together.
core/tests/test_openapi.py fails when the generated files are out of date.
"""
import ast
import inspect
import os
import re
import sys
import textwrap
import typing
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ.setdefault('MSGPACK_PUREPYTHON', '1')

OPENAPI_FILE = BACKEND / 'openapi.yaml'
REFERENCE_FILE = BACKEND / 'API_REFERENCE.md'

AUTH_NOTES = {   # checked against core/views_auth.py and core/views_data.py
    'health': 'GET -> 200 "ok" (liveness)',
    'api/openapi.json': 'GET -> this API as OpenAPI 3.1 JSON',
    'api/docs': 'GET -> readable HTML reference',
    'auth/v1/signup': 'POST {email, password, data?, options:{emailRedirectTo?}} -> session, or user only '
                      'while the email is unconfirmed (confirmation email sent)',
    'auth/v1/token': 'POST ?grant_type=password {email, password} | ?grant_type=refresh_token {refresh_token} '
                     '-> {access_token, refresh_token, expires_in, expires_at, token_type, user}; '
                     'the refresh token rotates on every refresh',
    'auth/v1/logout': 'POST (Bearer) -> {} ; revokes all refresh tokens of the account',
    'auth/v1/user': 'GET (Bearer) -> user; PUT (Bearer) {password?, data?} -> updated user '
                    '(data is merged into user_metadata)',
    'auth/v1/recover': 'POST {email, redirect_to?} -> {} ; sends a password-reset link (same answer whether '
                       'or not the email exists); rate limited',
    'auth/v1/resend': 'POST {type: "signup", email, options:{emailRedirectTo?}} -> {} ; resends the confirmation',
    'auth/v1/verify': 'GET ?type=signup|recovery&token (the email links) -> 302 to the redirect URL with '
                      '#access_token=...&refresh_token=...&type=... or #error=...',
    'auth/v1/settings': 'GET -> {external: {email, google, apple}, mailer_autoconfirm}',
    'auth/v1/authorize': 'GET ?provider=google|apple&redirect_to -> 302 to the provider (PKCE)',
    'auth/v1/callback': 'GET|POST (from Google/Apple) -> 302 to redirect_to#access_token=...&refresh_token=... '
                        'or #error=...',
    'rest/v1/query': 'POST table query/mutation, see below',
    'rest/v1/rpc/<str:name>': 'POST server function, see below',
    'storage/v1/object/sign/<str:bucket>': 'POST signed URLs for several paths, see Storage',
    'storage/v1/object/sign/<str:bucket>/<path:path>': 'POST {expiresIn} signed URL for one path; GET ?token= serves the file',
    'storage/v1/object/<str:bucket>': 'DELETE {prefixes}',
    'storage/v1/object/<str:bucket>/<path:path>': 'POST upload (x-upsert: true to replace), PUT replace (Bearer)',
    'functions/v1/<str:name>': 'POST check-email-domain {email} -> {valid, domain?, reason?, checked?} (signup form; rate limited)',
}


def setup():
    import django
    django.setup()


# ───────────── helpers ─────────────

def type_name(ann):
    if ann is inspect.Parameter.empty or ann is None:
        return '—'
    if ann is type(None):
        return 'null'
    origin = typing.get_origin(ann)
    if origin is not None:
        args = ', '.join(type_name(a) for a in typing.get_args(ann))
        base = getattr(origin, '__name__', str(origin)).replace('UnionType', 'Union')
        return f'{base}[{args}]'
    return getattr(ann, '__name__', str(ann)).replace('UUID', 'uuid').replace('datetime', 'timestamp')


def _func_node(fn):
    try:
        src = textwrap.dedent(inspect.getsource(fn))
    except (OSError, TypeError):
        return None
    tree = ast.parse(src)
    return tree.body[0] if tree.body and isinstance(tree.body[0], (ast.FunctionDef, ast.AsyncFunctionDef)) else None


def _returns(node):
    """Return statements of the function itself (not of nested functions)."""
    out = []

    def visit(n):
        for child in ast.iter_child_nodes(n):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            if isinstance(child, ast.Return):
                out.append(child.value)
            visit(child)
    visit(node)
    return out


def _shape(expr):
    if expr is None:
        return 'null'
    if isinstance(expr, ast.Constant):
        return 'null' if expr.value is None else repr(expr.value)
    if isinstance(expr, ast.Dict):
        keys = [k.value if isinstance(k, ast.Constant) else f'**{ast.unparse(v)}' for k, v in zip(expr.keys, expr.values)]
        return 'object {' + ', '.join(str(k) for k in keys) + '}'
    if isinstance(expr, (ast.ListComp, ast.List)):
        elt = expr.elt if isinstance(expr, ast.ListComp) else (expr.elts[0] if expr.elts else None)
        return 'array of ' + (_shape(elt) if elt is not None else 'items')
    code = ast.unparse(expr)
    return f'`{code if len(code) <= 110 else code[:107] + "..."}`'


def result_description(spec):
    hints = typing.get_type_hints(spec.fn)
    ann = type_name(hints['return']) if 'return' in hints else None
    node = _func_node(spec.fn)
    shapes = []
    if node is not None:
        for r in _returns(node):
            s = _shape(r)
            if s not in shapes:
                shapes.append(s)
    if not shapes:
        shapes = ['null']
    parts = []
    if ann:
        parts.append(f'**{ann}**')
    parts.append(' / '.join(shapes[:4]) + (' / ...' if len(shapes) > 4 else ''))
    return ' — '.join(parts)


def md_escape(s):
    return str(s).replace('|', '\\|').replace('\n', ' ')


# ───────────── sections ─────────────

def section_endpoints():
    from config.urls import urlpatterns
    lines = ['## Endpoints', '', '| Path | Notes |', '|---|---|']
    for p in urlpatterns:
        route = str(p.pattern)
        if route.startswith('^django-admin') or route.startswith('django-admin'):
            continue
        lines.append(f'| `/{route}` | {md_escape(AUTH_NOTES.get(route, ""))} |')
    lines += ['', 'The Django admin (`/django-admin/`) is for staff only and not part of the app API.', '']
    return lines


def section_query():
    from ejb import query
    ops = []
    for op in re.findall(r"'([a-z]+)'", inspect.getsource(query._cond)):
        if op not in ops and op not in ('null', 'true', 'false', 'unknown', 'contains', 'contained_by',
                                        'overlap', 'regex', 'iregex'):
            ops.append(op)
    run_src = inspect.getsource(query.run) + inspect.getsource(query)
    keys = sorted(set(re.findall(r"req(?:\.get\(|\[)'([A-Za-z]+)'", run_src)))
    return [
        '## Table queries: `POST /rest/v1/query`', '',
        'Body (JSON): `{"table", "action", ...}`. Keys read by the server (ejb/query.py): '
        + ', '.join(f'`{k}`' for k in keys) + '.', '',
        f'- `action`: {", ".join(sorted(query.ACTIONS))} (default select)',
        '- `select`: PostgREST select string: `*`, `col`, `alias:col`, embeds '
        '`alias:other_table!fk_name(cols)`; `!inner` keeps only rows whose embed matches',
        '- `filters`: list of `{"col", "op", "value", "negate"?}`, or `{"or": "a.eq.1,b.gt.2"}` / '
        '`{"and": "..."}` (PostgREST logic syntax, nested `and(...)`/`or(...)`, `not.` prefix)',
        f'- operators: {", ".join(ops)} (`like`/`ilike` use `*` or `%` as wildcard; `is` takes null/true/false; '
        '`in` takes a list or `(a,b)`; `cs`/`cd`/`ov` on arrays and JSON)',
        '- `order`: list of `{"col", "ascending"?: true, "nullsFirst"?}`; paging: `limit`, `offset`',
        '- `count`: "exact" -> total in `count`; `head: true` -> only the count',
        '- `single: true` -> one object (406 `PGRST116` unless exactly one row); `maybeSingle: true` -> object or null',
        '- mutations: `values` (object or list; insert/upsert), `onConflict` ("col1,col2"), `ignoreDuplicates`, '
        '`returning: true` to get the rows back; update/delete need filters and only touch rows the access rules allow',
        '- response: `{"data": [...] | {...} | null, "count": n | null}`',
        '- errors: HTTP 4xx `{"message", "code", "details", "hint"}` with Postgres/PostgREST codes '
        '(`42501` / `new row violates row-level security policy`, `42P01` unknown table, `42703` unknown column, '
        '`PGRST100` bad filter, `PGRST116` single row, `23505` duplicate, `P0001` business rule)', '',
    ]


def section_rpc():
    from ejb.rpc import REGISTRY
    try:
        from core.openapi import SUMMARIES
    except ImportError:
        SUMMARIES = {}
    lines = ['## Server functions: `POST /rest/v1/rpc/<name>`', '',
             f'{len(REGISTRY)} functions (ejb.rpc.REGISTRY). Body: JSON object with the named arguments; '
             'response `{"data": <result>}`. "signed out" = callable without a token. Results are taken from '
             'the return annotation and the `return` statements in the code (uuid/timestamps as strings).', '']
    for name in sorted(REGISTRY):
        spec = REGISTRY[name]
        sig = inspect.signature(spec.fn)
        args = []
        for pname, ann, has_default in spec.params:
            a = f'`{pname}`: {type_name(ann)}'
            if has_default:
                d = sig.parameters[pname].default
                a += f' = {d!r}' if d is not None else ' (optional)'
            args.append(a)
        flags = []
        if spec.anon:
            flags.append('signed out ok')
        if name.startswith('admin_'):
            flags.append('admins only')
        doc = SUMMARIES.get(name) or (inspect.getdoc(spec.fn) or '').split('\n\n')[0]
        mod = spec.fn.__module__
        lines.append(f'### `{name}`' + (f'  ({", ".join(flags)})' if flags else ''))
        lines.append('')
        if doc:
            lines.append(md_escape(doc))
            lines.append('')
        lines.append('- args: ' + (', '.join(args) if args else 'none'))
        lines.append('- result: ' + result_description(spec))
        lines.append(f'- code: `{mod}.{spec.fn.__name__}`')
        lines.append('')
    return lines


def section_storage():
    from django.conf import settings
    lines = ['## Storage: `/storage/v1`', '',
             '| Method + path | Body | Result |', '|---|---|---|',
             '| `POST /storage/v1/object/<bucket>/<uid>/<file>` (header `x-upsert: true` to replace; '
             '`PUT` = replace) | raw file, `Content-Type` | `{Key, path, id, fullPath}` |',
             '| `POST /storage/v1/object/sign/<bucket>/<path>` | `{expiresIn}` | same list, one entry |',
             '| `POST /storage/v1/object/sign/<bucket>` | `{paths: [...], expiresIn}` | '
             '`[{path, signedURL, signedUrl, error}]` |',
             '| `GET <signedURL>` | — | the file (no Authorization header; may be an object-store URL) |',
             '| `DELETE /storage/v1/object/<bucket>` | `{prefixes: [...]}` | `[{name, bucket_id}]` removed |', '',
             'Rules: signed in; writes and deletes only inside your own folder `<your uid>/`; any signed-in '
             'user may get signed URLs (max 7 days). Images are compressed by the client before upload.', '']
    for b, cfg in settings.STORAGE_BUCKETS.items():
        size = cfg.get('max_bytes') or cfg.get('file_size_limit')
        lines.append(f'- bucket `{b}`: public={cfg.get("public")}, max size={size} bytes, '
                     f'types={", ".join(cfg.get("mime_types") or ["any"])}')
    lines.append('')
    return lines


def section_realtime():
    from core import realtime
    from ejb.realtime import LIVE_TABLES
    doc = inspect.getdoc(realtime) or ''
    return ['## Realtime websocket', '',
            'Connect to `wss://<api host>/realtime/v1/websocket` (`ws://` locally). From core/realtime.py:', '',
            '```', doc, '```', '',
            f'- tables with live events: {", ".join(f"`{t}`" for t in sorted(LIVE_TABLES))}',
            f'- at most {realtime.MAX_SUBSCRIPTIONS} subscriptions per connection; '
            f'filter ops: {realtime.match_filter.__doc__.split("(")[1].split(")")[0]}',
            '- send `auth` again with the new access token after a refresh', '']


def _rule_text(node):
    if node is None:
        return 'nobody'
    if isinstance(node, ast.Name):
        return {'everyone': 'everyone (signed in)', 'admin_only': 'admins only'}.get(
            node.id, f'custom rule `{node.id}`')
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        col = node.args[0].value if node.args else 'user_id'
        if node.func.id == 'own':
            return f'own rows (`{col}` = me)'
        if node.func.id == 'own_or_admin':
            return f'own rows (`{col}` = me); admins: all'
    code = ast.unparse(node)
    if code.startswith('lambda a, o: ') or code.startswith('lambda a: '):
        code = code.split(': ', 1)[1]
    code = code.replace('a.uid', 'me').replace('(a)', '(me)')
    return f'`{code if len(code) <= 140 else code[:137] + "..."}`'


def section_policies():
    from ejb import policies
    tree = ast.parse(inspect.getsource(policies))
    rules = {}
    for n in tree.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'RULES' for t in n.targets):
            for k, v in zip(n.value.keys, n.value.values):
                rules[k.value] = {kw.arg: kw.value for kw in v.keywords}
    assert set(rules) == set(policies.RULES), 'RULES parse mismatch'
    lines = ['## Access rules per table (`/rest/v1/query`, realtime)', '',
             'From ejb/policies.py (the former row-level security). Everything requires a signed-in user; '
             'what is not listed is refused. Server functions do their own checks. `me` = the signed-in user.', '',
             '| Table | select | insert | update (rows / new values) | delete |', '|---|---|---|---|---|']
    for t in sorted(rules):
        r = rules[t]
        upd = _rule_text(r.get('update'))
        if r.get('update') is not None:
            upd += ' / ' + _rule_text(r.get('update_check'))
        lines.append(f'| `{t}` | {md_escape(_rule_text(r.get("select")))} | {md_escape(_rule_text(r.get("insert")))} '
                     f'| {md_escape(upd)} | {md_escape(_rule_text(r.get("delete")))} |')
    custom = sorted({n.id for r in rules.values() for n in r.values()
                     if isinstance(n, ast.Name) and n.id.startswith('_')})
    lines += ['', 'Custom rules (source, `a` = the signed-in user, `a.uid` = me):', '']
    for name in custom:
        lines += ['```python', textwrap.dedent(inspect.getsource(getattr(policies, name))).rstrip(), '```', '']
    lines.append('Tables without an entry (e.g. `lesson_rooms`, `jobs`, `auth_tokens`, `storage_objects`) '
                 'are not readable or writable through `/rest/v1/query`.')
    lines.append('')
    return lines


def build_reference():
    out = ['# ejaBashkohu API reference (generated)', '',
           '<!-- generated by backend/dev/gen_api_docs.py from the code; do not edit by hand -->', '',
           'Hand-written guide: [API.md](API.md). Machine-readable: [openapi.yaml](openapi.yaml) '
           '(also served at `/api/openapi.json`, readable at `/api/docs`).', '']
    for sec in (section_endpoints, section_query, section_rpc, section_storage, section_realtime, section_policies):
        out += sec()
    return '\n'.join(out).rstrip() + '\n'


def build_openapi():
    import yaml
    from core.openapi import build_spec
    head = '# OpenAPI 3.1, generated by backend/dev/gen_api_docs.py (do not edit by hand)\n'
    return head + yaml.safe_dump(build_spec(), sort_keys=False, allow_unicode=True, width=100)


def outputs():
    setup()
    return {OPENAPI_FILE: build_openapi(), REFERENCE_FILE: build_reference()}


def main(argv):
    check = '--check' in argv
    stale = []
    for path, text in outputs().items():
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(path.name)
        else:
            path.write_text(text)
            print(f'wrote {path.relative_to(BACKEND)} ({len(text.splitlines())} lines)')
    if stale:
        print('out of date: ' + ', '.join(stale) + ' (run: python3 dev/gen_api_docs.py)')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
