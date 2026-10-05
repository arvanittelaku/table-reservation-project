"""Parsing of the app's query syntax (PostgREST style): select lists, filter lists."""
import re

from core.db import DbError


def split_top(s, sep=','):
    parts, depth, cur, quote = [], 0, [], False
    for ch in s:
        if ch == '"':
            quote = not quote
        if not quote:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == sep and depth == 0:
                parts.append(''.join(cur).strip())
                cur = []
                continue
        cur.append(ch)
    if ''.join(cur).strip():
        parts.append(''.join(cur).strip())
    return parts


def parse_select(s):
    """Returns a list of items: ('star',) | ('col', name, alias) | ('embed', rel, alias, hint, inner, items)."""
    s = re.sub(r'\s+', ' ', (s or '*').strip())
    items = []
    for part in split_top(s):
        if part == '*':
            items.append(('star',))
            continue
        m = re.match(r'^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)((?:\s*![A-Za-z_][A-Za-z0-9_]*)*)\s*(?:\((.*)\))?$', part, re.S)
        if not m:
            raise DbError(f'Could not parse select "{part}"', 'PGRST100', status=400)
        alias, name, bangs, inner = m.group(1), m.group(2), m.group(3), m.group(4)
        hints = [b.strip() for b in bangs.split('!') if b.strip()] if bangs else []
        if inner is None and not hints:
            items.append(('col', name, alias or name))
        else:
            is_inner = 'inner' in hints
            hint = next((h for h in hints if h not in ('inner', 'left')), None)
            items.append(('embed', name, alias or name, hint, is_inner, parse_select(inner if inner is not None else '*')))
    return items


def _list_value(raw):
    if isinstance(raw, list):
        return raw
    s = str(raw).strip()
    if s.startswith('(') and s.endswith(')'):
        s = s[1:-1]
    return [v.strip().strip('"') for v in split_top(s)] if s else []
