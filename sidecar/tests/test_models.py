"""
That a model package is run only when it is whole: a manifest of a known
family, naming plain files that hash to what it records.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from terra import models


def _package(root: Path, family: str = 'feature_rf', files: dict[str, bytes] | None = None,
             **extra) -> Path:
    """Write a package of small files and a manifest that describes them truly."""
    files = files or {
        'model': b'forest', 'scaler': b'scaler', 'label_encoder': b'labels',
        'feature_names': b'names',
    }
    entries = {}
    for role, data in files.items():
        name = f'{role}.bin'
        (root / name).write_bytes(data)
        entries[role] = {
            'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
        }
    manifest = {
        'format': 1, 'id': 'test-rf', 'version': '1.0.0', 'name': 'Test RF',
        'family': family, 'classes': [3, 21], 'files': entries, **extra,
    }
    (root / 'model.json').write_text(json.dumps(manifest))
    return root


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
