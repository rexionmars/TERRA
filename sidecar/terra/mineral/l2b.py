"""
Agreement between this port's answer and the EMIT L2B product's, cell by cell.

EMIT L2B MIN V001 is Tetracorder run by the EMIT team on the same reflectance,
with expert system t5.27d1 and libraries s06emite and r06emite, which are not
public (build_tetracorder_rules.py). Its answer per pixel is an index into the
294 references its file lists in `mineral_metadata`. This port's rules carry
297 entries of t5.27e1 with the emit_c libraries, so the two are compared at
the level both can be read at: the class.

AN L2B INDEX IS GIVEN A CLASS in three steps, the first that applies:

    1. its splib06 record is the record of one of this port's entries, whose
       class it takes: splib06 records are the same in both library builds;
    2. its name, stripped of the library build's suffix codes, is the title of
       one of this port's references: the r06 reflectance library was
       renumbered between the emit_c and emit_e builds, so its records do not
       match and its titles do;
    3. the first word of its name names a component of a class
       (build_tetracorder_rules.CLASS_COMPONENTS, read through the rules'
       own entries), and otherwise `other`.

On the L2B V001 metadata of 2024-08-30 over Minas Gerais this gives 231 by
record, 46 by title and 17 by name (tests/data/emit_l2b_min_001_metadata.json).
"""

from __future__ import annotations

import re

import numpy as np

# Agreement codes per cell, in the order the legend lists them.
AGREE, DIFFER, PORT_ONLY, L2B_ONLY, NEITHER = 0, 1, 2, 3, 4
UNCOMPARED = -1   # not observed, or L2B has no value there

_SUFFIX = re.compile(r'^(w\dr\d\S*|[sr]06\S*|[sr]plib\S*|aref|rref|=\S*|\d{3,5})$', re.I)


def _title_key(title: str) -> str:
    """A reference title without the codes a library build appends to it."""
    return ' '.join(t for t in re.split(r'\s+', title.strip().lower()) if t and not _SUFFIX.match(t))


def class_table(metadata: list[dict], rules) -> dict[int, str]:
    """The class of every L2B index, by the three steps in the module docstring."""
    by_record: dict[str, str] = {}
    by_title: dict[str, str] = {}
    by_component: dict[str, str] = {}
    for e in rules.entries:
        by_record.setdefault(e.library, e.klass)
        by_title.setdefault(_title_key(e.library_title), e.klass)
        for name, _ in e.components:
            if e.klass != 'other' and e.primary_component == name:
                by_component.setdefault(name.lower(), e.klass)
    out: dict[int, str] = {}
    for row in metadata:
        klass = None
        if row['library'] == 'splib06':
            klass = by_record.get(f"splib06:{row['record']}")
        if klass is None:
            klass = by_title.get(_title_key(row['name']))
        if klass is None:
            word = re.split(r'[\s_+.]', row['name'].strip().lower(), maxsplit=1)[0]
            word = re.sub(r'[^a-z]', '', word)
            klass = by_component.get(word) or next(
                (c for comp, c in by_component.items() if word and word.endswith(comp)), 'other')
        out[row['index']] = klass
    return out


def match_steps(metadata: list[dict], rules) -> dict[str, int]:
    """How many L2B indices each step of class_table resolved; for the record."""
    records = {e.library for e in rules.entries}
    titles = {_title_key(e.library_title) for e in rules.entries}
    counts = {'record': 0, 'title': 0, 'name': 0}
    for row in metadata:
        if row['library'] == 'splib06' and f"splib06:{row['record']}" in records:
            counts['record'] += 1
        elif _title_key(row['name']) in titles:
            counts['title'] += 1
        else:
            counts['name'] += 1
    return counts


def agreement(port_class: np.ndarray, l2b_class: np.ndarray) -> np.ndarray:
    """
    Per cell, how the two answers compare. Both arrays hold a class index, -1
    where that product identified nothing and -2 where it has no answer at all
    (not observed, or fill).
    """
    out = np.full(port_class.shape, UNCOMPARED, dtype=np.int8)
    both = (port_class >= -1) & (l2b_class >= -1)
    p, q = port_class >= 0, l2b_class >= 0
    out[both & p & q & (port_class == l2b_class)] = AGREE
    out[both & p & q & (port_class != l2b_class)] = DIFFER
    out[both & p & ~q] = PORT_ONLY
    out[both & ~p & q] = L2B_ONLY
    out[both & ~p & ~q] = NEITHER
    return out
