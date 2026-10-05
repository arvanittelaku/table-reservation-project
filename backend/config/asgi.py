"""ASGI entry point: Django HTTP + Channels websockets + background tasks.

Run with:  uvicorn config.asgi:application   (or: python manage.py serve)
Background tasks (job runner, hourly Wednesday group formation) start with the server
unless RUN_BACKGROUND=0 (e.g. extra web replicas behind a load balancer).
"""
import asyncio
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

from django.core.asgi import get_asgi_application  # noqa: E402

django_asgi = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from django.urls import path  # noqa: E402

from core.realtime import RealtimeConsumer, job_runner, scheduler  # noqa: E402

router = ProtocolTypeRouter({
    'http': django_asgi,
    'websocket': URLRouter([path('realtime/v1/websocket', RealtimeConsumer.as_asgi())]),
})


class WithLifespan:
    def __init__(self, app):
        self.app = app
        self.tasks = []

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'lifespan':
            return await self.app(scope, receive, send)
        while True:
            message = await receive()
            if message['type'] == 'lifespan.startup':
                if os.environ.get('RUN_BACKGROUND', '1') != '0':
                    self.tasks = [asyncio.create_task(job_runner()), asyncio.create_task(scheduler())]
                await send({'type': 'lifespan.startup.complete'})
            elif message['type'] == 'lifespan.shutdown':
                for t in self.tasks:
                    t.cancel()
                await asyncio.wait(self.tasks, timeout=3) if self.tasks else None
                await send({'type': 'lifespan.shutdown.complete'})
                return


application = WithLifespan(router)
