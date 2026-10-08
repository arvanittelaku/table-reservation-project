"""Connects the former database triggers (hooks.py) and realtime to model saves."""
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from . import hooks, models as m, realtime


def _old(instance):
    if instance._state.adding:
        return None
    return type(instance).objects.filter(pk=instance.pk).first()


@receiver(pre_save)
def _before_save(sender, instance, raw=False, update_fields=None, **kw):
    if raw or sender._meta.app_label != 'ejb':
        return
    adding = instance._state.adding
    if sender is m.Profile:
        if adding:
            hooks.profile_before_insert(instance)
        else:
            old = _old(instance)
            if old is not None:
                hooks.profile_before_update(instance, old)
    elif sender is m.Table:
        if adding:
            hooks.table_before_insert(instance)
        else:
            old = _old(instance)
            if old is not None:
                hooks.table_before_update(instance, old)
    elif sender is m.Request:
        if adding:
            hooks.join_before_insert(instance, 'requests')
            instance._old_status = None
        else:
            instance._old_status = (m.Request.objects.filter(pk=instance.pk)
                                    .values_list('status', flat=True).first())
    elif sender is m.Membership:
        if adding:
            hooks.membership_before_insert(instance)
    elif sender is m.Waitlist:
        if adding:
            hooks.join_before_insert(instance, 'waitlist')
    elif sender is m.Notification:
        if adding:
            hooks.notification_before_insert(instance)
    elif sender is m.Payment:
        if adding:
            hooks.payment_before_insert(instance)
    elif sender is m.Tutor:
        hooks.tutor_before_write(instance, _old(instance))
    # direct client writes: the policy WITH CHECK runs on the row as the hooks left it
    check = instance.__dict__.pop('_rls_check', None)
    if check is not None:
        check(instance)


@receiver(post_save)
def _after_save(sender, instance, created, raw=False, **kw):
    if raw or sender._meta.app_label != 'ejb':
        return
    if sender is m.AuthUser and created:
        hooks.user_created(instance)
    elif sender is m.Table and created:
        hooks.table_after_insert(instance)
    elif sender is m.Request:
        hooks.request_after_save(instance, created, getattr(instance, '_old_status', None))
    elif sender is m.Membership and created:
        hooks.touch_table(instance.table_id)
        hooks.membership_after_insert(instance)
    elif sender is m.Rating and created:
        hooks.rating_after_insert(instance)
    elif sender is m.ConnectionPick and created:
        hooks.pick_after_insert(instance)
    realtime.record(instance, 'INSERT' if created else 'UPDATE')


@receiver(post_delete)
def _after_delete(sender, instance, **kw):
    if sender._meta.app_label != 'ejb':
        return
    if sender is m.Membership:
        hooks.membership_after_delete(instance)
    elif sender is m.Request:
        hooks.touch_table(instance.table_id)
    realtime.record(instance, 'DELETE')
