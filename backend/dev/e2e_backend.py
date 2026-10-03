"""End-to-end checks of the Django backend against a running server + dev DB.

    backend/dev/rebuild_db.sh && backend/dev/serve.sh && python3 backend/dev/e2e_backend.py

Needs EMAIL_BACKEND=filebased (emails are read from var/mail) and, for the
Google test, GOOGLE_* URLs pointing at the fake provider this script starts.
"""
import glob
import json
import os
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import psycopg
import requests

API = os.environ.get('API', 'http://localhost:8000')
SITE = os.environ.get('SITE', 'http://localhost:5173')
MAIL_DIR = Path(__file__).resolve().parent.parent / 'var' / 'mail'
DB = os.environ.get('DSN', "host=/tmp port=54329 user=postgres dbname=ejb_dev")
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''))


def db(sql, params=None):
    with psycopg.connect(DB, autocommit=True) as c:
        cur = c.execute(sql, params or [])
        try:
            return cur.fetchall()
        except psycopg.ProgrammingError:
            return []


def post(path, body=None, token=None, **kw):
    h = {'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    return requests.post(API + path, data=json.dumps(body or {}), headers=h, allow_redirects=False, timeout=15, **kw)


def wait_for_mail(to, after, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        for f in sorted(glob.glob(str(MAIL_DIR / '*.log')), key=os.path.getmtime):
            if os.path.getmtime(f) < after:
                continue
            text = Path(f).read_text(errors='ignore')
            if f'To: {to}' in text:
                return text
        time.sleep(0.3)
    return ''


def link_in(mail):
    m = re.search(r'(http://\S+/auth/v1/verify\?token=[\w\-]+&type=\w+)', mail)
    return m.group(1) if m else None


def frag(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).fragment).items()}


def rpc(name, args, token=None):
    return post(f'/rest/v1/rpc/{name}', args, token)


def q(req, token=None):
    return post('/rest/v1/query', req, token)


def main():
    MAIL_DIR.mkdir(parents=True, exist_ok=True)
    email = f'e2e.{uuid.uuid4().hex[:8]}@gmail.com'

    # ── sign-up + confirmation email ──
    t0 = time.time()
    r = post('/auth/v1/signup', {'email': email, 'password': 'Secret123!',
                                 'options': {'emailRedirectTo': SITE, 'data': {'first_name': 'Teuta', 'last_name': 'Berisha', 'age': 27}}})
    body = r.json()
    check('signup returns user without session (email confirmation on)', r.ok and body['user']['email'] == email and body['session'] is None, r.text[:200])
    uid = body['user']['id']
    check('profile created by the database trigger from signup metadata',
          db('select first_name, last_name, age from profiles where id = %s', [uid]) == [('Teuta', 'Berisha', 27)])
    check('password stored as bcrypt ($2a$10$)', db('select left(encrypted_password, 7) from auth.users where id=%s', [uid]) == [('$2a$10$',)])
    r = post('/auth/v1/signup', {'email': email.upper(), 'password': 'Secret123!'})
    check('duplicate signup refused ("User already registered")', r.status_code == 422 and r.json()['message'] == 'User already registered')
    r = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'Secret123!'})
    check('login before confirming -> "Email not confirmed"', r.status_code == 400 and r.json()['message'] == 'Email not confirmed')
    mail = wait_for_mail(email, t0)
    link = link_in(mail)
    check('confirmation email sent with a verify link', bool(link), mail[:300])
    r = requests.get(link, allow_redirects=False, timeout=10)
    f = frag(r.headers.get('Location', ''))
    check('verify link redirects to the app with a session (type=signup)',
          r.status_code == 302 and r.headers['Location'].startswith(SITE) and f.get('type') == 'signup' and f.get('access_token'))
    r = requests.get(link, allow_redirects=False, timeout=10)
    check('used link -> #error_code=otp_expired', 'error_code=otp_expired' in r.headers.get('Location', ''))

    # ── login / refresh / logout ──
    r = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'wrong-pass'})
    check('wrong password -> "Invalid login credentials"', r.status_code == 400 and r.json()['message'] == 'Invalid login credentials')
    s = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'Secret123!'}).json()
    check('login returns access + refresh token and user', s.get('access_token') and s.get('refresh_token') and s['user']['id'] == uid)
    me = requests.get(API + '/auth/v1/user', headers={'Authorization': f"Bearer {s['access_token']}"}).json()
    check('GET /user returns the account with metadata', me['email'] == email and me['user_metadata']['first_name'] == 'Teuta')
    s2 = post('/auth/v1/token?grant_type=refresh_token', {'refresh_token': s['refresh_token']}).json()
    check('refresh token rotates', s2.get('refresh_token') and s2['refresh_token'] != s['refresh_token'])
    r = post('/auth/v1/token?grant_type=refresh_token', {'refresh_token': s['refresh_token']})
    check('old refresh token no longer works', r.status_code == 400)
    r = requests.put(API + '/auth/v1/user', data=json.dumps({'data': {'first_name': 'Teuta2'}}),
                     headers={'Authorization': f"Bearer {s2['access_token']}", 'Content-Type': 'application/json'})
    check('updateUser merges metadata', r.ok and r.json()['user_metadata']['first_name'] == 'Teuta2' and r.json()['user_metadata']['age'] == 27)
    post('/auth/v1/logout', {}, s2['access_token'])
    r = post('/auth/v1/token?grant_type=refresh_token', {'refresh_token': s2['refresh_token']})
    check('logout revokes refresh tokens', r.status_code == 400)

    # ── password reset ──
    t1 = time.time()
    r = post('/auth/v1/recover', {'email': email, 'redirect_to': SITE})
    check('recover answers 200', r.ok)
    r2 = post('/auth/v1/recover', {'email': 'nobody-' + email, 'redirect_to': SITE})
    check('recover gives the same answer for unknown emails (no account probing)', r2.ok and r2.text == r.text)
    mail = wait_for_mail(email, t1)
    link = link_in(mail)
    check('reset email sent', bool(link and 'type=recovery' in link))
    r = requests.get(link, allow_redirects=False, timeout=10)
    f = frag(r.headers.get('Location', ''))
    check('reset link -> app with session, type=recovery', f.get('type') == 'recovery' and f.get('access_token'))
    r = requests.put(API + '/auth/v1/user', data=json.dumps({'password': 'NewSecret456!'}),
                     headers={'Authorization': f"Bearer {f['access_token']}", 'Content-Type': 'application/json'})
    check('new password saved', r.ok)
    r = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'NewSecret456!'})
    check('login with the new password works', r.ok)
    r = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'Secret123!'})
    check('old password rejected', r.status_code == 400)
    token = post('/auth/v1/token?grant_type=password', {'email': email, 'password': 'NewSecret456!'}).json()['access_token']

    # ── existing (Supabase-era) account keeps its password ──
    r = post('/auth/v1/token?grant_type=password', {'email': 'support@ejabashkohu.com', 'password': 'Test1234!'})
    check('existing account signs in with its existing bcrypt hash', r.ok)
    admin_token = r.json()['access_token']

    # ── data API runs as the user (row rules apply) ──
    r = q({'table': 'notifications', 'select': 'id, user_id'}, token)
    check('user reads only own notifications', r.ok and all(n['user_id'] == uid for n in r.json()['data']))
    r = q({'table': 'profiles', 'action': 'update', 'values': {'first_name': 'Hacked'},
           'filters': [{'col': 'id', 'op': 'neq', 'value': uid}], 'returning': True}, token)
    check("user cannot update someone else's profile (0 rows)", r.ok and r.json()['data'] == [])
    r = q({'table': 'profiles', 'action': 'delete', 'filters': []}, token)
    check('unfiltered DELETE refused', r.status_code == 400 and 'WHERE' in r.json()['message'])
    r = rpc('admin_get_dashboard', {'p_range': 'day'}, token)
    check('non-admin refused by admin function', r.status_code in (400, 403) and 'adminët' in r.json()['message'])
    r = rpc('admin_get_dashboard', {'p_range': 'day'}, admin_token)
    check('admin function works for the admin', r.ok and r.json()['data']['range'] == 'day')
    r = rpc('admin_get_dashboard', {'p_range': 'day'})
    check('anonymous call refused (401)', r.status_code == 401)
    r = rpc('complete_onboarding', {'p_first_name': 'Teuta', 'p_last_name': 'Berisha', 'p_age': 15}, token)
    check('database validation message comes through (age 18+)', r.status_code == 400 and '18' in r.json()['message'])
    r = q({'table': 'tables', 'select': '*', 'filters': [{'or': 'city.eq.Prishtinë,city.eq.Prizren'}], 'limit': 3}, admin_token)
    check('or-filter + limit', r.ok and len(r.json()['data']) <= 3)
    r = q({'table': 'tables', 'select': 'id', 'filters': [{'col': 'id', 'op': 'eq', 'value': str(uuid.uuid4())}], 'single': True}, admin_token)
    check('single() with no row -> PGRST116 / 406', r.status_code == 406 and r.json()['code'] == 'PGRST116')
    r = q({'table': 'tables', 'select': 'id; drop table x', 'limit': 1}, admin_token)
    check('malformed select rejected safely', r.status_code == 400)

    # ── storage: own folder only, signed URLs ──
    jpg = b'\xff\xd8\xff\xe0' + b'0' * 2000
    r = requests.post(f'{API}/storage/v1/object/avatars/{uid}/avatar.jpg', data=jpg,
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    check('upload into own folder', r.ok, r.text[:200])
    other = db("select id from profiles where id <> %s limit 1", [uid])[0][0]
    r = requests.post(f'{API}/storage/v1/object/avatars/{other}/avatar.jpg', data=jpg,
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    check("upload into someone else's folder refused (403)", r.status_code == 403)
    r = requests.post(f'{API}/storage/v1/object/avatars/{uid}/avatar.jpg', data=b'x' * (6 * 1024 * 1024),
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    check('file over 5 MB refused', r.status_code in (400, 413))
    r = requests.post(f'{API}/storage/v1/object/avatars/{uid}/x.heic', data=jpg,
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'image/heic', 'x-upsert': 'true'})
    check('unsupported image type refused', r.status_code == 415)
    r = post('/storage/v1/object/sign/avatars', {'paths': [f'{uid}/avatar.jpg', 'missing/x.jpg'], 'expiresIn': 60}, admin_token)
    signed = r.json()
    check('batch signed URLs (existing + missing)', r.ok and signed[0]['signedUrl'] and signed[1]['error'])
    got = requests.get(signed[0]['signedUrl'])
    check('signed URL serves the file', got.ok and got.content == jpg and got.headers['Content-Type'] == 'image/jpeg')
    bad = signed[0]['signedUrl'].replace('token=', 'token=x')
    check('tampered signed URL refused', requests.get(bad).status_code == 400)
    r = post('/storage/v1/object/sign/avatars', {'paths': [f'{uid}/avatar.jpg']})
    check('signing requires sign-in', r.status_code == 401)

    # ── jobs: strikes email + 3rd strike deletes the account ──
    t2 = time.time()
    for i in range(3):
        rpc('admin_ban_user', {'p_user': uid, 'p_reason': f'test strike {i + 1}'}, admin_token)
    mail = ''
    end = time.time() + 20
    while time.time() < end and not db('select 1 from auth.users where id = %s', [uid]) == []:
        time.sleep(0.5)
    check('3rd strike: account deleted by the job worker', db('select 1 from auth.users where id = %s', [uid]) == [])
    check('profile removed with the account', db('select 1 from profiles where id = %s', [uid]) == [])
    check("user's avatar files removed", not (Path(__file__).resolve().parent.parent / 'var' / 'storage' / 'avatars' / uid).exists())
    mail = wait_for_mail(email, t2, timeout=10)
    check('strike notification email sent', 'Njoftim pezullimi' in mail or 'pezullua' in mail)
    pend = db("select count(*) from backend.jobs where status <> 'done'")[0][0]
    check('no jobs stuck/failed', pend == 0, str(db("select kind, status, last_error from backend.jobs where status <> 'done'")))

    # ── server function ──
    r = post('/functions/v1/check-email-domain', {'email': 'someone@nonexistent-domain-zz12.invalid'})
    check('check-email-domain rejects a domain without mail records', r.ok and r.json()['valid'] is False)

    # ── Google sign-in against a fake Google ──
    google_test()

    failed = [n for n, okk in results if not okk]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


class FakeGoogle(BaseHTTPRequestHandler):
    email = None

    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/auth':  # consent screen: approve immediately
            qs = parse_qs(u.query)
            self.send_response(302)
            self.send_header('Location', f"{qs['redirect_uri'][0]}?code=fake-code&state={qs['state'][0]}")
            self.end_headers()
        elif u.path == '/userinfo':
            body = json.dumps({'sub': 'google-' + FakeGoogle.email, 'email': FakeGoogle.email, 'email_verified': True,
                               'name': 'Arbër Kelmendi', 'given_name': 'Arbër', 'family_name': 'Kelmendi',
                               'picture': 'https://example.com/a.jpg'}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        form = parse_qs(self.rfile.read(length).decode())
        ok_ = form.get('code') == ['fake-code'] and form.get('code_verifier')
        body = json.dumps({'access_token': 'fake-access', 'token_type': 'Bearer'} if ok_ else {'error': 'bad'}).encode()
        self.send_response(200 if ok_ else 400)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


def google_test():
    settings = requests.get(API + '/auth/v1/settings').json()
    if not settings['external']['google']:
        check('google test (needs GOOGLE_* fake config)', False, 'GOOGLE_CLIENT_ID not configured')
        return
    FakeGoogle.email = f'g.{uuid.uuid4().hex[:6]}@gmail.com'
    srv = HTTPServer(('127.0.0.1', 8765), FakeGoogle)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        s = requests.Session()
        r = s.get(f'{API}/auth/v1/authorize?provider=google&redirect_to={SITE}', allow_redirects=False)
        check('authorize redirects to Google with PKCE', r.status_code == 302 and 'code_challenge=' in r.headers['Location'])
        r = s.get(r.headers['Location'], allow_redirects=False)            # fake consent
        r = s.get(r.headers['Location'], allow_redirects=False)            # back to Django callback
        loc = r.headers.get('Location', '')
        f = frag(loc)
        check('callback returns to the app with a session', loc.startswith(SITE) and f.get('access_token'), loc[:200])
        me = requests.get(API + '/auth/v1/user', headers={'Authorization': f"Bearer {f['access_token']}"}).json()
        check('Google user: provider google, email confirmed', me['app_metadata']['provider'] == 'google' and me['email_confirmed_at'])
        prof = db('select first_name, last_name, onboarded_at from profiles where id = %s', [me['id']])
        check('profile gets the Google name, onboarding still required', prof and prof[0][0] == 'Arbër' and prof[0][1] == 'Kelmendi' and prof[0][2] is None, str(prof))
        # second sign-in reuses the same account
        r = s.get(f'{API}/auth/v1/authorize?provider=google&redirect_to={SITE}', allow_redirects=False)
        r = s.get(r.headers['Location'], allow_redirects=False)
        r = s.get(r.headers['Location'], allow_redirects=False)
        me2 = requests.get(API + '/auth/v1/user', headers={'Authorization': f"Bearer {frag(r.headers['Location'])['access_token']}"}).json()
        check('signing in again reuses the same account', me2['id'] == me['id'])
        r = s.get(f'{API}/auth/v1/authorize?provider=google&redirect_to=https://evil.example.com', allow_redirects=False)
        check('foreign redirect_to replaced by the app URL', 'evil.example.com' not in r.headers['Location'])
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
