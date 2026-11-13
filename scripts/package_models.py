#!/usr/bin/env python3
"""
Build the installable model packages, one zip per model in dist/models/, and
the catalogue that offers them, model/catalog.json.

A package is a model's files and a model.json naming each by role, with its
SHA-256 and size. The facts in the manifest are written by hand in
model/packages/<id>/model.json; this fills in what the files say about
themselves, so the digests the application checks on every load are computed
here, from the bytes that will be published.

A file is looked for beside its manifest first (the card's picture) and then in
model/ (the weights). The zip is flat: the manifest and its files side by side,
which is the layout the application installs. It is also reproducible: every
entry has the same date and mode, so the same files make the same zip, and a
package built again after it was published still has the SHA-256 the
catalogue gives for it.

THE CATALOGUE is what the Models screen lists. The application reads it from
the models repository, github.com/rexionmars/TERRA-models, and embeds the copy
written here for when that cannot be read (internal/models/catalog.go). Each
entry is a package's manifest, its picture, the SHA-256 and size of its zip,
and where the zip is published:

- a release of the models repository tagged <id>-<version>, with the zip as
  its asset;
- Zenodo, once the manifest's `doi` is the Zenodo DOI reserved for it
  (10.5281/zenodo.<record>).

Only the packages in LISTED are offered. To publish one: reserve its DOI first
if it goes to Zenodo (the DOI is inside the zip), run this, create the release
with the zip and upload it to Zenodo, and only then put the catalogue at the
root of the models repository, so it never lists a zip that is not there yet.

Run from the repository root:

    python3 scripts/package_models.py
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'model' / 'packages'
WEIGHTS = ROOT / 'model'
OUT = ROOT / 'dist' / 'models'
CATALOG = ROOT / 'model' / 'catalog.json'

# The packages the catalogue offers, in the order the Models screen lists them.
LISTED = ('spectral', 'temporal_transformer')

RELEASE = 'https://github.com/rexionmars/TERRA-models/releases/download/{id}-{version}/{zip}'
ZENODO = 'https://zenodo.org/records/{record}/files/{zip}?download=1'
ZENODO_DOI = re.compile(r'^10\.5281/zenodo\.(\d+)$')

# Fixed, so the zip depends on its files alone: the earliest date a zip holds.
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
PICTURE_TYPES = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def package_digest(files: dict) -> str:
    """The package's fingerprint, as sidecar/terra/models.py `digest` computes it."""
    h = hashlib.sha256()
    for role in sorted(files):
        h.update(f"{role}:{files[role]['sha256']}\n".encode())
    return h.hexdigest()


def _entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
    info.external_attr = 0o644 << 16
    # Stored, not deflated: the weights are already dense, and a stored entry
    # can be checked against its digest without a second copy in memory.
    info.compress_type = zipfile.ZIP_STORED
    return info


def build(source: Path) -> tuple[dict, Path, dict[str, Path]]:
    manifest = json.loads((source / 'model.json').read_text(encoding='utf-8'))
    found: dict[str, Path] = {}
    for role, entry in manifest['files'].items():
        name = entry['name']
        path = next((p for p in (source / name, WEIGHTS / name) if p.is_file()), None)
        if path is None:
            sys.exit(f"{manifest['id']}: {name} ({role}) is neither in {source} nor in {WEIGHTS}")
        entry['sha256'] = sha256(path)
        entry['size'] = path.stat().st_size
        found[role] = path

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{manifest['id']}-{manifest['version']}.zip"
    with zipfile.ZipFile(target, 'w') as z:
        z.writestr(_entry('model.json'), json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for path in found.values():
            z.writestr(_entry(path.name), path.read_bytes())
    return manifest, target, found


def catalog_entry(manifest: dict, target: Path, found: dict[str, Path]) -> dict:
    zip_name = target.name
    sources = [{
        'name': 'GitHub',
        'url': RELEASE.format(id=manifest['id'], version=manifest['version'], zip=zip_name),
    }]
    if m := ZENODO_DOI.match(manifest.get('doi') or ''):
        sources.append({'name': 'Zenodo', 'url': ZENODO.format(record=m.group(1), zip=zip_name)})

    picture_uri = ''
    if picture := found.get('picture'):
        kind = PICTURE_TYPES.get(picture.suffix.lower(), 'image/webp')
        picture_uri = f'data:{kind};base64,' + base64.b64encode(picture.read_bytes()).decode()

    return {
        'manifest': manifest,
        'digest': package_digest(manifest['files']),
        'picture_uri': picture_uri,
        'package': {'name': zip_name, 'sha256': sha256(target), 'size': target.stat().st_size},
        'sources': sources,
    }


def main() -> None:
    sources = sorted(p for p in SOURCES.iterdir() if (p / 'model.json').is_file())
    if not sources:
        sys.exit(f'no model.json under {SOURCES}')
    entries: dict[str, dict] = {}
    for source in sources:
        manifest, target, found = build(source)
        entry = catalog_entry(manifest, target, found)
        listed = manifest['id'] in LISTED
        if listed:
            entries[manifest['id']] = entry
        size = target.stat().st_size / 1_000_000
        print(f"{target.relative_to(ROOT)}  {size:.1f} MB  sha256 {entry['package']['sha256']}"
              f"{'' if listed else '  (not in the catalogue)'}")

    missing = [i for i in LISTED if i not in entries]
    if missing:
        sys.exit(f"LISTED names {', '.join(missing)}, which has no package under {SOURCES}")
    catalog = {'format': 1, 'models': [entries[i] for i in LISTED]}
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{CATALOG.relative_to(ROOT)}  {len(LISTED)} models')


if __name__ == '__main__':
    main()
