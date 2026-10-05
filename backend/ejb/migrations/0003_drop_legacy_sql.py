"""The app's rules, triggers and functions now live in Python (ejb/). This drops
their old SQL versions from databases that still have them (production at the
switch to Django; see README). Irreversible on purpose."""
from django.db import migrations

import ejb.data_migrations


class Migration(migrations.Migration):
    dependencies = [('ejb', '0002_today_additions')]

    operations = [
        migrations.RunPython(ejb.data_migrations.drop_legacy_sql, migrations.RunPython.noop),
    ]
