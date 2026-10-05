"""Fold AddField ops back into CreateModel and order models by FK dependency.
Needed because composite primary keys must see their FK columns at creation."""
import os, sys, importlib
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django; django.setup()
from django.db import migrations
from django.db.migrations.writer import MigrationWriter
name = sys.argv[1]
mod = importlib.import_module(f'ejb.migrations.{name}')
mig = mod.Migration
creates, rest, head = {}, [], []
order = []
for op in mig.operations:
    if isinstance(op, migrations.CreateModel):
        creates[op.name.lower()] = op; order.append(op.name.lower())
    elif isinstance(op, migrations.AddField) and op.model_name in creates:
        cm = creates[op.model_name]
        f = list(cm.fields); f.insert(1, (op.name, op.field)); cm.fields = f
    elif not creates and isinstance(op, (migrations.RunPython, migrations.RunSQL)):
        head.append(op)  # preparation steps stay first
    else:
        rest.append(op)
def deps(cm):
    out = set()
    for _, fld in cm.fields:
        rm = getattr(fld, 'remote_field', None)
        if rm is not None:
            t = rm.model if isinstance(rm.model, str) else rm.model._meta.label
            t = t.split('.')[-1].lower()
            if t in creates and t != cm.name.lower(): out.add(t)
    return out
done, seq = set(), []
def visit(n, stack=()):
    if n in done: return
    if n in stack: raise SystemExit(f'cycle at {n}')
    for d in sorted(deps(creates[n])): visit(d, stack + (n,))
    done.add(n); seq.append(creates[n])
for n in order: visit(n)
mig.operations = head + seq + rest
m = migrations.Migration(name, 'ejb'); m.operations = mig.operations
m.dependencies = mig.dependencies; m.initial = getattr(mig, 'initial', None)
w = MigrationWriter(m)
open(w.path, 'w').write(w.as_string())
print('folded', len(seq), 'models,', len(rest), 'other ops')
