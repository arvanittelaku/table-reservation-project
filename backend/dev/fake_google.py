"""Fake Google OAuth server for local tests (port 8765). Approves every sign-in
as a new Google user "Arbër Kelmendi". Point GOOGLE_*_URL at it in .env."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

STATE = {'email': None}


class FakeGoogle(BaseHTTPRequestHandler):
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
        if u.path == '/auth':
            qs = parse_qs(u.query)
            STATE['email'] = f'arber.{int(time.time() * 1000)}@gmail.com'
            self.send_response(302)
            self.send_header('Location', f"{qs['redirect_uri'][0]}?code=fake-code&state={qs['state'][0]}")
            self.end_headers()
        elif u.path == '/userinfo':
            e = STATE['email'] or 'arber@gmail.com'
            self._json(200, {'sub': 'google-' + e, 'email': e, 'email_verified': True, 'name': 'Arbër Kelmendi',
                             'given_name': 'Arbër', 'family_name': 'Kelmendi'})
        else:
            self._json(404, {})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        form = parse_qs(self.rfile.read(n).decode())
        if form.get('code') == ['fake-code'] and form.get('code_verifier'):
            self._json(200, {'access_token': 'fake-access', 'token_type': 'Bearer'})
        else:
            self._json(400, {'error': 'invalid_grant'})


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8765), FakeGoogle).serve_forever()
