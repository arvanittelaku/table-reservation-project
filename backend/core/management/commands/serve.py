"""python manage.py serve [--port 8000] [--reload]: run the full backend."""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Run the ejaBashkohu backend (HTTP + websockets + background jobs)'

    def add_arguments(self, parser):
        parser.add_argument('--host', default='127.0.0.1')
        parser.add_argument('--port', type=int, default=8000)
        parser.add_argument('--reload', action='store_true')

    def handle(self, *args, **opts):
        import os

        import uvicorn
        # behind a reverse proxy (Caddy in deploy/), trust its X-Forwarded-* headers
        uvicorn.run('config.asgi:application', host=opts['host'], port=opts['port'],
                    reload=opts['reload'], lifespan='on', ws='auto', proxy_headers=True,
                    forwarded_allow_ips=os.environ.get('FORWARDED_ALLOW_IPS', '127.0.0.1'))
