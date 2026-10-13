"""Django admin for the app's data (/django-admin/).

Rows are shown as they are stored. Writes that carry business rules (bans,
premium, reports, tables, orders, tutors, plans, restaurants) are not edited
in place: they run through the same server functions as the app's admin
console (ejb/services/*), so limits, notifications, emails, the audit log and
live updates all happen. Only plain reference data (subjects, notification
text rules) is edited directly. Accounts, tokens and jobs are read-only.

Models with a composite primary key (memberships, lesson participants, ...)
cannot be registered in Django's admin; they are listed on their parent row.
"""
from django import forms
from django.contrib import admin
from django.contrib.admin.helpers import ActionForm
from django.utils.html import format_html, format_html_join

from core.admin_site import run_for_each, run_service, site

from . import models as m
from .services import admin_actions, lessons, official, plans, wednesday


class ReasonActionForm(ActionForm):
    reason = forms.CharField(required=False, label='Reason / message',
                             widget=forms.TextInput(attrs={'size': 40, 'placeholder': 'reason or message (for ban, cancel, notify...)'}))
    plan = forms.ChoiceField(required=False, label='Plan', choices=())

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        try:
            self.fields['plan'].choices = [('', '— plan —')] + [
                (p.id, p.id) for p in m.Plan.objects.filter(tier='premium', active=True).order_by('sort')]
        except Exception:   # noqa: BLE001 - table missing during checks
            pass


def _reason(request):
    return (request.POST.get('reason') or '').strip()


class ReadOnlyAdmin(admin.ModelAdmin):
    """View-only: list, search, filter, open a row; no add/change/delete."""
    list_per_page = 50
    show_full_result_count = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop('delete_selected', None)
        return actions


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


def _rows(header, rows):
    if not rows:
        return '—'
    head = format_html_join('', '<th>{}</th>', ((h,) for h in header))
    body = format_html_join('', '<tr>{}</tr>', (
        (format_html_join('', '<td>{}</td>', ((c,) for c in r)),) for r in rows))
    return format_html('<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>', head, body)


# ───────────── accounts ─────────────

@admin.register(m.AuthUser, site=site)
class AuthUserAdmin(ReadOnlyAdmin):
    list_display = ('email', 'id', 'created_at', 'last_sign_in_at', 'email_confirmed_at', 'banned_until', 'deleted_at')
    search_fields = ('email', 'id')
    list_filter = (('email_confirmed_at', admin.EmptyFieldListFilter), ('banned_until', admin.EmptyFieldListFilter),
                   ('deleted_at', admin.EmptyFieldListFilter), 'created_at')
    exclude = ('encrypted_password',)      # never shown
    ordering = ('-created_at',)


class IdentityInline(ReadOnlyInline):
    model = m.Identity
    fk_name = 'user'
    fields = ('provider', 'email', 'last_sign_in_at', 'created_at')
    readonly_fields = fields


@admin.register(m.Identity, site=site)
class IdentityAdmin(ReadOnlyAdmin):
    list_display = ('provider', 'email', 'user', 'last_sign_in_at', 'created_at')
    list_filter = ('provider',)
    search_fields = ('email', 'provider_id', 'user__email')
    list_select_related = ('user',)


@admin.register(m.Profile, site=site)
class ProfileAdmin(ReadOnlyAdmin):
    list_display = ('full_name', 'email', 'age', 'home_city', 'is_admin', 'verified', 'rating', 'tables_hosted',
                    'onboarded_at', 'deactivated_at', 'created_at')
    list_filter = ('is_admin', 'verified', 'is_tourist', 'home_city', ('onboarded_at', admin.EmptyFieldListFilter),
                   ('deactivated_at', admin.EmptyFieldListFilter), 'created_at')
    search_fields = ('first_name', 'last_name', 'user__email', 'user__id')
    list_select_related = ('user',)
    ordering = ('-created_at',)
    readonly_fields = ('bans', 'premium', 'badges')
    action_form = ReasonActionForm
    actions = ('ban', 'deactivate', 'reactivate', 'make_admin', 'remove_admin', 'grant_premium',
               'revoke_premium', 'notify', 'delete_account')

    @admin.display(ordering='user__email')
    def email(self, obj):
        return obj.user.email

    @admin.display(description='name', ordering='first_name')
    def full_name(self, obj):
        return obj.full_name

    def bans(self, obj):
        return _rows(('when', 'reason'), m.Ban.objects.filter(user_id=obj.pk).order_by('-created_at')
                     .values_list('created_at', 'reason'))

    def badges(self, obj):
        return _rows(('badge', 'earned'), m.Badge.objects.filter(user_id=obj.pk).order_by('earned_at')
                     .values_list('badge_id', 'earned_at'))

    def premium(self, obj):
        return _rows(('plan', 'status', 'from', 'until', 'source'),
                     m.Subscription.objects.filter(user_id=obj.pk).order_by('-created_at')
                     .values_list('plan_id', 'status', 'starts_at', 'ends_at', 'source'))

    @admin.action(description='Ban (strike) — reason required; 3rd strike deletes the account')
    def ban(self, request, qs):
        run_for_each(self, request, qs, 'Ban', lambda p: admin_actions.admin_ban_user(p.pk, _reason(request)))

    @admin.action(description='Deactivate account')
    def deactivate(self, request, qs):
        run_for_each(self, request, qs, 'Deactivate',
                     lambda p: admin_actions.admin_set_user_deactivated(p.pk, True, _reason(request) or None))

    @admin.action(description='Reactivate account')
    def reactivate(self, request, qs):
        run_for_each(self, request, qs, 'Reactivate', lambda p: admin_actions.admin_set_user_deactivated(p.pk, False))

    @admin.action(description='Make admin')
    def make_admin(self, request, qs):
        run_for_each(self, request, qs, 'Make admin', lambda p: admin_actions.admin_set_user_admin(p.pk, True))

    @admin.action(description='Remove admin')
    def remove_admin(self, request, qs):
        run_for_each(self, request, qs, 'Remove admin', lambda p: admin_actions.admin_set_user_admin(p.pk, False))

    @admin.action(description='Grant Premium (choose the plan; reason = note)')
    def grant_premium(self, request, qs):
        plan = request.POST.get('plan') or ''
        run_for_each(self, request, qs, 'Grant Premium',
                     lambda p: plans.admin_grant_premium(p.pk, plan, _reason(request) or None))

    @admin.action(description='Revoke Premium — reason required')
    def revoke_premium(self, request, qs):
        run_for_each(self, request, qs, 'Revoke Premium', lambda p: plans.admin_revoke_premium(p.pk, _reason(request)))

    @admin.action(description='Send a notification (reason = message)')
    def notify(self, request, qs):
        run_for_each(self, request, qs, 'Notify', lambda p: admin_actions.admin_notify_user(p.pk, _reason(request)))

    @admin.action(description='Delete account (with emails and photo cleanup) — reason required')
    def delete_account(self, request, qs):
        run_for_each(self, request, qs, 'Delete account', lambda p: admin_actions.admin_delete_user(p.pk, _reason(request)))


@admin.register(m.Ban, site=site)
class BanAdmin(ReadOnlyAdmin):
    list_display = ('user', 'reason', 'created_at')
    search_fields = ('user__first_name', 'user__last_name', 'user__user__email', 'reason')
    list_filter = ('created_at',)
    list_select_related = ('user',)
    ordering = ('-created_at',)


@admin.register(m.TasteProfile, site=site)
class TasteProfileAdmin(ReadOnlyAdmin):
    list_display = ('user', 'done', 'group_size', 'energy', 'updated_at')
    list_filter = ('done',)
    search_fields = ('user__first_name', 'user__last_name')


# ───────────── tables ─────────────

class RequestInline(ReadOnlyInline):
    model = m.Request
    fields = ('user', 'status', 'created_at')
    readonly_fields = fields


class MessageInline(ReadOnlyInline):
    model = m.Message
    fields = ('sender', 'body', 'created_at')
    readonly_fields = fields


@admin.register(m.Table, site=site)
class TableAdmin(ReadOnlyAdmin):
    list_display = ('title', 'kind', 'category', 'city', 'host', 'starts_at', 'spots', 'status', 'share_code', 'created_at')
    list_filter = ('status', 'kind', 'category', 'city', 'women_only', 'men_only', 'mystery', 'sport', 'starts_at')
    search_fields = ('title', 'description', 'share_code', 'host__first_name', 'host__last_name', 'id')
    list_select_related = ('host',)
    date_hierarchy = 'starts_at'
    ordering = ('-created_at',)
    readonly_fields = ('members',)
    inlines = (RequestInline, MessageInline)
    action_form = ReasonActionForm
    actions = ('cancel_table', 'restore_table', 'mark_official', 'unmark_official')

    def members(self, obj):
        return _rows(('member', 'role', 'joined'), [
            (str(x.user), x.role, x.joined_at) for x in m.Membership.objects.filter(table_id=obj.pk).select_related('user')])

    @admin.action(description='Cancel table — reason required (members are notified)')
    def cancel_table(self, request, qs):
        run_for_each(self, request, qs, 'Cancel table', lambda t: admin_actions.admin_cancel_table(t.pk, _reason(request)))

    @admin.action(description='Restore cancelled table')
    def restore_table(self, request, qs):
        run_for_each(self, request, qs, 'Restore table', lambda t: admin_actions.admin_restore_table(t.pk))

    @admin.action(description='Mark as official event — Premium-first hours in the reason field (default 48)')
    def mark_official(self, request, qs):
        r = _reason(request)
        hours = int(r) if r.isdigit() else official.DEFAULT_PREMIUM_HOURS
        run_for_each(self, request, qs, 'Mark official', lambda t: official.admin_set_official_event(t.pk, hours))

    @admin.action(description='Remove official event mark')
    def unmark_official(self, request, qs):
        run_for_each(self, request, qs, 'Unmark official', lambda t: official.admin_unset_official_event(t.pk))


@admin.register(m.OfficialEvent, site=site)
class OfficialEventAdmin(ReadOnlyAdmin):
    list_display = ('table', 'premium_hours', 'marked_by', 'created_at', 'updated_at')
    list_select_related = ('table', 'marked_by')
    search_fields = ('table__title',)
    ordering = ('-created_at',)


@admin.register(m.Request, site=site)
class RequestAdmin(ReadOnlyAdmin):
    list_display = ('table', 'user', 'status', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('table__title', 'user__first_name', 'user__last_name')
    list_select_related = ('table', 'user')
    ordering = ('-created_at',)


@admin.register(m.Message, site=site)
class MessageAdmin(ReadOnlyAdmin):
    list_display = ('table', 'sender', 'body', 'created_at')
    search_fields = ('body', 'table__title', 'sender__first_name', 'sender__last_name')
    list_filter = ('created_at',)
    list_select_related = ('table', 'sender')
    ordering = ('-created_at',)


@admin.register(m.Rating, site=site)
class RatingAdmin(ReadOnlyAdmin):
    list_display = ('table', 'rater', 'stars', 'meet_again', 'created_at')
    list_filter = ('stars', 'meet_again')
    search_fields = ('table__title', 'rater__first_name', 'rater__last_name')
    list_select_related = ('table', 'rater')


@admin.register(m.Report, site=site)
class ReportAdmin(ReadOnlyAdmin):
    list_display = ('created_at', 'status', 'reason', 'reporter', 'reported', 'table', 'reviewed_by', 'reviewed_at')
    list_filter = ('status', 'reason', 'created_at')
    search_fields = ('details', 'reason', 'reporter__first_name', 'reporter__last_name',
                     'reported__first_name', 'reported__last_name', 'table__title')
    list_select_related = ('reporter', 'reported', 'table', 'reviewed_by')
    ordering = ('-created_at',)
    action_form = ReasonActionForm
    actions = ('dismiss', 'ban_reported', 'delete_reported_now')

    @admin.action(description='Dismiss report')
    def dismiss(self, request, qs):
        run_for_each(self, request, qs, 'Dismiss', lambda r: admin_actions.admin_dismiss_report(r.pk))

    @admin.action(description='Ban the reported user (strike) — reason required')
    def ban_reported(self, request, qs):
        run_for_each(self, request, qs, 'Ban from report',
                     lambda r: admin_actions.admin_ban_from_report(r.pk, _reason(request)))

    @admin.action(description='Delete the reported account immediately — reason required')
    def delete_reported_now(self, request, qs):
        run_for_each(self, request, qs, 'Delete immediately',
                     lambda r: admin_actions.admin_delete_immediately(r.pk, _reason(request)))


@admin.register(m.Notification, site=site)
class NotificationAdmin(ReadOnlyAdmin):
    list_display = ('created_at', 'user', 'kind', 'icon', 'body', 'read')
    list_filter = ('kind', 'read', 'created_at')
    search_fields = ('body', 'user__first_name', 'user__last_name')
    list_select_related = ('user',)
    ordering = ('-created_at',)


@admin.register(m.NotificationTextRule, site=site)
class NotificationTextRuleAdmin(admin.ModelAdmin):
    list_display = ('kind', 'lang', 'priority', 'pattern')
    list_filter = ('kind', 'lang')
    search_fields = ('kind', 'pattern')


@admin.register(m.NotificationBadgeLabel, site=site)
class NotificationBadgeLabelAdmin(admin.ModelAdmin):
    list_display = ('label', 'badge_key')
    search_fields = ('label', 'badge_key')


# ───────────── plans and payments ─────────────

class PlanForm(forms.ModelForm):
    class Meta:
        model = m.Plan
        fields = ('price_cents', 'monthly_table_limit', 'monthly_join_limit', 'active')


@admin.register(m.Plan, site=site)
class PlanAdmin(admin.ModelAdmin):
    """Edited through admin_update_plan (keeps Basic free/active, logs the change)."""
    form = PlanForm
    list_display = ('id', 'tier', 'months', 'price_cents', 'monthly_table_limit', 'monthly_join_limit', 'active', 'sort')
    list_filter = ('tier', 'active')
    ordering = ('sort',)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        d = form.cleaned_data
        run_service(self, request, 'Update plan', plans.admin_update_plan, obj.pk, d.get('price_cents'),
                    d.get('monthly_table_limit'), d.get('monthly_join_limit'), d.get('active'))


@admin.register(m.Subscription, site=site)
class SubscriptionAdmin(ReadOnlyAdmin):
    list_display = ('user', 'plan', 'status', 'starts_at', 'ends_at', 'source', 'amount_cents', 'created_at')
    list_filter = ('status', 'source', 'plan', 'ends_at')
    search_fields = ('user__first_name', 'user__last_name', 'user__user__email', 'provider_ref', 'note')
    list_select_related = ('user', 'plan')
    ordering = ('-created_at',)


@admin.register(m.SubscriptionOrder, site=site)
class SubscriptionOrderAdmin(ReadOnlyAdmin):
    list_display = ('code', 'user', 'plan', 'amount_cents', 'status', 'handled_by', 'handled_at', 'created_at')
    list_filter = ('status', 'plan', 'created_at')
    search_fields = ('code', 'user__first_name', 'user__last_name', 'user__user__email')
    list_select_related = ('user', 'plan', 'handled_by')
    ordering = ('-created_at',)
    actions = ('mark_paid', 'cancel_order')

    @admin.action(description='Mark paid (activates Premium)')
    def mark_paid(self, request, qs):
        run_for_each(self, request, qs, 'Mark paid', lambda o: plans.admin_mark_order_paid(o.pk))

    @admin.action(description='Cancel order')
    def cancel_order(self, request, qs):
        run_for_each(self, request, qs, 'Cancel order', lambda o: plans.admin_cancel_order(o.pk))


@admin.register(m.Payment, site=site)
class PaymentAdmin(ReadOnlyAdmin):
    list_display = ('created_at', 'ticket_code', 'payer_name', 'amount_cents', 'currency', 'provider', 'status',
                    'table_title', 'lesson')
    list_filter = ('status', 'provider', 'currency', 'refundable', 'created_at')
    search_fields = ('ticket_code', 'payer_name', 'table_title', 'provider_ref', 'user__user__email')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'


# ───────────── lessons ─────────────

@admin.register(m.Tutor, site=site)
class TutorAdmin(ReadOnlyAdmin):
    list_display = ('user', 'status', 'headline', 'city', 'price_cents', 'online', 'in_person', 'group_ok',
                    'reviewed_at', 'created_at')
    list_filter = ('status', 'online', 'in_person', 'group_ok', 'city')
    search_fields = ('user__first_name', 'user__last_name', 'headline', 'bio', 'city')
    list_select_related = ('user',)
    ordering = ('-created_at',)
    action_form = ReasonActionForm
    actions = ('approve', 'reject', 'suspend')

    def _review(self, request, qs, status, label):
        run_for_each(self, request, qs, label,
                     lambda t: lessons.admin_review_tutor(t.pk, status, _reason(request) or None))

    @admin.action(description='Approve tutor')
    def approve(self, request, qs):
        self._review(request, qs, 'approved', 'Approve')

    @admin.action(description='Reject tutor — reason required')
    def reject(self, request, qs):
        self._review(request, qs, 'rejected', 'Reject')

    @admin.action(description='Suspend tutor')
    def suspend(self, request, qs):
        self._review(request, qs, 'suspended', 'Suspend')


@admin.register(m.LessonSubject, site=site)
class LessonSubjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'category', 'sort')
    list_filter = ('category',)
    search_fields = ('id',)
    ordering = ('category', 'sort')

    def has_delete_permission(self, request, obj=None):
        return False   # lessons and tutors reference subjects


@admin.register(m.Lesson, site=site)
class LessonAdmin(ReadOnlyAdmin):
    list_display = ('starts_at', 'subject', 'kind', 'format', 'tutor', 'duration_min', 'max_students', 'price_cents', 'status')
    list_filter = ('status', 'kind', 'format', 'subject__category', 'starts_at')
    search_fields = ('title', 'subject__id', 'tutor__user__first_name', 'tutor__user__last_name')
    list_select_related = ('tutor__user', 'subject')
    date_hierarchy = 'starts_at'
    ordering = ('-starts_at',)
    readonly_fields = ('participants_list',)

    @admin.display(description='participants')
    def participants_list(self, obj):
        return _rows(('student', 'status', 'note', 'since'), [
            (str(p.student), p.status, p.note or '', p.created_at)
            for p in m.LessonParticipant.objects.filter(lesson_id=obj.pk).select_related('student')])


# ───────────── Wednesday dinners ─────────────

class RestaurantForm(forms.ModelForm):
    class Meta:
        model = m.WednesdayRestaurant
        fields = ('name', 'city', 'address', 'maps_link')


@admin.register(m.WednesdayRestaurant, site=site)
class WednesdayRestaurantAdmin(admin.ModelAdmin):
    """Saved through admin_upsert_restaurant (validation + audit log)."""
    form = RestaurantForm
    list_display = ('name', 'city', 'address', 'active')
    list_filter = ('city', 'active')
    search_fields = ('name', 'address', 'city')
    actions = ('activate', 'deactivate')

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        d = form.cleaned_data
        holder = {}

        def save():
            holder['id'] = wednesday.admin_upsert_restaurant(obj.pk if change else None, d['name'], d['city'],
                                                             d['address'], d.get('maps_link') or '')
        if run_service(self, request, 'Save restaurant', save) and not change:
            obj.pk = holder['id']

    @admin.action(description='Activate')
    def activate(self, request, qs):
        run_for_each(self, request, qs, 'Activate', lambda r: wednesday.admin_set_restaurant_active(r.pk, True))

    @admin.action(description='Deactivate')
    def deactivate(self, request, qs):
        run_for_each(self, request, qs, 'Deactivate', lambda r: wednesday.admin_set_restaurant_active(r.pk, False))


@admin.register(m.WednesdayGroup, site=site)
class WednesdayGroupAdmin(ReadOnlyAdmin):
    list_display = ('dinner_date', 'city', 'restaurant', 'table', 'created_at')
    list_filter = ('city', 'dinner_date')
    search_fields = ('city', 'restaurant__name')
    list_select_related = ('restaurant', 'table')
    readonly_fields = ('members',)
    ordering = ('-dinner_date',)

    def members(self, obj):
        return _rows(('member',), [(str(p.user),) for p in
                                   m.WednesdayParticipant.objects.filter(group_id=obj.pk).select_related('user')])


@admin.register(m.AdminAuditLog, site=site)
class AdminAuditLogAdmin(ReadOnlyAdmin):
    list_display = ('created_at', 'admin_name', 'action', 'target_type', 'target_label')
    list_filter = ('action', 'target_type', 'created_at')
    search_fields = ('admin_name', 'action', 'target_label', 'target_id')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'


# ───────────── backend internals ─────────────

@admin.register(m.Job, site=site)
class JobAdmin(ReadOnlyAdmin):
    list_display = ('id', 'kind', 'status', 'attempts', 'created_at', 'run_after', 'done_at', 'last_error')
    list_filter = ('status', 'kind', 'created_at')
    search_fields = ('kind', 'last_error')
    ordering = ('-created_at',)
