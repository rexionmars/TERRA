"""
The report document's shape, checked before anything is written.

The template reads fields by name. A field of the wrong type does not fail
there with a sentence; it fails as a Typst error pointing at a line of the
template, which tells the user nothing. So the document is checked here, and a
problem is reported as the path of the field that is wrong.

The check is of SHAPE, not of content: whether a title is well chosen or a
figure is the right one is the compositor's business.
"""

from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Any

SCHEMA = 1

# A report with more than this is a document nobody reads to the end, and a
# figure larger than this is an uncompressed raster that should not be in a PDF.
MAX_FIGURES = 12
MAX_FIGURE_BYTES = 25 * 1024 * 1024
MAX_TABLE_ROWS = 5000
PNG_PREFIX = 'data:image/png;base64,'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


class DocumentError(ValueError):
    """The document does not have the shape the template reads."""


def _str(d: dict[str, Any], key: str, path: str, required: bool = False) -> None:
    v = d.get(key)
    if v is None:
        if required:
            raise DocumentError(f'{path}.{key} is required')
        return
    if not isinstance(v, str):
        raise DocumentError(f'{path}.{key} must be text')


def _list(d: dict[str, Any], key: str, path: str) -> list[Any]:
    v = d.get(key)
    if v is None:
        return []
    if not isinstance(v, list):
        raise DocumentError(f'{path}.{key} must be a list')
    return v


def _obj(v: Any, path: str) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise DocumentError(f'{path} must be an object')
    return v


def _num(d: dict[str, Any], key: str, path: str) -> float:
    v = d.get(key)
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise DocumentError(f'{path}.{key} must be a number')
    return float(v)


def _pair(d: dict[str, Any], key: str, path: str) -> None:
    v = d.get(key)
    if (not isinstance(v, list) or len(v) != 2
            or not all(isinstance(x, int | float) and not isinstance(x, bool) for x in v)
            or v[0] >= v[1]):
        raise DocumentError(f'{path}.{key} must be two increasing numbers')


def _strings(v: list[Any], path: str) -> None:
    for i, s in enumerate(v):
        if not isinstance(s, str):
            raise DocumentError(f'{path}[{i}] must be text')


def _map_sheet(m: dict[str, Any], path: str) -> None:
    """A map sheet's graticule, scales and reference system."""
    grid = _obj(m.get('graticule'), f'{path}.graticule')
    for axis in ('lon', 'lat'):
        for j, t in enumerate(_list(grid, axis, f'{path}.graticule')):
            tp = f'{path}.graticule.{axis}[{j}]'
            t = _obj(t, tp)
            if not 0 <= _num(t, 'at', tp) <= 1:
                raise DocumentError(f'{tp}.at must lie in [0, 1]')
            _str(t, 'label', tp, required=True)
    if _num(m, 'ground_width_m', path) <= 0:
        raise DocumentError(f'{path}.ground_width_m must be positive')
    bar = _obj(m.get('scale_bar'), f'{path}.scale_bar')
    if not 0 < _num(bar, 'fraction', f'{path}.scale_bar') <= 1:
        raise DocumentError(f'{path}.scale_bar.fraction must lie in (0, 1]')
    ticks = _list(bar, 'ticks', f'{path}.scale_bar')
    if len(ticks) != 3:
        raise DocumentError(f'{path}.scale_bar.ticks must hold 3 labels: 0, half, whole')
    _strings(ticks, f'{path}.scale_bar.ticks')
    _str(m, 'crs', path, required=True)


def validate(doc: Any) -> dict[str, Any]:
    """The document, checked; raises DocumentError naming the first bad field."""
    doc = _obj(doc, 'document')
    if doc.get('schema') != SCHEMA:
        raise DocumentError(f'document.schema must be {SCHEMA}, got {doc.get("schema")!r}')
    meta = _obj(doc.get('meta'), 'document.meta')
    _str(meta, 'title', 'meta', required=True)
    if not meta['title'].strip():
        raise DocumentError('meta.title is empty')
    for key in ('subtitle', 'number', 'revision', 'issued', 'owner', 'recipient',
                'author', 'approver', 'app_version', 'generated_at'):
        _str(meta, key, 'meta')
    if meta.get('status') not in ('draft', 'released'):
        raise DocumentError('meta.status must be "draft" or "released"')
    for key in ('question', 'scope'):
        _str(doc, key, 'document')
    _strings(_list(doc, 'summary', 'document'), 'summary')
    _strings(_list(doc, 'references', 'document'), 'references')

    for i, p in enumerate(_list(doc, 'provenance', 'document')):
        p = _obj(p, f'provenance[{i}]')
        _str(p, 'label', f'provenance[{i}]', required=True)
        _str(p, 'value', f'provenance[{i}]', required=True)

    for i, m in enumerate(_list(doc, 'method', 'document')):
        path = f'method[{i}]'
        m = _obj(m, path)
        _str(m, 'product', path, required=True)
        _str(m, 'subtitle', path)
        _str(m, 'source', path)
        for j, s in enumerate(_list(m, 'sections', path)):
            sp = f'{path}.sections[{j}]'
            s = _obj(s, sp)
            _str(s, 'title', sp, required=True)
            _str(s, 'note', sp)
            _strings(_list(s, 'lines', sp), f'{sp}.lines')

    figures = _list(doc, 'figures', 'document')
    if len(figures) > MAX_FIGURES:
        raise DocumentError(f'document.figures holds {len(figures)}; at most {MAX_FIGURES}')
    for i, f in enumerate(figures):
        path = f'figures[{i}]'
        f = _obj(f, path)
        _str(f, 'title', path, required=True)
        _str(f, 'caption', path)
        _str(f, 'uri', path, required=True)
        if not f['uri'].startswith(PNG_PREFIX):
            raise DocumentError(f'{path}.uri must be a PNG data URI')
        if _num(f, 'aspect', path) <= 0:
            raise DocumentError(f'{path}.aspect must be positive (width over height)')
        for j, e in enumerate(_list(f, 'legend', path)):
            e = _obj(e, f'{path}.legend[{j}]')
            _str(e, 'label', f'{path}.legend[{j}]', required=True)
            _str(e, 'color', f'{path}.legend[{j}]', required=True)
        _str(f, 'source', path)
        sheet = f.get('map')
        if sheet is not None:
            _map_sheet(_obj(sheet, f'{path}.map'), f'{path}.map')

    for i, s in enumerate(_list(doc, 'series', 'document')):
        path = f'series[{i}]'
        s = _obj(s, path)
        for key in ('title', 'x_label', 'y_label'):
            _str(s, key, path, required=True)
        _str(s, 'caption', path)
        _pair(s, 'x_range', path)
        _pair(s, 'y_range', path)
        for key in ('x_ticks', 'y_ticks'):
            for j, t in enumerate(_list(s, key, path)):
                t = _obj(t, f'{path}.{key}[{j}]')
                _num(t, 'at', f'{path}.{key}[{j}]')
                _str(t, 'label', f'{path}.{key}[{j}]', required=True)
        for j, p in enumerate(_list(s, 'points', path)):
            p = _obj(p, f'{path}.points[{j}]')
            _num(p, 'x', f'{path}.points[{j}]')
            _num(p, 'y', f'{path}.points[{j}]')
        for j, m in enumerate(_list(s, 'marks', path)):
            m = _obj(m, f'{path}.marks[{j}]')
            _num(m, 'x', f'{path}.marks[{j}]')
            _str(m, 'label', f'{path}.marks[{j}]', required=True)

    for i, t in enumerate(_list(doc, 'tables', 'document')):
        path = f'tables[{i}]'
        t = _obj(t, path)
        _str(t, 'title', path, required=True)
        _str(t, 'caption', path)
        columns = _list(t, 'columns', path)
        if not columns:
            raise DocumentError(f'{path}.columns is empty')
        for j, c in enumerate(columns):
            c = _obj(c, f'{path}.columns[{j}]')
            _str(c, 'label', f'{path}.columns[{j}]', required=True)
            if c.get('align', 'left') not in ('left', 'right'):
                raise DocumentError(f'{path}.columns[{j}].align must be "left" or "right"')
        rows = _list(t, 'rows', path)
        if len(rows) > MAX_TABLE_ROWS:
            raise DocumentError(f'{path} holds {len(rows)} rows; at most {MAX_TABLE_ROWS}')
        for j, r in enumerate(rows):
            if not isinstance(r, list) or len(r) != len(columns):
                raise DocumentError(f'{path}.rows[{j}] must hold {len(columns)} cells')
            _strings(r, f'{path}.rows[{j}]')

    for i, lim in enumerate(_list(doc, 'limitations', 'document')):
        lim = _obj(lim, f'limitations[{i}]')
        _str(lim, 'label', f'limitations[{i}]', required=True)
        _str(lim, 'text', f'limitations[{i}]', required=True)

    for i, r in enumerate(_list(doc, 'runs', 'document')):
        r = _obj(r, f'runs[{i}]')
        for key in ('id', 'kind'):
            _str(r, key, f'runs[{i}]', required=True)
        for key in ('period', 'created'):
            _str(r, key, f'runs[{i}]')
    return doc


def write_figures(doc: dict[str, Any], into: Path) -> int:
    """
    Each figure's data URI written to a PNG file beside the template.

    The figure's `uri` is replaced by `file`, the name the template opens, so
    document.json does not carry the images twice. Returns how many were
    written.
    """
    n = 0
    for i, f in enumerate(doc.get('figures') or []):
        try:
            data = base64.b64decode(f['uri'][len(PNG_PREFIX):], validate=True)
        except (binascii.Error, ValueError) as e:
            raise DocumentError(f'figures[{i}].uri is not valid base64: {e}') from e
        if not data.startswith(PNG_SIGNATURE):
            raise DocumentError(f'figures[{i}].uri does not hold a PNG')
        if len(data) > MAX_FIGURE_BYTES:
            raise DocumentError(f'figures[{i}] is {len(data)} bytes; at most {MAX_FIGURE_BYTES}')
        name = f'figure-{i + 1}.png'
        (into / name).write_bytes(data)
        del f['uri']
        f['file'] = name
        n += 1
    return n
