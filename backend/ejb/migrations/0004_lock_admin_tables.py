"""Django admin tables (auth_*, django_admin_log, django_content_type,
django_session): created by Django's own apps in public. Turn row-level
security on for every public table again (deny-all without policies, like
0003), so Supabase's API with its default grants cannot read or write them.
Only this backend (the table owner) uses them. Safe to run more than once.
"""
from django.db import migrations


def lock_public_tables(apps, schema_editor):
    with schema_editor.connection.cursor() as c:
        c.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        for (table,) in c.fetchall():
            c.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        c.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
        roles = [r[0] for r in c.fetchall()]
        if roles:
            for table in ('auth_user', 'auth_user_groups', 'auth_user_user_permissions', 'auth_group',
                          'auth_group_permissions', 'auth_permission', 'django_admin_log',
                          'django_content_type', 'django_session'):
                c.execute('SELECT to_regclass(%s)', [f'public.{table}'])
                if c.fetchone()[0]:
                    c.execute(f'REVOKE ALL ON public."{table}" FROM {", ".join(roles)}')


class Migration(migrations.Migration):
    dependencies = [
        ('ejb', '0003_drop_legacy_sql'),
        ('auth', '0012_alter_user_first_name_max_length'),
        ('admin', '0003_logentry_add_action_flag_choices'),
        ('contenttypes', '0002_remove_content_type_name'),
        ('sessions', '0001_initial'),
    ]

    operations = [migrations.RunPython(lock_public_tables, migrations.RunPython.noop)]
