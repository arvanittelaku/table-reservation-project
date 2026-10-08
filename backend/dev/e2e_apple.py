"""Sign in with Apple, end to end against a fake Apple provider.

    python3 backend/dev/e2e_apple.py

Starts a fake Apple server (authorize / token / JWKS, RS256 id_tokens) on :8766
and a SECOND backend on :8001 (same DB ejb_dev) with APPLE_* pointing at it, so
the main backend on :8000 is not touched. Checks: the Apple button is advertised
only when Apple is configured, account creation with the Apple identity, name
taken from the posted `user` JSON, onboarding still required, second sign-in
reuses the account, an existing verified email gets linked, a forged id_token
(wrong key) is rejected.
"""
import base64
import json
import os
import signal
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import jwt
import psycopg
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

BACKEND_DIR = Path(__file__).resolve().parent.parent
MAIN = 'http://localhost:8000'
API = 'http://localhost:8001'
FAKE = 'http://127.0.0.1:8766'
SITE = 'http://localhost:5173'
DB = "host=/tmp port=54329 user=postgres dbname=ejb_dev"
CLIENT_ID = 'com.ejabashkohu.test'
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''))


def db(sql, params=None):
    with psycopg.connect(DB, autocommit=True) as c:
        cur = c.execute(sql, params or [])
        try:
            return cur.fetchall()
        except psycopg.ProgrammingError:
            return []


RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
EVIL_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = 'fake-apple-kid'
ES_KEY = ec.generate_private_key(ec.SECP256R1()).private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def _b64(n):
    return base64.urlsafe_b64encode(n.to_bytes((n.bit_length() + 7) // 8, 'big')).rstrip(b'=').decode()


# what the next token exchange returns: {code: {sub, email, email_verified, evil}}
CODES = {}
SEEN = {'secrets': []}


class FakeApple(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/auth/keys':
            pub = RSA_KEY.public_key().public_numbers()
            self._json(200, {'keys': [{'kty': 'RSA', 'kid': KID, 'use': 'sig', 'alg': 'RS256',
                                       'n': _b64(pub.n), 'e': _b64(pub.e)}]})
        elif u.path == '/auth/authorize':
            self._json(200, dict((k, v[0]) for k, v in parse_qs(u.query).items()))
        else:
            self._json(404, {})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        form = {k: v[0] for k, v in parse_qs(self.rfile.read(n).decode()).items()}
        spec = CODES.get(form.get('code'))
        if not spec or form.get('client_id') != CLIENT_ID:
            return self._json(400, {'error': 'invalid_grant'})
        SEEN['secrets'].append(form.get('client_secret'))
        now = int(time.time())
        claims = {'iss': 'https://appleid.apple.com', 'aud': CLIENT_ID, 'iat': now, 'exp': now + 600,
                  'sub': spec['sub'], 'email': spec['email'], 'email_verified': spec.get('email_verified', 'true')}
        key = EVIL_KEY if spec.get('evil') else RSA_KEY
        tok = jwt.encode(claims, key, algorithm='RS256', headers={'kid': KID})
        self._json(200, {'access_token': 'a', 'token_type': 'Bearer', 'id_token': tok})


def start_backend():
    env = {**os.environ, 'MSGPACK_PUREPYTHON': '1', 'DB_NAME': 'ejb_dev', 'API_URL': API,
           'APPLE_CLIENT_ID': CLIENT_ID, 'APPLE_TEAM_ID': 'TEAM123', 'APPLE_KEY_ID': 'KEY123',
           'APPLE_PRIVATE_KEY': ES_KEY, 'APPLE_AUTHORIZE_URL': FAKE + '/auth/authorize',
           'APPLE_TOKEN_URL': FAKE + '/auth/token', 'APPLE_JWKS_URL': FAKE + '/auth/keys'}
    log = open(BACKEND_DIR / 'var' / 'server_apple.log', 'w')
    proc = subprocess.Popen(['python3', 'manage.py', 'serve', '--port', '8001'], cwd=BACKEND_DIR, env=env,
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        try:
            if requests.get(API + '/health', timeout=1).ok:
                break
        except requests.RequestException:
            pass
        time.sleep(0.3)
    return proc


def apple_sign_in(sub, email, user_json=None, evil=False, verified='true'):
    """authorize -> (Apple) -> form_post callback. Returns the final redirect fragment as a dict."""
    r = requests.get(API + '/auth/v1/authorize', params={'provider': 'apple', 'redirect_to': SITE + '/'},
                     allow_redirects=False, timeout=10)
    loc = r.headers.get('Location', '')
    q = parse_qs(urlparse(loc).query)
    code = 'code-' + uuid.uuid4().hex
    CODES[code] = {'sub': sub, 'email': email, 'evil': evil, 'email_verified': verified}
    form = {'state': q['state'][0], 'code': code}
    if user_json:
        form['user'] = json.dumps(user_json)
    cb = requests.post(q['redirect_uri'][0], data=form, allow_redirects=False, timeout=15)
    frag = cb.headers.get('Location', '').split('#', 1)[-1]
    return loc, q, {k: v[0] for k, v in parse_qs(frag).items()}


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', 8766), FakeApple)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    main_settings = requests.get(MAIN + '/auth/v1/settings', timeout=5).json()
    check('main backend (Apple not configured) reports apple=false (button hidden)',
          main_settings['external'].get('apple') is False, main_settings)
    proc = start_backend()
    try:
        s = requests.get(API + '/auth/v1/settings', timeout=5).json()
        check('backend with APPLE_* configured reports apple=true (button shown)', s['external'].get('apple') is True, s)

        stamp = int(time.time() * 1000)
        sub = f'apple-sub-{stamp}'
        email = f'apple.{stamp}@privaterelay.appleid.com'
        loc, q, frag = apple_sign_in(sub, email, {'name': {'firstName': 'Drita', 'lastName': 'Berisha'}, 'email': email})
        check('authorize redirects to Apple with form_post + client id + callback',
              loc.startswith(FAKE + '/auth/authorize') and q.get('response_mode') == ['form_post']
              and q.get('client_id') == [CLIENT_ID] and q.get('redirect_uri') == [API + '/auth/v1/callback'], loc)
        cs = SEEN['secrets'][-1] if SEEN['secrets'] else ''
        hdr = jwt.get_unverified_header(cs) if cs else {}
        body = jwt.decode(cs, options={'verify_signature': False}) if cs else {}
        check('client_secret is an ES256 JWT signed with the team/key id',
              hdr.get('alg') == 'ES256' and hdr.get('kid') == 'KEY123' and body.get('iss') == 'TEAM123'
              and body.get('sub') == CLIENT_ID, (hdr, body))
        check('callback returns a session to the app', 'access_token' in frag and 'refresh_token' in frag, frag)
        rows = db("select u.id, u.raw_app_meta_data->>'provider', i.provider, p.first_name, p.last_name, p.onboarded_at "
                  "from auth.users u join auth.identities i on i.user_id=u.id join profiles p on p.id=u.id "
                  "where i.provider='apple' and i.provider_id=%s", [sub])
        check('account created with an Apple identity', len(rows) == 1 and rows[0][2] == 'apple', rows)
        uid = str(rows[0][0]) if rows else None
        check('name taken from the posted user JSON', rows and rows[0][3] == 'Drita' and rows[0][4] == 'Berisha', rows)
        check('onboarding still required (onboarded_at null)', rows and rows[0][5] is None, rows)
        if frag.get('access_token'):
            me = requests.post(API + '/rest/v1/query', json={'table': 'profiles', 'select': 'onboarded_at,age,photo_path',
                               'filters': [{'col': 'id', 'op': 'eq', 'value': uid}]},
                               headers={'Authorization': 'Bearer ' + frag['access_token']}, timeout=10)
            prof = (me.json().get('data') or [{}])[0] if me.ok else {}
            check('app sees an un-onboarded profile (no photo) -> onboarding steps shown',
                  prof and not prof.get('onboarded_at') and not prof.get('photo_path'), me.text[:200])

        # second sign-in: Apple sends no name any more
        _, _, frag2 = apple_sign_in(sub, email)
        n = db("select count(*) from auth.users u join auth.identities i on i.user_id=u.id where i.provider_id=%s", [sub])[0][0]
        check('second sign-in returns a session', 'access_token' in frag2, frag2)
        uid2 = jwt.decode(frag2.get('access_token', ''), options={'verify_signature': False}).get('sub') if frag2.get('access_token') else None
        check('second sign-in reuses the same account', n == 1 and uid2 == uid, (n, uid2, uid))
        check('name kept although Apple did not resend it',
              db('select first_name from profiles where id=%s', [uid])[0][0] == 'Drita')

        # existing verified email account gets linked
        em2 = f'linked.{stamp}@gmail.com'
        r = requests.post(API + '/auth/v1/signup', json={'email': em2, 'password': 'Secret123!', 'options': {'data': {'first_name': 'Lina'}}}, timeout=10)
        db('update auth.users set email_confirmed_at=now() where email=%s', [em2])
        existing = db('select id from auth.users where email=%s', [em2])
        _, _, frag3 = apple_sign_in(f'apple-link-{stamp}', em2, {'name': {'firstName': 'X', 'lastName': 'Y'}})
        uid3 = jwt.decode(frag3.get('access_token', ''), options={'verify_signature': False}).get('sub') if frag3.get('access_token') else None
        check('existing verified email account is linked (same user id)', existing and uid3 == str(existing[0][0]), (r.status_code, existing, uid3))
        provs = db("select provider from auth.identities where user_id=%s order by provider", [existing[0][0]]) if existing else []
        check('linked account has both email and apple identities', [p[0] for p in provs] == ['apple', 'email'], provs)
        check('linked account keeps its own name', db('select first_name from profiles where id=%s', [existing[0][0]])[0][0] == 'Lina')

        # unverified email must NOT be linked to an existing account
        _, _, frag4 = apple_sign_in(f'apple-unv-{stamp}', em2, verified='false')
        uid4 = jwt.decode(frag4.get('access_token', ''), options={'verify_signature': False}).get('sub') if frag4.get('access_token') else None
        check('unverified Apple email is not linked to the existing account', uid4 and uid4 != uid3, (uid4, uid3, frag4))
        check('no second account with the same email is created', db('select count(*) from auth.users where email=%s', [em2])[0][0] == 1)

        # forged token
        _, _, frag5 = apple_sign_in(f'apple-evil-{stamp}', f'evil.{stamp}@x.com', evil=True)
        check('id_token signed with a foreign key is rejected', frag5.get('error') == 'server_error' and 'access_token' not in frag5, frag5)
        check('no account created for forged token', db("select count(*) from auth.identities where provider_id=%s", [f'apple-evil-{stamp}'])[0][0] == 0)

        # cancelled
        r = requests.get(API + '/auth/v1/authorize', params={'provider': 'apple', 'redirect_to': SITE + '/'}, allow_redirects=False)
        st = parse_qs(urlparse(r.headers['Location']).query)['state'][0]
        cb = requests.post(API + '/auth/v1/callback', data={'state': st, 'error': 'user_cancelled_authorize'}, allow_redirects=False)
        check('cancel at Apple returns access_denied to the app', 'error=access_denied' in cb.headers.get('Location', ''), cb.headers.get('Location'))
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
