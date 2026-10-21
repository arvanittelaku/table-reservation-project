#!/usr/bin/env python3
"""Merge the old env files into the single root .env (built from .env.example).

Run from the repo root:  python3 tools/merge_env.py
- Old files are read in this order, later ones win: backend/.env, hajde/.env,
  hajde/.env.local, hajde/.env.production.local, deploy/.env.production.
- Nothing is deleted: the old files are moved to .env-old/ (gitignored) afterwards.
- Values are never printed.
"""
import re, shutil, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
old_files = ['backend/.env', 'hajde/.env', 'hajde/.env.local',
             'hajde/.env.production.local', 'deploy/.env.production']
target = root / '.env'
if target.exists():
    old_files.append('.env')          # keep what is already in a root .env (wins over the rest)
    shutil.copy(target, root / '.env.bak')

def parse(path):
    out = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip()
        if v[:1] not in ('"', "'"):
            v = re.split(r'(?:^|\s+)#', v, maxsplit=1)[0].strip()      # drop trailing "# comment"
        out[k] = v
    return out

values, used = {}, []
for name in old_files:
    p = root / name
    if p.exists():
        values.update(parse(p)); used.append(name)
if not used:
    sys.exit('No old env files found.')

lines, seen = [], set()
for line in (root / '.env.example').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^([A-Z][A-Z0-9_]*)=', line)
    if m and m.group(1) in values:
        k = m.group(1); lines.append(f'{k}={values[k]}'); seen.add(k)
    else:
        lines.append(line)
extra = [k for k in values if k not in seen]
if extra:
    lines += ['', '# ───────── carried over from the old env files ─────────']
    lines += [f'{k}={values[k]}' for k in extra]
target.write_text('\n'.join(lines) + '\n', encoding='utf-8')

old = root / '.env-old'; old.mkdir(exist_ok=True)
for name in used:
    if name == '.env':
        continue
    shutil.move(str(root / name), str(old / name.replace('/', '__')))
print(f'Wrote .env from: {", ".join(used)}')
print(f'{len(seen)} keys filled in the template, {len(extra)} carried over: {", ".join(extra) or "-"}')
print('Old files moved to .env-old/ (delete that folder when everything works).')
