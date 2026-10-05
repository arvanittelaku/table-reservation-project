"""python manage.py seed_dev — sample data for LOCAL development only.

Admin: support@ejabashkohu.com / Test1234!   Users: <first>.<last>@gmail.com / Test1234!
Writes through the models, so the hooks (profiles, host memberships,
notifications, counters) fill in everything the old SQL triggers did.
"""
import hashlib
import random
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core import passwords
from ejb import context
from ejb.context import Actor
from ejb.models import (
    AuthUser, Ban, Block, Job, Membership, Message, Payment, Profile, Report, Request, Table, WednesdayGroup,
    WednesdayParticipant, WednesdayRestaurant,
)

FIRST = ['Arta', 'Blerim', 'Donika', 'Erion', 'Fjolla', 'Gentrit', 'Hana', 'Ilir', 'Jeta', 'Kushtrim', 'Lirije',
         'Mergim', 'Nora', 'Orik', 'Pranvera', 'Qendrim', 'Rina', 'Shkumbin', 'Teuta', 'Uran', 'Vesa', 'Ylli', 'Zana',
         'Agon', 'Besa', 'Dardan', 'Elira', 'Fatos', 'Gresa', 'Lorik', 'Mimoza', 'Njomza', 'Petrit', 'Rrezarta',
         'Sara', 'Valon', 'Dua', 'Liam', 'Emma', 'Lukas', 'Ana', 'Marko', 'Elena', 'Stefan', 'Mia', 'Noah']
LAST = ['Krasniqi', 'Gashi', 'Berisha', 'Morina', 'Hoxha', 'Shala', 'Bytyqi', 'Kelmendi', 'Rexhepi', 'Hasani',
        'Musliu', 'Zeqiri', 'Rama', 'Ahmeti', 'Sylaj', 'Dervishi', 'Halili', 'Mustafa', 'Osmani', 'Ismaili',
        'Kastrati', 'Avdiu', 'Thaçi', 'Begolli', 'Hyseni', 'Maloku', 'Dobruna', 'Jashari', 'Leka', 'Bajrami',
        'Pllana', 'Tahiri', 'Kryeziu', 'Salihu', 'Gjoka', 'Mehmeti', 'Lipa', 'Weber', 'Schmidt', 'Müller',
        'Petrovska', 'Nikolov', 'Stojanova', 'Jovanov', 'Fischer', 'Brown']
CAFES = ['Soma Book Station', "Dit' e Nat'", 'Liburnia', 'Baklori', 'Te Komiteti', 'Cafe Prishtina', 'Home Made',
         'Pishat', 'Old Bazaar Gjakovë', 'Marashi Prizren']
RIDES = ['Prishtinë → Prizren', 'Pejë → Prishtinë', 'Prishtinë → Shkup', 'Gjakovë → Prishtinë']
TRIPS = ['Rugova weekend', 'Brezovica ski', 'Valbonë hike']
CITIES = ['Prishtinë', 'Prishtinë', 'Prishtinë', 'Prizren', 'Pejë', 'Gjakovë', 'Ferizaj']
CATS = ['kafe', 'ushqim', 'sport', 'natyre', 'kulture']
PASSWORD = 'Test1234!'
ADMIN_ID = uuid.UUID('00000000-0000-0000-0000-00000000000a')


def h(*parts):
    return int(hashlib.md5('|'.join(map(str, parts)).encode()).hexdigest(), 16)


class Command(BaseCommand):
    help = 'Fill an empty local database with sample data (never on production).'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true', help='seed even if accounts exist')

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError('seed_dev only runs with DEBUG=1 (local development)')
        if AuthUser.objects.exists() and not opts['force']:
            raise CommandError('database already has accounts (use --force)')
        rnd = random.Random(42)
        now = timezone.now()
        pw = passwords.hash_password(PASSWORD)   # one hash for all sample accounts
        with context.acting(Actor.service()):
            self._seed(rnd, now, pw)
            Job.objects.all().delete()     # no emails for sample data
        self.stdout.write('seeded: %d users, %d tables, %d requests, %d memberships, %d payments' % (
            Profile.objects.count(), Table.objects.count(), Request.objects.count(),
            Membership.objects.count(), Payment.objects.count()))

    @transaction.atomic
    def _seed(self, rnd, now, pw):
        def user(uid, email, meta, created, confirmed, signed_in):
            u = AuthUser(id=uid, instance_id=uuid.UUID(int=0), email=email, encrypted_password=pw,
                         raw_app_meta_data={'provider': 'email', 'providers': ['email']},
                         raw_user_meta_data=meta, email_confirmed_at=confirmed, last_sign_in_at=signed_in,
                         created_at=created, updated_at=created)
            u.save(force_insert=True)        # hook creates the profile
            return Profile.objects.get(pk=uid)

        admin = user(ADMIN_ID, 'support@ejabashkohu.com',
                     {'first_name': 'Arvanit', 'last_name': 'Telaku', 'age': 29}, now - timedelta(days=80), now, now)
        admin.is_admin = True
        admin.created_at = now - timedelta(days=80)
        admin.onboarded_at = admin.created_at
        admin.save()

        people = []
        for fn, ln in zip(FIRST, LAST):
            created = now - timedelta(days=(rnd.random() ** 2) * 75)
            p = user(uuid.uuid4(), f"{fn.lower()}.{ln.lower().replace('ç', 'c')}@gmail.com",
                     {'first_name': fn, 'last_name': ln, 'age': 18 + int(rnd.random() * 30)}, created,
                     now if rnd.random() < 0.9 else None,
                     now - timedelta(days=rnd.random() * 20) if rnd.random() < 0.85 else None)
            p.created_at = created
            p.is_tourist = rnd.random() < 0.15
            p.from_place = 'Berlin' if rnd.random() < 0.15 else None
            p.onboarded_at = created      # every sample account finished onboarding
            p.save()
            people.append(p)

        hosts = rnd.sample(people, 18)
        tables = []
        for g in range(1, 65):
            kind = 'vozitje' if g % 6 == 0 else 'udhetim' if g % 13 == 0 else 'tavoline'
            created = now - timedelta(days=60 - g, hours=(g * 37) % 24)
            title = RIDES[g % 4] if kind == 'vozitje' else TRIPS[g % 3] if kind == 'udhetim' else CAFES[g % 10]
            t = Table(host_id=hosts[g % 18].pk, kind=kind,
                      category='vozitje' if kind == 'vozitje' else CATS[g % 5], title=title,
                      city=CITIES[g % 7], to_city='Prizren' if kind == 'vozitje' else None,
                      time_label='Ora 19:00', spots=2 + (g % 6), event_datetime=created + timedelta(days=1 + g % 9),
                      created_at=created, maps_link=f'https://maps.app.goo.gl/x{g}', women_only=(g % 11 == 0),
                      description='Hajde të njihemi! Tavolinë e hapur për këdo që do muhabet.')
            t.save()                       # hooks: host membership, tables hosted
            if t.title == 'Baklori' and t.event_datetime < now:
                t.status = 'cancelled'
                t.save()
            tables.append(t)

        others = [p for p in people]
        for t in tables:
            if t.status == 'cancelled':
                continue
            n = max(0, t.spots - 1 - h(t.pk) % 3)
            guests = sorted((p for p in others if p.pk != t.host_id), key=lambda p: h(p.pk, t.pk))[:n]
            for p in guests:
                at = t.created_at + timedelta(hours=2)
                r = Request(table_id=t.pk, user_id=p.pk, status='confirmed', created_at=at)
                r.save()
                Membership(table_id=t.pk, user_id=p.pk, role='member', joined_at=at).save()
                if t.kind != 'vozitje':
                    Payment(user_id=p.pk, table_id=t.pk, amount_cents=200, provider='stub',
                            provider_ref=f'STUB-{int(at.timestamp() * 1000)}',
                            ticket_code=f'EBK-{1000 + Payment.objects.count() + 1}', created_at=at).save()

        for t in tables:
            if not (t.event_datetime > now and t.status == 'open'):
                continue
            members = set(Membership.objects.filter(table_id=t.pk).values_list('user_id', flat=True))
            pool = [p for p in people if p.pk != t.host_id and p.pk not in members]
            for p in rnd.sample(pool, 2):
                Request(table_id=t.pk, user_id=p.pk, status=['pending', 'approved', 'pending'][h(p.pk) % 3],
                        created_at=now - timedelta(hours=3)).save()

        for m in Membership.objects.all().order_by('joined_at'):
            if rnd.random() < 0.6:
                Message(table_id=m.table_id, sender_id=m.user_id, body='Mirë se vini! Shihemi aty.',
                        created_at=m.joined_at + timedelta(hours=1)).save()

        ppl = list(Profile.objects.filter(is_admin=False).order_by('created_at'))
        by_rn = {i + 1: p for i, p in enumerate(ppl)}
        for a, b, reason, details, status, ago in [
                (3, 7, 'Foto e rreme', 'Personi në takim nuk ishte ai në foto. Dukej shumë më i vjetër.', 'pending', 5),
                (9, 7, 'Sjellje e papërshtatshme', 'Bëri komente të pahijshme gjatë darkës.', 'pending', 26),
                (12, 15, 'Spam', 'Dërgon link reklamash në chat.', 'pending', 50),
                (4, 21, 'Nuk erdhi', None, 'reviewed_dismissed', 120),
                (5, 30, 'Ngacmim', 'Mesazhe të vazhdueshme pas takimit.', 'reviewed_banned', 200)]:
            Report(reporter_id=by_rn[a].pk, reported_id=by_rn[b].pk, reason=reason, details=details,
                   status=status, created_at=now - timedelta(hours=ago)).save()
        for n, reason, ago in [(30, 'Ngacmim', 8), (30, 'Mesazhe abuzive', 2), (22, 'Profil i rremë', 15)]:
            Ban(user_id=by_rn[n].pk, reason=reason, created_at=now - timedelta(days=ago)).save()
        for a in (3, 9, 11):
            Block(blocker_id=by_rn[a].pk, blocked_id=by_rn[7].pk).save()
        gone = ppl[40]
        gone.deactivated_at = now - timedelta(days=4)
        gone.save()

        day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        restaurants = list(WednesdayRestaurant.objects.filter(city='Prishtinë'))
        for d in (day + timedelta(days=5, hours=20), day + timedelta(hours=12), day - timedelta(days=2) + timedelta(hours=20)):
            g = WednesdayGroup(city='Prishtinë', dinner_date=d,
                               restaurant_id=sorted(restaurants, key=lambda r: h(r.pk, d))[0].pk if restaurants else None)
            g.save()
            for p in sorted(ppl, key=lambda p: h(p.pk, g.pk))[:5]:
                WednesdayParticipant(group_id=g.pk, user_id=p.pk).save()

        for p in ppl:                      # home city: where they host most, else Prishtinë
            if p.home_city is None:
                counts = {}
                for c in Table.objects.filter(host_id=p.pk).values_list('city', flat=True):
                    counts[c] = counts.get(c, 0) + 1
                p.home_city = max(counts.items(), key=lambda kv: kv[1])[0] if counts else 'Prishtinë'
                p.save()
