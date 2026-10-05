"""The ejaBashkohu data model.

Every table of the app, with the same names, columns, constraints and indexes
as the database had under Supabase, so production keeps its data as is. All
behaviour (permissions, limits, notifications, matching...) lives in Python:
see services/ and signals.py. Constraint and index names match the existing
database so Django migrations line up with it.
"""
import secrets
import uuid
from datetime import timedelta

from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Length
from django.utils import timezone

models.TextField.register_lookup(Length)

CASCADE, SET_NULL, PROTECT = models.CASCADE, models.SET_NULL, models.PROTECT


def text_list(default=list, **kw):
    return ArrayField(models.TextField(), default=default, **kw)


def in_(field, values):
    return Q(**{f'{field}__in': values})


def length_between(field, lo, hi):
    return Q(**{f'{field}__length__gte': lo, f'{field}__length__lte': hi})


# ───────────────────────── accounts (auth schema) ─────────────────────────

def default_langs():
    return ['Shqip']


def default_teach_langs():
    return ['sq']


class AuthUser(models.Model):
    """Accounts. Lives in auth.users (where Supabase Auth kept them), so ids,
    emails and bcrypt password hashes carry over unchanged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    instance_id = models.UUIDField(null=True, blank=True)
    aud = models.CharField(max_length=255, null=True, default='authenticated')
    role = models.CharField(max_length=255, null=True, default='authenticated')
    email = models.CharField(max_length=255, null=True)
    encrypted_password = models.CharField(max_length=255, null=True)
    email_confirmed_at = models.DateTimeField(null=True)
    confirmation_sent_at = models.DateTimeField(null=True)
    recovery_sent_at = models.DateTimeField(null=True)
    last_sign_in_at = models.DateTimeField(null=True)
    raw_app_meta_data = models.JSONField(null=True, default=dict)
    raw_user_meta_data = models.JSONField(null=True, default=dict)
    created_at = models.DateTimeField(null=True, default=timezone.now)
    updated_at = models.DateTimeField(null=True, default=timezone.now)
    banned_until = models.DateTimeField(null=True)
    deleted_at = models.DateTimeField(null=True)
    phone = models.TextField(null=True)
    is_anonymous = models.BooleanField(default=False)

    class Meta:
        db_table = 'auth"."users'

    def __str__(self):
        return self.email or str(self.id)


class Identity(models.Model):
    """Sign-in methods of an account (email, google, apple)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    provider_id = models.TextField()
    user = models.ForeignKey(AuthUser, on_delete=CASCADE, related_name='identities')
    identity_data = models.JSONField(default=dict)
    provider = models.TextField()
    last_sign_in_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(null=True, default=timezone.now)
    updated_at = models.DateTimeField(null=True, default=timezone.now)
    email = models.TextField(null=True)

    class Meta:
        db_table = 'auth"."identities'
        constraints = [models.UniqueConstraint(fields=['provider_id', 'provider'], name='identities_provider_id_provider_unique')]


class RefreshToken(models.Model):
    token_hash = models.TextField(primary_key=True)
    user = models.ForeignKey(AuthUser, on_delete=CASCADE, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'backend"."refresh_tokens'
        indexes = [models.Index(fields=['user'], name='idx_refresh_tokens_user')]


class AuthToken(models.Model):
    """One-time email links (confirmation, password reset)."""
    token_hash = models.TextField(primary_key=True)
    user = models.ForeignKey(AuthUser, on_delete=CASCADE, related_name='+')
    kind = models.TextField()
    redirect_to = models.TextField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'backend"."auth_tokens'
        indexes = [models.Index(fields=['user', 'kind'], name='idx_auth_tokens_user')]
        constraints = [models.CheckConstraint(condition=in_('kind', ['signup', 'recovery']), name='auth_tokens_kind_check')]


class Job(models.Model):
    """Background work run by the worker (emails, account deletion)."""
    id = models.BigAutoField(primary_key=True)
    kind = models.TextField()
    payload = models.JSONField(default=dict)
    status = models.TextField(default='pending')
    attempts = models.IntegerField(default=0)
    last_error = models.TextField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    run_after = models.DateTimeField(default=timezone.now)
    done_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'backend"."jobs'
        indexes = [models.Index(fields=['run_after'], name='idx_jobs_pending', condition=Q(status='pending'))]
        constraints = [models.CheckConstraint(condition=in_('status', ['pending', 'running', 'done', 'failed']), name='jobs_status_check')]


class StorageObject(models.Model):
    pk = models.CompositePrimaryKey('bucket', 'path')
    bucket = models.TextField()
    path = models.TextField()
    owner = models.UUIDField(null=True)
    size = models.BigIntegerField(default=0)
    content_type = models.TextField(null=True)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'backend"."storage_objects'


# ───────────────────────── people ─────────────────────────

class Profile(models.Model):
    user = models.OneToOneField(AuthUser, primary_key=True, db_column='id', on_delete=CASCADE, related_name='profile')
    first_name = models.TextField()
    last_name = models.TextField()
    age = models.IntegerField()
    photo_path = models.TextField(null=True)
    photo_face_ok = models.BooleanField(default=False)
    is_tourist = models.BooleanField(default=False)
    from_place = models.TextField(null=True)
    langs = text_list(default=default_langs)
    verified = models.BooleanField(default=False)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=5)
    tables_hosted = models.IntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)
    deactivated_at = models.DateTimeField(null=True)
    is_admin = models.BooleanField(default=False)
    user_preferences = models.JSONField(default=dict)
    onboarded_at = models.DateTimeField(null=True)
    home_city = models.TextField(null=True)
    home_city_changed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'profiles'
        indexes = [
            models.Index(fields=['created_at'], name='idx_profiles_created_at'),
            models.Index(fields=['user'], name='idx_profiles_deactivated', condition=Q(deactivated_at__isnull=False)),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(age__gte=18, age__lte=99), name='profiles_age_check'),
            models.CheckConstraint(condition=length_between('first_name', 1, 40), name='profiles_first_name_check'),
            models.CheckConstraint(condition=length_between('last_name', 1, 40), name='profiles_last_name_check'),
            models.CheckConstraint(condition=Q(rating__gte=0, rating__lte=5), name='profiles_rating_check'),
        ]

    @property
    def id(self):
        return self.user_id

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()


class TasteProfile(models.Model):
    user = models.OneToOneField(Profile, primary_key=True, on_delete=CASCADE, related_name='taste')
    group_size = models.TextField(null=True)
    depth = models.TextField(null=True)
    time_pref = models.TextField(null=True)
    energy = models.TextField(null=True)
    interests = text_list()
    field = models.TextField(null=True)
    biz_sport = models.TextField(null=True)
    weekend = models.TextField(null=True)
    role = models.TextField(null=True)
    music = models.TextField(null=True)
    freq = models.TextField(null=True)
    organizer = models.TextField(null=True)
    humor = models.TextField(null=True)
    new_people = models.TextField(null=True)
    done = models.BooleanField(default=False)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'taste_profiles'
        constraints = [
            models.CheckConstraint(condition=in_('depth', ['thella', 'argetim', 'te-dyja']), name='taste_profiles_depth_check'),
            models.CheckConstraint(condition=in_('energy', ['introvert', 'mes', 'ekstrovert']), name='taste_profiles_energy_check'),
            models.CheckConstraint(condition=in_('group_size', ['vogla', 'mesatare', 'medha']), name='taste_profiles_group_size_check'),
            models.CheckConstraint(condition=in_('time_pref', ['paradite', 'pasdite', 'mbremje']), name='taste_profiles_time_pref_check'),
        ]


class Affinity(models.Model):
    pk = models.CompositePrimaryKey('user_id', 'category')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    category = models.TextField()
    score = models.IntegerField(default=0)

    class Meta:
        db_table = 'affinity'
        constraints = [models.CheckConstraint(condition=Q(score__gte=-40, score__lte=40), name='affinity_score_check')]


class Badge(models.Model):
    pk = models.CompositePrimaryKey('user_id', 'badge_id')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    badge_id = models.TextField()
    earned_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'badges'


class Block(models.Model):
    pk = models.CompositePrimaryKey('blocker_id', 'blocked_id')
    blocker = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    blocked = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'blocks'
        indexes = [models.Index(fields=['blocked'], name='idx_blocks_blocked')]
        constraints = [models.CheckConstraint(condition=~Q(blocker=F('blocked')), name='blocks_check')]


class Ban(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    reason = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'bans'
        indexes = [models.Index(fields=['created_at'], name='idx_bans_created_at'),
                   models.Index(fields=['user'], name='idx_bans_user')]


class Connection(models.Model):
    """Two people who picked each other after a table (a < b)."""
    pk = models.CompositePrimaryKey('a', 'b')
    a = models.ForeignKey(Profile, on_delete=CASCADE, db_column='a', related_name='+')
    b = models.ForeignKey(Profile, on_delete=CASCADE, db_column='b', related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'connections'
        indexes = [models.Index(fields=['b'], name='idx_connections_b')]
        constraints = [models.CheckConstraint(condition=Q(a__lt=F('b')), name='connections_check')]


# ───────────────────────── tables (and rides, trips, sports) ─────────────────────────

MAPS_LINK_RE = r'^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)'
TABLE_KINDS = ['tavoline', 'vozitje', 'udhetim', 'darka_e_merkures', 'sport']
SPORTS = ['football', 'basketball', 'volleyball', 'tennis', 'padel', 'table_tennis', 'badminton', 'running', 'fitness']
SKILL_LEVELS = ['any', 'beginner', 'intermediate', 'advanced']
SHARE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'  # no 0/o/1/l/i



def new_share_code():
    return ''.join(secrets.choice(SHARE_ALPHABET) for _ in range(8))


class Table(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    host = models.ForeignKey(Profile, on_delete=CASCADE, related_name='hosted_tables')
    kind = models.TextField(default='tavoline')
    category = models.TextField()
    title = models.TextField()
    area = models.TextField(null=True)
    city = models.TextField()
    to_city = models.TextField(null=True)
    budget = models.TextField(null=True)
    maps_link = models.TextField(null=True)
    time_label = models.TextField()
    starts_at = models.DateTimeField(null=True)
    spots = models.IntegerField()
    women_only = models.BooleanField(default=False)
    mystery = models.BooleanField(default=False)
    revealed = models.BooleanField(default=True)
    langs = text_list(default=default_langs)
    tags = text_list()
    description = models.TextField(default='')
    status = models.TextField(default='open')
    created_at = models.DateTimeField(default=timezone.now)
    event_datetime = models.DateTimeField()
    men_only = models.BooleanField(default=False)
    sport = models.TextField(null=True)
    skill_level = models.TextField(null=True)
    share_code = models.TextField(default=new_share_code)
    activity_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'tables'
        indexes = [
            models.Index(fields=['city', 'category'], name='idx_tables_city_cat', condition=Q(status='open')),
            models.Index(fields=['city', 'sport'], name='idx_tables_city_sport', condition=Q(status='open', kind='sport')),
            models.Index(fields=['city', 'event_datetime'], name='idx_tables_city_time', condition=Q(status='open')),
            models.Index(fields=['created_at'], name='idx_tables_created_at'),
            models.Index(fields=['event_datetime'], name='idx_tables_event_datetime', condition=Q(status='open')),
            models.Index(fields=['host'], name='idx_tables_host'),
        ]
        constraints = [
            models.UniqueConstraint(F('share_code'), name='tables_share_code_key'),  # unique index, as live
            models.CheckConstraint(condition=Q(event_datetime__gt=F('created_at') - timedelta(minutes=5)), name='event_datetime_future'),
            models.CheckConstraint(condition=in_('kind', TABLE_KINDS), name='tables_kind_check'),
            models.CheckConstraint(condition=Q(maps_link__isnull=True) | Q(maps_link__iregex=MAPS_LINK_RE), name='tables_maps_link_check'),
            models.CheckConstraint(condition=Q(skill_level__isnull=True) | in_('skill_level', SKILL_LEVELS), name='tables_skill_level_valid'),
            models.CheckConstraint(
                condition=(Q(kind='sport', sport__isnull=False, category='sport')
                           | (~Q(kind='sport') & Q(sport__isnull=True, skill_level__isnull=True))),
                name='tables_sport_consistency'),
            models.CheckConstraint(condition=Q(sport__isnull=True) | in_('sport', SPORTS), name='tables_sport_valid'),
            models.CheckConstraint(
                condition=Q(spots__gte=1) & ((Q(kind='sport') & Q(spots__lte=30)) | (~Q(kind='sport') & Q(spots__lte=20))),
                name='tables_spots_check'),
            models.CheckConstraint(condition=in_('status', ['open', 'full', 'done', 'cancelled']), name='tables_status_check'),
            models.CheckConstraint(condition=length_between('title', 2, 120), name='tables_title_check'),
        ]


class Membership(models.Model):
    pk = models.CompositePrimaryKey('table_id', 'user_id')
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='memberships')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='memberships')
    role = models.TextField(default='member')
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'memberships'
        indexes = [models.Index(fields=['joined_at'], name='idx_memberships_joined_at'),
                   models.Index(fields=['user'], name='idx_memberships_user')]
        constraints = [models.CheckConstraint(condition=in_('role', ['host', 'member']), name='memberships_role_check')]


class Request(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='requests')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='requests')
    status = models.TextField(default='pending')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'requests'
        indexes = [models.Index(fields=['table'], name='idx_requests_table', condition=Q(status='pending')),
                   models.Index(fields=['user'], name='idx_requests_user')]
        constraints = [
            models.UniqueConstraint(fields=['table', 'user'], name='requests_table_id_user_id_key'),
            models.CheckConstraint(condition=in_('status', ['pending', 'approved', 'rejected', 'confirmed', 'expired']), name='requests_status_check'),
        ]


class Waitlist(models.Model):
    pk = models.CompositePrimaryKey('table_id', 'user_id')
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='waitlist')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'waitlist'
        indexes = [models.Index(fields=['user'], name='idx_waitlist_user')]


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='messages')
    sender = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    body = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'messages'
        indexes = [models.Index(fields=['table', 'created_at'], name='idx_messages_table')]
        constraints = [models.CheckConstraint(condition=length_between('body', 1, 2000), name='messages_body_check')]


class Rating(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='+')
    rater = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    stars = models.IntegerField()
    meet_again = models.BooleanField(null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'ratings'
        indexes = [models.Index(fields=['rater'], name='idx_ratings_rater')]
        constraints = [
            models.UniqueConstraint(fields=['table', 'rater'], name='ratings_table_id_rater_id_key'),
            models.CheckConstraint(condition=Q(stars__gte=1, stars__lte=5), name='ratings_stars_check'),
        ]


class ConnectionPick(models.Model):
    pk = models.CompositePrimaryKey('table_id', 'picker_id', 'picked_id')
    table = models.ForeignKey(Table, on_delete=CASCADE, related_name='+')
    picker = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    picked = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'connection_picks'
        constraints = [models.CheckConstraint(condition=~Q(picker=F('picked')), name='connection_picks_check')]


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    reporter = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    reported = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    table = models.ForeignKey(Table, null=True, on_delete=SET_NULL, related_name='+')
    reason = models.TextField()
    details = models.TextField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    status = models.TextField(default='pending')
    reviewed_by = models.ForeignKey(Profile, null=True, on_delete=models.DO_NOTHING, db_column='reviewed_by', related_name='+')
    reviewed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'reports'
        indexes = [models.Index(fields=['reported'], name='idx_reports_reported')]
        constraints = [models.CheckConstraint(
            condition=in_('status', ['pending', 'reviewed_banned', 'reviewed_dismissed', 'deleted_immediately']),
            name='reports_status_check')]


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='notifications')
    icon = models.TextField(default='🔔')
    body = models.TextField()
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    kind = models.TextField(null=True)
    params = models.JSONField(default=dict)

    class Meta:
        db_table = 'notifications'
        indexes = [models.Index(fields=['kind'], name='idx_notifications_kind'),
                   models.Index(fields=['user', 'read', '-created_at'], name='idx_notifications_user')]


class NotificationTextRule(models.Model):
    """Recognises the kind/params of notifications written as plain text
    (old rows and old app versions), so they can be shown in any language."""
    id = models.AutoField(primary_key=True)
    kind = models.TextField()
    lang = models.TextField()
    pattern = models.TextField()
    param_names = text_list()
    priority = models.IntegerField(default=50)

    class Meta:
        db_table = 'notification_text_rules'
        constraints = [models.UniqueConstraint(fields=['kind', 'lang', 'pattern'], name='notification_text_rules_kind_lang_pattern_key')]


class NotificationBadgeLabel(models.Model):
    label = models.TextField(primary_key=True)
    badge_key = models.TextField()

    class Meta:
        db_table = 'notification_badge_labels'


# ───────────────────────── money ─────────────────────────

class Plan(models.Model):
    id = models.TextField(primary_key=True)
    tier = models.TextField()
    months = models.IntegerField(null=True)
    price_cents = models.IntegerField(default=0)
    monthly_table_limit = models.IntegerField(null=True)
    monthly_join_limit = models.IntegerField(null=True)
    active = models.BooleanField(default=True)
    sort = models.IntegerField(default=0)

    class Meta:
        db_table = 'plans'
        constraints = [
            models.CheckConstraint(condition=(Q(tier='basic') & Q(months__isnull=True)) | (~Q(tier='basic') & Q(months__isnull=False)), name='plans_check'),
            models.CheckConstraint(condition=Q(monthly_join_limit__isnull=True) | Q(monthly_join_limit__gte=0, monthly_join_limit__lte=1000), name='plans_monthly_join_limit_check'),
            models.CheckConstraint(condition=Q(monthly_table_limit__isnull=True) | Q(monthly_table_limit__gte=0, monthly_table_limit__lte=1000), name='plans_monthly_table_limit_check'),
            models.CheckConstraint(condition=Q(months__isnull=True) | Q(months__gte=1, months__lte=36), name='plans_months_check'),
            models.CheckConstraint(condition=Q(price_cents__gte=0), name='plans_price_cents_check'),
            models.CheckConstraint(condition=in_('tier', ['basic', 'premium']), name='plans_tier_check'),
        ]


class Subscription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='subscriptions')
    plan = models.ForeignKey(Plan, on_delete=models.DO_NOTHING, related_name='+')
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.TextField(default='active')
    source = models.TextField()
    amount_cents = models.IntegerField(default=0)
    provider_ref = models.TextField(null=True)
    note = models.TextField(null=True)
    created_by = models.ForeignKey(Profile, null=True, on_delete=SET_NULL, db_column='created_by', related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'subscriptions'
        indexes = [models.Index(fields=['user', '-ends_at'], name='idx_subscriptions_user')]
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=F('starts_at')), name='subscriptions_check'),
            models.CheckConstraint(condition=in_('source', ['admin_grant', 'manual_payment', 'provider']), name='subscriptions_source_check'),
            models.CheckConstraint(condition=in_('status', ['active', 'revoked']), name='subscriptions_status_check'),
        ]


def new_order_code():
    return 'EBP-' + uuid.uuid4().hex[:6].upper()


class SubscriptionOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    code = models.TextField(default=new_order_code)
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    plan = models.ForeignKey(Plan, on_delete=models.DO_NOTHING, related_name='+')
    amount_cents = models.IntegerField()
    status = models.TextField(default='pending')
    subscription = models.ForeignKey(Subscription, null=True, on_delete=SET_NULL, related_name='+')
    handled_by = models.ForeignKey(Profile, null=True, on_delete=SET_NULL, db_column='handled_by', related_name='+')
    handled_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'subscription_orders'
        constraints = [
            models.UniqueConstraint(fields=['code'], name='subscription_orders_code_key'),
            models.UniqueConstraint(fields=['user'], condition=Q(status='pending'), name='uq_one_pending_order'),
            models.CheckConstraint(condition=in_('status', ['pending', 'paid', 'cancelled']), name='subscription_orders_status_check'),
        ]


# ───────────────────────── lessons ─────────────────────────

class Tutor(models.Model):
    user = models.OneToOneField(Profile, primary_key=True, on_delete=CASCADE, related_name='tutor')
    status = models.TextField(default='pending')
    headline = models.TextField()
    bio = models.TextField()
    subjects = text_list(default=None)
    teach_langs = text_list(default=default_teach_langs)
    price_cents = models.IntegerField()
    online = models.BooleanField(default=True)
    in_person = models.BooleanField(default=False)
    group_ok = models.BooleanField(default=False)
    city = models.TextField()
    lat = models.FloatField(null=True)
    lng = models.FloatField(null=True)
    years_experience = models.IntegerField(default=0)
    education = models.TextField(null=True)
    rejection_reason = models.TextField(null=True)
    reviewed_by = models.ForeignKey(Profile, null=True, on_delete=SET_NULL, db_column='reviewed_by', related_name='+')
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'tutors'
        indexes = [models.Index(fields=['status'], name='idx_tutors_status'),
                   GinIndex(fields=['subjects'], name='idx_tutors_subjects')]
        constraints = [
            models.CheckConstraint(condition=length_between('bio', 30, 2000), name='tutors_bio_check'),
            models.CheckConstraint(condition=Q(online=True) | Q(in_person=True), name='tutors_check'),
            models.CheckConstraint(condition=Q(education__isnull=True) | Q(education__length__lte=200), name='tutors_education_check'),
            models.CheckConstraint(condition=length_between('headline', 5, 120), name='tutors_headline_check'),
            models.CheckConstraint(condition=Q(lat__isnull=True) | Q(lat__gte=-90, lat__lte=90), name='tutors_lat_check'),
            models.CheckConstraint(condition=Q(lng__isnull=True) | Q(lng__gte=-180, lng__lte=180), name='tutors_lng_check'),
            models.CheckConstraint(condition=Q(price_cents__gte=0, price_cents__lte=20000), name='tutors_price_cents_check'),
            models.CheckConstraint(condition=in_('status', ['pending', 'approved', 'rejected', 'suspended']), name='tutors_status_check'),
            models.CheckConstraint(condition=Q(subjects__len__gte=1, subjects__len__lte=12), name='tutors_subjects_check'),
            models.CheckConstraint(condition=Q(years_experience__gte=0, years_experience__lte=60), name='tutors_years_experience_check'),
        ]


class LessonSubject(models.Model):
    id = models.TextField(primary_key=True)
    category = models.TextField()
    sort = models.IntegerField(default=0)

    class Meta:
        db_table = 'lesson_subjects'


class Lesson(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tutor = models.ForeignKey(Tutor, on_delete=CASCADE, related_name='lessons')
    subject = models.ForeignKey(LessonSubject, on_delete=models.DO_NOTHING, db_column='subject', related_name='+')
    kind = models.TextField()
    title = models.TextField(null=True)
    starts_at = models.DateTimeField()
    duration_min = models.IntegerField()
    format = models.TextField()
    location_note = models.TextField(null=True)
    max_students = models.IntegerField()
    price_cents = models.IntegerField()
    status = models.TextField(default='scheduled')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'lessons'
        indexes = [
            models.Index(fields=['subject', 'starts_at'], name='idx_lessons_group_upcoming', condition=Q(kind='group', status='scheduled')),
            models.Index(fields=['tutor', 'starts_at'], name='idx_lessons_tutor'),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(kind='group') | Q(max_students=1), name='lessons_check'),
            models.CheckConstraint(condition=in_('duration_min', [30, 45, 60, 90, 120]), name='lessons_duration_min_check'),
            models.CheckConstraint(condition=in_('format', ['online', 'in_person']), name='lessons_format_check'),
            models.CheckConstraint(condition=in_('kind', ['individual', 'group']), name='lessons_kind_check'),
            models.CheckConstraint(condition=Q(location_note__isnull=True) | Q(location_note__length__lte=200), name='lessons_location_note_check'),
            models.CheckConstraint(condition=Q(max_students__gte=1, max_students__lte=30), name='lessons_max_students_check'),
            models.CheckConstraint(condition=Q(price_cents__gte=0, price_cents__lte=100000), name='lessons_price_cents_check'),
            models.CheckConstraint(condition=in_('status', ['scheduled', 'cancelled']), name='lessons_status_check'),
            models.CheckConstraint(condition=Q(title__isnull=True) | length_between('title', 3, 120), name='lessons_title_check'),
        ]


class LessonParticipant(models.Model):
    pk = models.CompositePrimaryKey('lesson_id', 'student_id')
    lesson = models.ForeignKey(Lesson, on_delete=CASCADE, related_name='participants')
    student = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    status = models.TextField(default='requested')
    note = models.TextField(null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'lesson_participants'
        indexes = [models.Index(fields=['student'], name='idx_lesson_participants_student')]
        constraints = [
            models.CheckConstraint(condition=Q(note__isnull=True) | Q(note__length__lte=500), name='lesson_participants_note_check'),
            models.CheckConstraint(condition=in_('status', ['requested', 'accepted', 'confirmed', 'declined', 'cancelled']), name='lesson_participants_status_check'),
        ]


def new_room_key():
    return uuid.uuid4().hex + uuid.uuid4().hex


class LessonRoom(models.Model):
    lesson = models.OneToOneField(Lesson, primary_key=True, on_delete=CASCADE, related_name='room')
    room_key = models.TextField(default=new_room_key)

    class Meta:
        db_table = 'lesson_rooms'


class Payment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(Profile, null=True, on_delete=SET_NULL, related_name='+')
    table = models.ForeignKey(Table, null=True, on_delete=SET_NULL, related_name='+')
    amount_cents = models.IntegerField()
    currency = models.TextField(default='EUR')
    provider = models.TextField()
    provider_ref = models.TextField()
    status = models.TextField(default='paid')
    ticket_code = models.TextField(null=True)
    refundable = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    payer_name = models.TextField(null=True)
    table_title = models.TextField(null=True)
    lesson = models.ForeignKey(Lesson, null=True, on_delete=SET_NULL, related_name='+')
    subscription = models.ForeignKey(Subscription, null=True, on_delete=SET_NULL, related_name='+')

    class Meta:
        db_table = 'payments'
        indexes = [models.Index(fields=['created_at'], name='idx_payments_created_at'),
                   models.Index(fields=['table'], name='idx_payments_table')]
        constraints = [
            models.UniqueConstraint(fields=['ticket_code'], name='payments_ticket_code_key'),
            models.UniqueConstraint(fields=['user', 'table'], name='payments_user_id_table_id_key'),
            models.UniqueConstraint(fields=['user', 'lesson'], condition=Q(lesson__isnull=False), name='uq_payments_user_lesson'),
            models.CheckConstraint(condition=Q(amount_cents__gte=0), name='payments_amount_cents_check'),
            models.CheckConstraint(condition=in_('status', ['paid', 'failed', 'void']), name='payments_status_check'),
        ]


# ───────────────────────── Wednesday dinner ─────────────────────────

class WednesdayRestaurant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.TextField()
    city = models.TextField()
    address = models.TextField()
    maps_link = models.TextField(null=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = 'wednesday_restaurants'


class WednesdayGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    city = models.TextField()
    dinner_date = models.DateTimeField()
    restaurant = models.ForeignKey(WednesdayRestaurant, on_delete=models.DO_NOTHING, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    table = models.ForeignKey(Table, null=True, on_delete=SET_NULL, related_name='+')

    class Meta:
        db_table = 'wednesday_groups'


class WednesdayParticipant(models.Model):
    pk = models.CompositePrimaryKey('group_id', 'user_id')
    group = models.ForeignKey(WednesdayGroup, on_delete=CASCADE, related_name='participants')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')

    class Meta:
        db_table = 'wednesday_participants'


class WednesdaySignup(models.Model):
    pk = models.CompositePrimaryKey('user_id', 'dinner_date')
    user = models.ForeignKey(Profile, on_delete=CASCADE, related_name='+')
    dinner_date = models.DateTimeField()
    city = models.TextField()
    langs = text_list()
    status = models.TextField(default='signed_up')
    premium = models.BooleanField(default=False)
    group = models.ForeignKey(WednesdayGroup, null=True, on_delete=SET_NULL, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'wednesday_signups'
        indexes = [models.Index(fields=['dinner_date', 'city'], name='idx_wed_signups_open', condition=Q(status='signed_up'))]
        constraints = [models.CheckConstraint(condition=in_('status', ['signed_up', 'grouped', 'waitlisted', 'cancelled']), name='wednesday_signups_status_check')]


# ───────────────────────── admin ─────────────────────────

class AdminAuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    admin = models.ForeignKey(Profile, null=True, on_delete=SET_NULL, related_name='+')
    admin_name = models.TextField(null=True)
    action = models.TextField()
    target_type = models.TextField()
    target_id = models.UUIDField(null=True)
    target_label = models.TextField(null=True)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'admin_audit_log'
        indexes = [models.Index(fields=['-created_at'], name='idx_admin_audit_created')]
