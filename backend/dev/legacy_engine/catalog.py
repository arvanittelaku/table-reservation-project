"""LEGACY (dev only, for dev/difftest.py)."""
"""What the API may touch: tables, columns, relationships and functions of the
`public` schema, read from Postgres' catalog (cached briefly)."""
import threading
import time
from dataclasses import dataclass, field

from django.db import connection

TTL = 30  # seconds; new migrations show up without a restart


@dataclass
class ForeignKey:
    name: str
    table: str
    columns: list
    ref_table: str
    ref_columns: list


@dataclass
class Table:
    name: str
    columns: dict = field(default_factory=dict)  # name -> SQL type
    pk: list = field(default_factory=list)


@dataclass
class Function:
    name: str
    oid: int
    args: list           # [(name, sql_type)] input args in order
    required: int        # number of leading args without defaults
    returns_set: bool
    return_type: str
    return_kind: str     # 'void' | 'composite' | 'scalar'


class Catalog:
    def __init__(self):
        self.tables = {}
        self.fks = []
        self.functions = {}
        self.loaded_at = 0

    def load(self, cur):
        cur.execute("""
            SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
            ORDER BY c.relname, a.attnum""")
        tables = {}
        for tname, col, typ in cur.fetchall():
            tables.setdefault(tname, Table(tname)).columns[col] = typ
        cur.execute("""
            SELECT c.relname, a.attname
            FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
            WHERE n.nspname = 'public' AND i.indisprimary ORDER BY c.relname, k.ord""")
        for tname, col in cur.fetchall():
            if tname in tables:
                tables[tname].pk.append(col)
        cur.execute("""
            SELECT con.conname, src.relname, ref.relname,
                   array(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(n, o)
                         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.o),
                   array(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(n, o)
                         JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.o)
            FROM pg_constraint con
            JOIN pg_class src ON src.oid = con.conrelid JOIN pg_namespace sn ON sn.oid = src.relnamespace
            JOIN pg_class ref ON ref.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = ref.relnamespace
            WHERE con.contype = 'f' AND sn.nspname = 'public' AND rn.nspname = 'public'""")
        fks = [ForeignKey(n, t, list(c), r, list(rc)) for n, t, r, c, rc in cur.fetchall()]
        cur.execute("""
            SELECT p.oid, p.proname, p.proretset, p.pronargs, p.pronargdefaults,
                   format_type(p.prorettype, NULL), t.typtype, t.typname,
                   COALESCE(p.proargnames, '{}'), COALESCE(p.proargmodes::text[], '{}'),
                   array(SELECT format_type(x, NULL) FROM unnest(p.proargtypes) x)
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_type t ON t.oid = p.prorettype
            WHERE n.nspname = 'public' AND p.prokind = 'f'""")
        functions = {}
        for oid, name, retset, nargs, ndefaults, rettype, typtype, typname, argnames, argmodes, argtypes in cur.fetchall():
            names = list(argnames)
            modes = list(argmodes) or ['i'] * len(names)
            input_names = [n for n, m in zip(names, modes) if m in ('i', 'b', 'v')] if names else []
            args = list(zip(input_names, list(argtypes)))
            kind = 'void' if typname == 'void' else ('composite' if typtype == 'c' or typname == 'record' else 'scalar')
            functions.setdefault(name, []).append(
                Function(name, oid, args, nargs - ndefaults, retset, rettype, kind))
        self.tables, self.fks, self.functions = tables, fks, functions
        self.loaded_at = time.time()


_catalog = Catalog()
_lock = threading.Lock()


def get_catalog(cur=None):
    if time.time() - _catalog.loaded_at > TTL:
        with _lock:
            if time.time() - _catalog.loaded_at > TTL:
                if cur is not None:
                    _catalog.load(cur)
                else:
                    with connection.cursor() as c:
                        _catalog.load(c)
    return _catalog


def invalidate():
    _catalog.loaded_at = 0
