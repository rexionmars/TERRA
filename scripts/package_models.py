#!/usr/bin/env python3
"""
Build the installable model packages: one zip per model, in dist/models/.

A package is a model's files and a model.json naming each by role, with its
SHA-256 and size. The facts in the manifest are written by hand in
model/packages/<id>/model.json; this fills in what the files say about
themselves, so the digests the application checks on every load are computed
here, from the bytes that will be published.

A file is looked for beside its manifest first (the card's picture) and then in
model/ (the weights). The zip is flat: the manifest and its files side by side,
which is the layout the application installs.

Run from the repository root:

    python3 scripts/package_models.py

It prints each zip's SHA-256, which the catalogue records as the digest of the
download.
"""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'model' / 'packages'
WEIGHTS = ROOT / 'model'
OUT = ROOT / 'dist' / 'models'


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def build(source: Path) -> Path:
    manifest = json.loads((source / 'model.json').read_text(encoding='utf-8'))
    found: dict[str, Path] = {}
    for role, entry in manifest['files'].items():
        name = entry['name']
        path = next((p for p in (source / name, WEIGHTS / name) if p.is_file()), None)
        if path is None:
            sys.exit(f"{manifest['id']}: {name} ({role}) is neither in {source} nor in {WEIGHTS}")
        entry['sha256'] = sha256(path)
        entry['size'] = path.stat().st_size
        found[name] = path

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{manifest['id']}-{manifest['version']}.zip"
    # Stored, not deflated: the weights are already dense, and a stored entry
    # can be checked against its digest without a second copy in memory.
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED) as z:
        z.writestr('model.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for name, path in found.items():
            z.write(path, name)
    return target


def main() -> None:
    sources = sorted(p for p in SOURCES.iterdir() if (p / 'model.json').is_file())
    if not sources:
        sys.exit(f'no model.json under {SOURCES}')
    for source in sources:
        target = build(source)
        size = target.stat().st_size / 1_000_000
        print(f'{target.relative_to(ROOT)}  {size:.1f} MB  sha256 {sha256(target)}')


if __name__ == '__main__':
    main()
