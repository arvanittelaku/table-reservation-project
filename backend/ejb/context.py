"""Who is acting, for the duration of one request or job.

Replaces what Postgres knew through request.jwt.claims + SET ROLE:

  actor().uid        was auth.uid()
  actor().is_admin   was public.is_admin_user()
  is_direct()        True while serving a client's direct table query (PostgREST
                     path, role "authenticated"/"anon"); False inside services
                     (what SECURITY DEFINER functions did). Some former triggers
                     behave differently between the two.
  now()              was now(): one timestamp per transaction.
"""
import contextvars
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone


@dataclass
class Actor:
    uid: uuid.UUID | None = None
    email: str | None = None
    role: str = 'anon'          # 'authenticated' | 'anon' | 'service'
    _admin: bool | None = field(default=None, repr=False)

    @classmethod
    def from_claims(cls, claims):
        if not claims or not claims.get('sub'):
            return cls()
        return cls(uid=uuid.UUID(str(claims['sub'])), email=claims.get('email'), role='authenticated')

    @classmethod
    def service(cls):
        return cls(role='service')

    @property
    def signed_in(self):
        return self.uid is not None

    @property
    def is_admin(self):
        if self._admin is None:
            from .models import Profile
            self._admin = bool(self.uid and Profile.objects.filter(pk=self.uid, is_admin=True).exists())
        return self._admin

    def forget_admin(self):
        self._admin = None


@dataclass
class _State:
    actor: Actor
    direct: bool = False
    now: object = None
    after_commit: list = field(default_factory=list)


_state = contextvars.ContextVar('ejb_state', default=None)


def actor():
    st = _state.get()
    return st.actor if st else Actor.service()


def uid():
    return actor().uid


def is_direct():
    st = _state.get()
    return bool(st and st.direct)


def now():
    st = _state.get()
    if st is None:
        return timezone.now()
    if st.now is None:
        st.now = timezone.now()
    return st.now


@contextmanager
def acting(act, direct=False):
    """Run a unit of work (one transaction) as `act`."""
    token = _state.set(_State(actor=act, direct=direct))
    try:
        with transaction.atomic():
            yield act
    finally:
        _state.reset(token)


@contextmanager
def definer():
    """Inside a service: behave like a SECURITY DEFINER function (not 'direct')."""
    st = _state.get()
    if st is None or not st.direct:
        yield
        return
    st.direct = False
    try:
        yield
    finally:
        st.direct = True


def on_commit(fn):
    transaction.on_commit(fn)
