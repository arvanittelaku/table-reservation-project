"""Write ejb/migrations/0001_initial.py as the schema production has today.

Input: the full folded migration (argv[1], e.g. 0001_full) and a database in
the production state (DB from settings, e.g. DB_NAME=ejb_prodlike). Keeps only
tables, columns, constraints and indexes that exist there with the same
definition, so `makemigrations` can produce 0002 = everything added since.
"""
import os, sys, importlib, re
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django; django.setup()
from django.db import connection, migrations
from django.db.migrations.writer import MigrationWriter
from django.db.migrations.state import ProjectState

full = importlib.import_module(f'ejb.migrations.{sys.argv[1]}').Migration
with connection.cursor() as c:
    c.execute("""select table_schema||'.'||table_name, column_name, is_nullable='YES'
                 from information_schema.columns where table_schema in ('public','backend','auth')""")
    cols = {}
    for t, col, nul in c.fetchall():
        cols.setdefault(t, {})[col] = nul
    c.execute("""select conname, pg_get_constraintdef(oid) from pg_constraint
                 where connamespace in (select oid from pg_namespace where nspname in ('public','backend','auth')) and contype in ('c','u')""")
    cons = dict(c.fetchall())
    c.execute("select indexname, indexdef from pg_indexes where schemaname in ('public','backend','auth')")
    idx = dict(c.fetchall())

def qual(db_table):
    return db_table.replace('"."', '.') if '"."' in db_table else 'public.' + db_table

# Constraints whose definition changed after production's state (same name):
# left out here; 0002 drops and recreates them.
CHANGED = {'tables_kind_check', 'tables_spots_check'}

keep_tables = set()
ops = []
for op in full.operations:
    if isinstance(op, migrations.CreateModel):
        db_table = op.options.get('db_table') or f'ejb_{op.name.lower()}'
        t = qual(db_table)
        if t not in cols:
            continue
        keep_tables.add(op.name.lower())
        newf = []
        for name, f in op.fields:
            f2 = f.clone(); f2.set_attributes_from_name(name)
            if getattr(f2, 'column', None) is None:      # CompositePrimaryKey
                newf.append((name, f)); continue
            if f2.column not in cols[t]:
                continue
            nul = cols[t][f2.column]
            if f2.null != nul and not f2.primary_key:
                f3 = f.clone(); f3.null = nul; newf.append((name, f3))
            else:
                newf.append((name, f))
        op.fields = newf
        ops.append(op)
    elif isinstance(op, (migrations.AddConstraint, migrations.AddIndex)):
        if op.model_name not in keep_tables:
            continue
        obj = op.constraint if isinstance(op, migrations.AddConstraint) else op.index
        if (obj.name in cons or obj.name in idx) and obj.name not in CHANGED:
            ops.append(op)
    elif isinstance(op, migrations.RunPython):
        ops.append(op)
    else:
        raise SystemExit(f'unexpected op {op}')

m = migrations.Migration('0001_initial', 'ejb'); m.initial = True
m.operations = ops; m.dependencies = full.dependencies
w = MigrationWriter(m); open(w.path, 'w').write(w.as_string())
print('baseline:', sum(isinstance(o, migrations.CreateModel) for o in ops), 'tables,', len(ops), 'ops')
