"""
That a model package is run only when it is whole: a manifest of a known
family and task, naming plain files that hash to what it records.
"""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
import pytest

from terra import models

# Every package this repository builds, as written by hand before the packager
# fills in each file's digest and size.
SOURCES = Path(__file__).resolve().parents[2] / 'model' / 'packages'


def _package(root: Path, family: str = 'feature_rf', files: dict[str, bytes] | None = None,
             suffix: str = '.bin', **extra) -> Path:
    """Write a package of small files and a manifest that describes them truly."""
    files = files or {
        'model': b'forest', 'scaler': b'scaler', 'label_encoder': b'labels',
        'feature_names': b'names',
    }
    entries = {}
    for role, data in files.items():
        name = f'{role}{suffix}'
        (root / name).write_bytes(data)
        entries[role] = {
            'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
        }
    manifest = {
        'format': 1, 'id': 'test-rf', 'version': '1.0.0', 'name': 'Test RF',
        'family': family, 'task': 'land_cover', 'classes': [3, 21], 'files': entries,
        **extra,
    }
    (root / 'model.json').write_text(json.dumps(manifest))
    return root


@pytest.fixture
def curve(monkeypatch):
    """A family of a task other than land cover, known to this test alone."""
    monkeypatch.setitem(models.FAMILIES, 'test_curve',
                        models.Family('time_series', ('parameters',)))
    return 'test_curve'


def _curve_package(root: Path, data: bytes = b'{"length_scale_days": 32.0}',
                   suffix: str = '.json', **extra) -> Path:
    return _package(root, family='test_curve', files={'parameters': data}, suffix=suffix,
                    task='time_series', classes=None, **extra)


def _npz(**arrays) -> bytes:
    out = io.BytesIO()
    np.savez(out, **arrays)
    return out.getvalue()


def _rewrite(root: Path, **changes) -> None:
    path = root / 'model.json'
    raw = json.loads(path.read_text())
    raw.update(changes)
    path.write_text(json.dumps(raw))


def test_a_whole_package_loads_and_verifies(tmp_path):
    pkg = models.load(_package(tmp_path))
    models.verify(pkg)
    assert (pkg.id, pkg.version, pkg.family) == ('test-rf', '1.0.0', 'feature_rf')
    assert pkg.classes == (3, 21)
    assert pkg.path('model') == tmp_path / 'model.bin'


def test_the_digest_follows_the_files_and_not_their_order(tmp_path):
    a = models.load(_package(tmp_path))
    files = dict(reversed(list(a.files.items())))
    assert models.digest(files) == a.digest
    changed = dict(a.files, model=models.ModelFile('model.bin', '0' * 64, 6))
    assert models.digest(changed) != a.digest


def test_a_file_changed_after_install_is_refused_before_it_is_opened(tmp_path):
    pkg = models.load(_package(tmp_path))
    (tmp_path / 'model.bin').write_bytes(b'tampered')
    with pytest.raises(models.PackageError, match='not the file it was installed as'):
        models.verify(pkg)


def test_a_missing_file_is_named(tmp_path):
    pkg = models.load(_package(tmp_path))
    (tmp_path / 'scaler.bin').unlink()
    with pytest.raises(models.PackageError, match='missing scaler.bin'):
        models.verify(pkg)


def test_an_unknown_family_is_refused(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, family='diffusion')
    with pytest.raises(models.PackageError, match='cannot run'):
        models.load(tmp_path)


def test_a_newer_format_asks_for_a_newer_application(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, format=2)
    with pytest.raises(models.PackageError, match='newer application'):
        models.load(tmp_path)


def test_a_file_cannot_point_outside_its_package(tmp_path):
    root = _package(tmp_path)
    raw = json.loads((root / 'model.json').read_text())
    raw['files']['model']['name'] = '../elsewhere.bin'
    (root / 'model.json').write_text(json.dumps(raw))
    with pytest.raises(models.PackageError, match='no plain name'):
        models.load(root)


def test_a_family_without_its_files_is_refused(tmp_path):
    _package(tmp_path, files={'model': b'forest'})
    with pytest.raises(models.PackageError, match='scaler'):
        models.load(tmp_path)


def test_an_embedding_head_needs_a_model_and_scaler_per_variant(tmp_path):
    _package(tmp_path, family='embedding_rf', variants=['pixel'],
             files={'label_encoder': b'l', 'model_pixel': b'm'})
    with pytest.raises(models.PackageError, match='scaler_pixel'):
        models.load(tmp_path)


def test_an_invalid_id_is_refused(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, id='Not An Id')
    with pytest.raises(models.PackageError, match='not a valid id'):
        models.load(tmp_path)


def test_a_land_cover_model_must_list_its_classes(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, classes=[])
    with pytest.raises(models.PackageError, match='lists no classes'):
        models.load(tmp_path)


def test_a_model_of_another_task_lists_no_classes(tmp_path, curve):
    _curve_package(tmp_path)
    _rewrite(tmp_path, classes=[3, 21])
    with pytest.raises(models.PackageError, match='does not emit'):
        models.load(tmp_path)


def test_an_unknown_task_is_refused(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, task='flood_extent')
    with pytest.raises(models.PackageError, match='task this application does not know'):
        models.load(tmp_path)


def test_a_family_of_another_task_is_refused(tmp_path):
    _package(tmp_path)
    _rewrite(tmp_path, task='time_series', classes=None)
    with pytest.raises(models.PackageError, match='does land_cover and not time_series'):
        models.load(tmp_path)


def test_a_model_of_another_task_runs_from_json_and_is_still_pinned(tmp_path, curve):
    pkg = models.load(_curve_package(tmp_path))
    models.verify(pkg)
    assert (pkg.family, pkg.task, pkg.classes) == (curve, 'time_series', ())
    (tmp_path / 'parameters.json').write_bytes(b'{"length_scale_days": 64.0}')
    with pytest.raises(models.PackageError, match='not the file it was installed as'):
        models.verify(pkg)


def test_a_model_of_another_task_cannot_hold_a_pickle(tmp_path, curve):
    _curve_package(tmp_path, data=b'pickled', suffix='.joblib')
    with pytest.raises(models.PackageError, match='neither JSON nor NPZ'):
        models.load(tmp_path)


def test_its_arrays_are_read_without_unpickling(tmp_path, curve):
    pkg = models.load(_curve_package(tmp_path, data=_npz(scale=np.array([1.0, 2.5])),
                                     suffix='.npz'))
    models.verify(pkg)
    assert models.arrays(pkg, 'parameters')['scale'].tolist() == [1.0, 2.5]


def test_an_npz_that_holds_an_object_array_is_refused(tmp_path, curve):
    data = _npz(scale=np.array([{'run': 'code'}], dtype=object))
    pkg = models.load(_curve_package(tmp_path, data=data, suffix='.npz'))
    with pytest.raises(models.PackageError, match='not an archive of plain arrays'):
        models.verify(pkg)


@pytest.mark.parametrize('source', sorted(p.name for p in SOURCES.iterdir()
                                          if (p / 'model.json').is_file()))
def test_the_packages_this_repository_builds_still_load(tmp_path, source):
    raw = json.loads((SOURCES / source / 'model.json').read_text(encoding='utf-8'))
    for entry in raw['files'].values():
        entry.update(sha256='0' * 64, size=0)
    (tmp_path / 'model.json').write_text(json.dumps(raw))
    assert models.load(tmp_path).task == 'land_cover'
