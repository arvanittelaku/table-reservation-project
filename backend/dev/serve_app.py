"""Serve hajde/dist on :5173 with SPA fallback (like `vite preview`), for local tests."""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'hajde', 'dist')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def send_head(self):
        p = self.translate_path(self.path.split('?')[0])
        if not os.path.exists(p):
            self.path = '/index.html'
        return super().send_head()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 5173), H).serve_forever()
