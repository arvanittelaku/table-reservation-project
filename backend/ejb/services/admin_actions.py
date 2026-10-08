"""Admin moderation actions (group D): bans, reports, table cancel/restore, user flags."""
from uuid import UUID

from django.db import IntegrityError, transaction

from .. import context, jobs
from ..errors import fail
from ..models import AuthUser, Ban, Membership, Notification, Profile, Report, Request, Table, Waitlist
from ..rpc import rpc
from . import common

ADMIN_ONLY = 'Vetëm adminët mund ta bëjnë këtë'


def _s(v):
    return str(v) if v is not None else None


def _clean(text):
    """NULLIF(trim(COALESCE(x, '')), '')"""
    t = (text or '').strip(' ')
    return t or None


def _require_admin_plain():
    """IF NOT public.is_admin_user() THEN RAISE (P0001, unlike _admin_guard)."""
    if not common.is_admin():
        fail(ADMIN_ONLY)


def _save_db_error(obj):
    """save(); a constraint violation becomes the same DbError Postgres raised in SQL
    (ejb.rpc.call does not convert IntegrityError itself)."""
    try:
        with transaction.atomic():
            obj.save()
    except IntegrityError as e:
        diag = getattr(e.__cause__, 'diag', None)
        fail(diag.message_primary if diag else str(e).split('\n')[0],
             getattr(e.__cause__, 'sqlstate', None) or '23000')


def ban_user(p_user, p_reason):
    """public.ban_user(p_user, p_reason) -> ban count (internal)."""
    _save_db_error(Ban(user_id=p_user, reason=p_reason))
    count = Ban.objects.filter(user_id=p_user).count()
    body = None if p_reason is None else f'Llogaria juaj u pezullua. Arsyeja: {p_reason}. Pezullim {count}/3.'
    Notification(user_id=p_user, icon='warning', body=body).save()
    jobs.enqueue('notify-ban', {'user_id': _s(p_user), 'reason': p_reason, 'ban_count': count})
    if count >= 3:
        jobs.enqueue('delete-banned-user', {'user_id': _s(p_user)})
    return count


def _now():
    return context.now()


@rpc('admin_ban_from_report')
def admin_ban_from_report(p_report_id: UUID, p_reason: str) -> int:
    _require_admin_plain()
    reported = Report.objects.filter(pk=p_report_id).values_list('reported_id', flat=True).first()
    count = ban_user(reported, p_reason)
    Report.objects.filter(pk=p_report_id).update(status='reviewed_banned', reviewed_by_id=context.uid(),
                                                 reviewed_at=_now())
    common.admin_log('user_banned', 'user', reported, common.user_label(reported),
                     {'reason': p_reason, 'ban_count': count, 'report_id': _s(p_report_id)})
    return count


@rpc('admin_ban_user')
def admin_ban_user(p_user: UUID, p_reason: str) -> int:
    common.admin_guard()
    reason = _clean(p_reason)
    if p_user is not None and p_user == context.uid():
        fail('Nuk mund ta pezullosh veten')
    if reason is None:
        fail('Shkruaj arsyen')
    if not Profile.objects.filter(pk=p_user).exists():
        fail('Përdoruesi nuk u gjet')
    if Profile.objects.filter(pk=p_user, is_admin=True).exists():
        fail('Hiq fillimisht rolin admin')
    count = ban_user(p_user, reason)
    common.admin_log('user_banned', 'user', p_user, common.user_label(p_user),
                     {'reason': reason, 'ban_count': count})
    return count


@rpc('admin_cancel_table')
def admin_cancel_table(p_table: UUID, p_reason: str) -> int:
    common.admin_guard()
    reason = _clean(p_reason)
    if reason is None:
        fail('Shkruaj arsyen')
    t = Table.objects.filter(pk=p_table).first()
    if t is None or t.title is None:
        fail('Tavolina nuk u gjet')
    title, status = t.title, t.status
    if status == 'cancelled':
        fail('Tavolina është anuluar tashmë')
    t.status = 'cancelled'
    t.save()

    recipients = set(Membership.objects.filter(table_id=p_table).values_list('user_id', flat=True))
    recipients |= set(Request.objects.filter(table_id=p_table, status__in=('pending', 'approved'))
                      .values_list('user_id', flat=True))
    recipients |= set(Waitlist.objects.filter(table_id=p_table).values_list('user_id', flat=True))
    body = f'Tavolina "{title}" u anulua nga ekipi i ejaBashkohu. Arsyeja: {reason}'
    for u in recipients:
        Notification(user_id=u, icon='warning', body=body).save()
    notified = len(recipients)

    for r in Request.objects.filter(table_id=p_table, status__in=('pending', 'approved')):
        r.status = 'expired'
        r.save()
    for w in Waitlist.objects.filter(table_id=p_table):
        w.delete()

    common.admin_log('table_cancelled', 'table', p_table, title,
                     {'reason': reason, 'notified': notified, 'previous_status': status})
    return notified


@rpc('admin_restore_table')
def admin_restore_table(p_table: UUID) -> None:
    common.admin_guard()
    t = Table.objects.filter(pk=p_table).first()
    if t is None or t.title is None:
        fail('Tavolina nuk u gjet')
    if t.status is not None and t.status != 'cancelled':
        fail('Vetëm tavolinat e anuluara rikthehen')
    if t.event_datetime is not None and t.event_datetime <= _now():
        fail('Data e tavolinës ka kaluar')
    t.status = 'open'
    t.save()
    common.admin_log('table_restored', 'table', p_table, t.title, {})


def _email(user_id):
    return AuthUser.objects.filter(pk=user_id).values_list('email', flat=True).first() if user_id else None


@rpc('admin_delete_immediately')
def admin_delete_immediately(p_report_id: UUID, p_reason: str) -> None:
    _require_admin_plain()
    reported = Report.objects.filter(pk=p_report_id).values_list('reported_id', flat=True).first()
    Report.objects.filter(pk=p_report_id).update(status='deleted_immediately', reviewed_by_id=context.uid(),
                                                 reviewed_at=_now())
    label = common.user_label(reported)
    common.admin_log('user_deleted', 'user', reported, label,
                     {'reason': p_reason, 'email': _email(reported), 'report_id': _s(p_report_id)})
    jobs.enqueue('delete-banned-user', {'user_id': _s(reported)})


@rpc('admin_delete_user')
def admin_delete_user(p_user: UUID, p_reason: str) -> None:
    common.admin_guard()
    reason = _clean(p_reason)
    if p_user is not None and p_user == context.uid():
        fail('Nuk mund ta fshish llogarinë tënde')
    if reason is None:
        fail('Shkruaj arsyen')
    if Profile.objects.filter(pk=p_user, is_admin=True).exists():
        fail('Hiq fillimisht rolin admin')
    label = common.user_label(p_user)
    if label is None:
        fail('Përdoruesi nuk u gjet')
    common.admin_log('user_deleted', 'user', p_user, label, {'reason': reason, 'email': _email(p_user)})
    jobs.enqueue('delete-banned-user', {'user_id': _s(p_user)})


@rpc('admin_dismiss_report')
def admin_dismiss_report(p_report_id: UUID) -> None:
    _require_admin_plain()
    reported = Report.objects.filter(pk=p_report_id).values_list('reported_id', flat=True).first()
    Report.objects.filter(pk=p_report_id).update(status='reviewed_dismissed', reviewed_by_id=context.uid(),
                                                 reviewed_at=_now())
    common.admin_log('report_dismissed', 'user', reported, common.user_label(reported),
                     {'report_id': _s(p_report_id)})


@rpc('admin_notify_user')
def admin_notify_user(p_user: UUID, p_message: str) -> None:
    common.admin_guard()
    msg = _clean(p_message)
    if msg is None or len(msg) > 500:
        fail('Mesazhi duhet të ketë 1 deri 500 karaktere')
    if not Profile.objects.filter(pk=p_user).exists():
        fail('Përdoruesi nuk u gjet')
    # kind + params: the app frames the message in the viewer's language
    Notification(user_id=p_user, icon='info', body=msg, kind='adminMessage', params={'message': msg}).save()
    common.admin_log('user_notified', 'user', p_user, common.user_label(p_user), {'message': msg})


@rpc('admin_reactivate_account')
def admin_reactivate_account(p_user_id: UUID) -> None:
    _require_admin_plain()
    for p in Profile.objects.filter(pk=p_user_id):
        p.deactivated_at = None
        p.save()
    common.admin_log('user_reactivated', 'user', p_user_id, common.user_label(p_user_id), {})


@rpc('admin_set_user_admin')
def admin_set_user_admin(p_user: UUID, p_is_admin: bool) -> None:
    common.admin_guard()
    if p_user is not None and p_user == context.uid() and p_is_admin is False:
        fail('Nuk mund ta heqësh rolin admin nga vetja')
    found = False
    for p in Profile.objects.filter(pk=p_user):
        p.is_admin = p_is_admin
        p.save()
        found = True
    if not found:
        fail('Përdoruesi nuk u gjet')
    common.admin_log('admin_granted' if p_is_admin else 'admin_revoked',
                     'user', p_user, common.user_label(p_user), {})


@rpc('admin_set_user_deactivated')
def admin_set_user_deactivated(p_user: UUID, p_deactivated: bool, p_reason: str = None) -> None:
    common.admin_guard()
    if p_user is not None and p_user == context.uid():
        fail('Nuk mund ta ndryshosh llogarinë tënde këtu')
    if not Profile.objects.filter(pk=p_user).exists():
        fail('Përdoruesi nuk u gjet')
    for p in Profile.objects.filter(pk=p_user):
        p.deactivated_at = (p.deactivated_at or _now()) if p_deactivated else None
        p.save()
    common.admin_log('user_deactivated' if p_deactivated else 'user_reactivated',
                     'user', p_user, common.user_label(p_user), {'reason': _clean(p_reason)})
