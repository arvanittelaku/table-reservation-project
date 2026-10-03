"""Background jobs (what the Supabase Edge Functions did).

The database queues work in backend.jobs (e.g. ban_user() queueing
'notify-ban' or 'delete-banned-user'); auth queues its emails the same way.
`run_pending()` claims jobs with FOR UPDATE SKIP LOCKED, so several workers can
run safely. Kinds keep the Edge Function names they replace.
"""
import html
import json
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from . import storage
from .db import as_service, fetch_dict

log = logging.getLogger('ejb.jobs')
MAX_ATTEMPTS = 5

FOOTER = '<p style="font-family:sans-serif;font-size:12px;color:#888">ejaBashkohu, table sharing in Kosovo</p>'


def enqueue(cur, kind, payload):
    cur.execute('INSERT INTO backend.jobs (kind, payload) VALUES (%s, %s::jsonb) RETURNING id', [kind, json.dumps(payload)])
    return cur.fetchone()[0]


def send_email(to, subject, text, html_body=None):
    body_html = html_body or (
        '<p style="font-family:sans-serif;font-size:15px;line-height:1.5">'
        + html.escape(text).replace('\n', '<br>') + '</p>' + FOOTER)
    msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [to])
    msg.attach_alternative(body_html, 'text/html')
    msg.send()


# ───────────── handlers ─────────────

def _auth_email(cur, payload):
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


def _notify_ban(cur, payload):
    user = fetch_dict(cur, 'SELECT email FROM auth.users WHERE id = %s', [payload.get('user_id')])
    if not user or not user['email']:
        return 'no email'
    count = int(payload.get('ban_count') or 1)
    text = (f"Llogaria juaj në ejaBashkohu u pezullua.\n\nArsyeja: {payload.get('reason', '')}\n"
            f"Pezullim {count}/3.\n\n"
            + ('Ky ishte pezullimi i tretë. Llogaria juaj u fshi përgjithmonë.' if count >= 3
               else 'Pezullimi i tretë do të rezultojë në fshirje të përhershme të llogarisë.'))
    send_email(user['email'], 'ejaBashkohu: Njoftim pezullimi', text)


def _notify_email(cur, payload):
    email = payload.get('email')
    title = payload.get('title') or 'ejaBashkohu'
    body = payload.get('body') or payload.get('message') or ''
    pref_user = payload.get('user_id')
    if not email and payload.get('host_id'):
        host = fetch_dict(cur, 'SELECT email FROM auth.users WHERE id = %s', [payload['host_id']])
        if not host or not host['email']:
            return 'no email'
        email, pref_user = host['email'], payload['host_id']
        requester = payload.get('requester_name') or 'Dikush'
        table_title = payload.get('table_title') or 'tavolinë'
        title = f'{requester} kërkon t\'i bashkohet "{table_title}"'
        body = (f'{requester} kërkon t\'i bashkohet tavolinës tënde "{table_title}". '
                'Hap aplikacionin për ta parë profilin me foto e moshë, dhe vendos ti.')
    if not email:
        return 'no email'
    if pref_user:
        prefs = fetch_dict(cur, 'SELECT user_preferences FROM public.profiles WHERE id = %s', [pref_user])
        p = (prefs or {}).get('user_preferences') or {}
        if isinstance(p, dict) and p.get('email_notifications') is False:
            return 'email_notifications off'
    send_email(email, title, body)


def _delete_banned_user(cur, payload):
    user_id = payload.get('user_id')
    if not user_id:
        return 'no user_id'
    storage.delete_prefix('avatars', f'{user_id}/')
    cur.execute('DELETE FROM auth.users WHERE id = %s', [user_id])  # profile + data cascade as before


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
        with as_service() as cur:
            job = fetch_dict(
                cur,
                "SELECT id, kind, payload, attempts FROM backend.jobs"
                " WHERE status = 'pending' AND run_after <= now()"
                " ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")
            if not job:
                return done
            handler = HANDLERS.get(job['kind'])
            try:
                if handler is None:
                    raise RuntimeError(f"unknown job kind {job['kind']}")
                note = handler(cur, job['payload'] or {})
                cur.execute("UPDATE backend.jobs SET status = 'done', done_at = now(), attempts = attempts + 1,"
                            " last_error = %s WHERE id = %s", [note, job['id']])
            except Exception as exc:  # retry with backoff, then give up
                log.exception('job %s (%s) failed', job['id'], job['kind'])
                attempts = job['attempts'] + 1
                status = 'failed' if attempts >= MAX_ATTEMPTS else 'pending'
                cur.execute("UPDATE backend.jobs SET status = %s, attempts = %s, last_error = %s,"
                            " run_after = now() + make_interval(secs => %s) WHERE id = %s",
                            [status, attempts, str(exc)[:500], 30 * attempts * attempts, job['id']])
        done += 1
    return done
