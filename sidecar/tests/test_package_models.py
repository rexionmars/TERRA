"""
That scripts/package_models.py lists models in preparation only as the
catalogue may hold them, and writes the catalogue as before while it has none.

The script sits outside the sidecar, at the root of the repository; it is
loaded from its path, and nothing here builds a package.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def packager() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        'package_models', ROOT / 'scripts' / 'package_models.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _entry(root: Path, **fields) -> Path:
    """Write model/upcoming/<id>/entry.json as written by hand."""
    entry = {
        'id': 'gp-interval', 'name': 'Interval', 'task': 'time_series',
        'summary': 'A series with its interval.',
        'status': 'Its parameters are being fitted again and are not yet evaluated.',
        **fields,
    }
    source = root / str(entry['id'])
    source.mkdir()
    (source / 'entry.json').write_text(json.dumps(entry), encoding='utf-8')
    return source


def test_the_catalogue_reads_back_as_the_generator_writes_it(packager):
    text = (ROOT / 'model' / 'catalog.json').read_text(encoding='utf-8')
    catalog = json.loads(text)
    assert packager.catalog_text(catalog['models'], catalog.get('upcoming', [])) == text


def test_with_no_model_in_preparation_the_catalogue_is_written_as_before(packager):
    models = json.loads((ROOT / 'model' / 'catalog.json').read_text(encoding='utf-8'))['models']
    before = json.dumps({'format': 1, 'models': models}, ensure_ascii=False, indent=2) + '\n'
    assert packager.catalog_text(models, []) == before


def test_every_model_in_preparation_listed_has_its_entry(packager):
    for model_id in packager.UPCOMING:
        assert packager.upcoming_entry(packager.PREPARING / model_id)['id'] == model_id


def test_a_model_both_published_and_in_preparation_is_refused(packager, monkeypatch, tmp_path):
    monkeypatch.setattr(packager, 'LISTED', ('spectral', 'gp-interval'))
    monkeypatch.setattr(packager, 'UPCOMING', ('gp-interval',))
    monkeypatch.setattr(packager, 'OUT', tmp_path / 'dist')
    monkeypatch.setattr(packager, 'CATALOG', tmp_path / 'catalog.json')
    with pytest.raises(SystemExit, match='gp-interval is in LISTED and in UPCOMING'):
        packager.main()
    assert not (tmp_path / 'dist').exists()
    assert not (tmp_path / 'catalog.json').exists()


def test_a_model_in_preparation_is_listed_with_its_picture_inlined(packager, tmp_path):
    source = _entry(tmp_path, limits=['Not evaluated on series TERRA reads.'])
    (source / 'picture.png').write_bytes(b'\x89PNG\r\n\x1a\n')
    entry = packager.upcoming_entry(source)
    assert list(entry) == ['id', 'name', 'task', 'summary', 'status', 'limits', 'picture_uri']
    assert entry['picture_uri'].startswith('data:image/png;base64,')
    catalog = json.loads(packager.catalog_text([], [entry]))
    assert list(catalog) == ['format', 'models', 'upcoming']
    assert catalog['upcoming'] == [entry]


@pytest.mark.parametrize(('fields', 'refusal'), [
    ({'version': '1.0.0'}, 'holds version'),
    ({'sources': []}, 'holds sources'),
    ({'status': ''}, 'has no status'),
])
def test_a_model_in_preparation_has_only_what_the_catalogue_may_hold(
        packager, tmp_path, fields, refusal):
    with pytest.raises(SystemExit, match=refusal):
        packager.upcoming_entry(_entry(tmp_path, **fields))
