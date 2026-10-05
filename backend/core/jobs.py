"""Background jobs (what the Supabase Edge Functions did).

Services queue work in backend.jobs with ejb.jobs.enqueue() (e.g. ban_user
queueing 'notify-ban' or 'delete-banned-user'); auth queues its emails the same
way. `run_pending()` claims jobs with SELECT ... FOR UPDATE SKIP LOCKED, so
several workers can run safely. Kinds keep the Edge Function names they replace.
"""
import html
import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from ejb import context
from ejb.models import AuthUser, Job, Profile

from . import storage

log = logging.getLogger('ejb.jobs')
MAX_ATTEMPTS = 5

FOOTER = '<p style="font-family:sans-serif;font-size:12px;color:#888">ejaBashkohu, table sharing in Kosovo</p>'


def send_email(to, subject, text, html_body=None):
    body_html = html_body or (
        '<p style="font-family:sans-serif;font-size:15px;line-height:1.5">'
        + html.escape(text).replace('\n', '<br>') + '</p>' + FOOTER)
    msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [to])
    msg.attach_alternative(body_html, 'text/html')
    msg.send()


# ───────────── handlers ─────────────

def _auth_email(payload):
    """Confirmation / password-reset emails (Supabase Auth sent these)."""
    kind, to, link = payload['kind'], payload['email'], payload['link']
    if kind == 'signup':
        subject = 'Konfirmo email-in · ejaBashkohu'
        text = ('Mirë se vjen në ejaBashkohu!\n\nKonfirmo email-in tënd duke hapur këtë link:\n'
                f'{link}\n\nNëse nuk u regjistrove ti, injoroje këtë email.')
        cta = 'Konfirmo email-in'
    else:
        subject = 'Ndrysho fjalëkalimin · ejaBashkohu'
        text = ('Kërkove të ndryshosh fjalëkalimin.\n\nHape këtë link për të vendosur një të ri:\n'
                f'{link}\n\nNëse nuk e kërkove ti, injoroje këtë email.')
        cta = 'Vendos fjalëkalim të ri'
    body_html = (
        '<div style="font-family:sans-serif;font-size:15px;line-height:1.5">'
        + html.escape(text.split('\n\n')[0]).replace('\n', '<br>')
        + f'<p><a href="{html.escape(link)}" style="display:inline-block;background:#FF6B35;color:#fff;'
          f'padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">{cta}</a></p>'
        + '<p style="color:#888;font-size:13px">' + html.escape(text.split('\n\n')[-1]) + '</p></div>' + FOOTER)
    send_email(to, subject, text, body_html)


def _email_of(user_id):
    if not user_id:
        return None
    try:
        return AuthUser.objects.filter(pk=user_id).values_list('email', flat=True).first()
    except (ValueError, TypeError):
        return None


def _notify_ban(payload):
    email = _email_of(payload.get('user_id'))
    if not email:
        return 'no email'
    count = int(payload.get('ban_count') or 1)
    text = (f"Llogaria juaj në ejaBashkohu u pezullua.\n\nArsyeja: {payload.get('reason', '')}\n"
            f"Pezullim {count}/3.\n\n"
            + ('Ky ishte pezullimi i tretë. Llogaria juaj u fshi përgjithmonë.' if count >= 3
               else 'Pezullimi i tretë do të rezultojë në fshirje të përhershme të llogarisë.'))
    send_email(email, 'ejaBashkohu: Njoftim pezullimi', text)


def _notify_email(payload):
    email = payload.get('email')
    title = payload.get('title') or 'ejaBashkohu'
    body = payload.get('body') or payload.get('message') or ''
    pref_user = payload.get('user_id')
    if not email and payload.get('host_id'):
        host_email = _email_of(payload['host_id'])
        if not host_email:
            return 'no email'
        email, pref_user = host_email, payload['host_id']
        requester = payload.get('requester_name') or 'Dikush'
        table_title = payload.get('table_title') or 'tavolinë'
        title = f'{requester} kërkon t\'i bashkohet "{table_title}"'
        body = (f'{requester} kërkon t\'i bashkohet tavolinës tënde "{table_title}". '
                'Hap aplikacionin për ta parë profilin me foto e moshë, dhe vendos ti.')
    if not email:
        return 'no email'
    if pref_user:
        try:
            p = Profile.objects.filter(pk=pref_user).values_list('user_preferences', flat=True).first() or {}
        except (ValueError, TypeError):
            p = {}
        if isinstance(p, dict) and p.get('email_notifications') is False:
            return 'email_notifications off'
    send_email(email, title, body)


def _delete_banned_user(payload):
    user_id = payload.get('user_id')
    if not user_id:
        return 'no user_id'
    storage.delete_prefix('avatars', f'{user_id}/')
    try:
        user = AuthUser.objects.filter(pk=user_id).first()
    except (ValueError, TypeError):
        return 'bad user_id'
    if user is not None:
        user.delete()   # profile and all their data cascade (with hooks), as before


HANDLERS = {
    'auth-email': _auth_email,
    'notify-ban': _notify_ban,
    'notify-email': _notify_email,
    'delete-banned-user': _delete_banned_user,
}


def run_pending(limit=20):
    """Run due jobs; returns how many were processed."""
    done = 0
    for _ in range(limit):
        with context.acting(context.Actor.service()):
            job = (Job.objects.select_for_update(skip_locked=True)
                   .filter(status='pending', run_after__lte=timezone.now()).order_by('id').first())
            if job is None:
                return done
            handler = HANDLERS.get(job.kind)
            sid = transaction.savepoint()
            try:
                if handler is None:
                    raise RuntimeError(f'unknown job kind {job.kind}')
                note = handler(job.payload or {})
                transaction.savepoint_commit(sid)
                job.status, job.done_at, job.last_error = 'done', timezone.now(), note
                job.attempts += 1
            except Exception as exc:  # retry with backoff, then give up
                transaction.savepoint_rollback(sid)
                log.exception('job %s (%s) failed', job.id, job.kind)
                job.attempts += 1
                job.status = 'failed' if job.attempts >= MAX_ATTEMPTS else 'pending'
                job.last_error = str(exc)[:500]
                job.run_after = timezone.now() + timedelta(seconds=30 * job.attempts * job.attempts)
            job.save()
        done += 1
    return done
