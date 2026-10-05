"""Make a database built by Django's migrations identical to the live one.

Django names foreign keys `<table>_<col>_<hash>_fk_…`, makes them DEFERRABLE,
leaves ON DELETE to the ORM and adds an index per foreign key. The live
database (and anything that deletes rows outside the ORM, like the
account-deletion job) relies on Postgres-level `ON DELETE CASCADE / SET NULL`
under the classic `<table>_<col>_fkey` names. This step rewrites them.
Production already has this shape, so there 0001 is faked and this never runs.
"""
import re
from django.db import models

ACTIONS = {models.CASCADE: 'CASCADE', models.SET_NULL: 'SET NULL'}


def _qt(db_table):
    # 'auth"."users' -> "auth"."users"
    return f'"{db_table}"'


def align(apps, schema_editor):
    conn = schema_editor.connection
    # Django creates FKs/indexes at the end of the migration; do it now so we can rewrite them.
    for sql in schema_editor.deferred_sql:
        schema_editor.execute(sql)
    schema_editor.deferred_sql.clear()
    with conn.cursor() as cur:
        for model in apps.get_app_config('ejb').get_models():
            table = model._meta.db_table
            short = table.split('"."')[-1]
            for f in model._meta.local_fields:
                if not f.is_relation or not f.db_constraint:
                    continue
                cur.execute(
                    """select con.conname from pg_constraint con
                       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
                       where con.contype = 'f' and con.conrelid = %s::regclass and a.attname = %s""",
                    [_qt(table), f.column])
                for (name,) in cur.fetchall():
                    cur.execute(f'alter table {_qt(table)} drop constraint "{name}"')
                target = f.related_model._meta
                action = ACTIONS.get(f.remote_field.on_delete, 'NO ACTION')
                cur.execute(
                    f'alter table {_qt(table)} add constraint "{short}_{f.column}_fkey" '
                    f'foreign key ("{f.column}") references {_qt(target.db_table)}("{target.pk.column}") '
                    f'on delete {action}')
        # Indexes Django adds on its own (per-FK and *_like) are not in the live schema.
        cur.execute("""select schemaname, indexname from pg_indexes
                       where schemaname in ('public','backend') and indexname ~ '_[0-9a-f]{8}(_like)?$'""")
        for schema, name in cur.fetchall():
            cur.execute(f'drop index "{schema}"."{name}"')
