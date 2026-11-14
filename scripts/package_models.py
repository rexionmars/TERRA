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

MODELS IN PREPARATION are listed too, under `upcoming`, before they have a
release: a card that says what the model will do and what its release waits
for, with nothing to download. Each is model/upcoming/<id>/entry.json, written
by hand with the fields in ENTRY_FIELDS, and picture.webp (or .png, .jpg) beside
it, which is inlined as the card's picture. Only those in UPCOMING are listed,
in its order. A model is in LISTED or in UPCOMING, never both: when it is
published it moves from one to the other. With UPCOMING empty the catalogue
has no `upcoming` key, as before there was one.

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
PREPARING = ROOT / 'model' / 'upcoming'

# The packages the catalogue offers, in the order the Models screen lists them.
LISTED = ('spectral', 'temporal_transformer')
# The models in preparation it lists, in the order the Models screen shows them:
# the furthest from a release last.
UPCOMING: tuple[str, ...] = (
    'gp_series', 'observation_noise', 'transient_excursions', 'series_events', 's1_orbit_noise',
)

# What an entry.json may hold, in the order the catalogue gives it; the first
# five are required. internal/models/catalog.go checks them again on reading.
ENTRY_FIELDS = ('id', 'name', 'task', 'summary', 'status', 'reads', 'limits', 'picture')
ENTRY_REQUIRED = ENTRY_FIELDS[:5]

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

    picture = found.get('picture')
    return {
        'manifest': manifest,
        'digest': package_digest(manifest['files']),
        'picture_uri': picture_uri(picture) if picture else '',
        'package': {'name': zip_name, 'sha256': sha256(target), 'size': target.stat().st_size},
        'sources': sources,
    }


def picture_uri(path: Path) -> str:
    kind = PICTURE_TYPES.get(path.suffix.lower(), 'image/webp')
    return f'data:{kind};base64,' + base64.b64encode(path.read_bytes()).decode()


def upcoming_entry(source: Path) -> dict:
    """
    The catalogue entry of a model in preparation: its entry.json, and its
    picture inlined. Refuses a field the catalogue does not carry, so a
    version or an address never reaches a model that has no release.
    """
    entry = json.loads((source / 'entry.json').read_text(encoding='utf-8'))
    if entry.get('id') != source.name:
        sys.exit(f"{source}: entry.json names {entry.get('id')!r}, not {source.name!r}")
    if extra := sorted(set(entry) - set(ENTRY_FIELDS)):
        sys.exit(f"{source.name}: entry.json holds {', '.join(extra)}, which a model in "
                 'preparation does not have')
    if missing := [f for f in ENTRY_REQUIRED if not entry.get(f)]:
        sys.exit(f"{source.name}: entry.json has no {', '.join(missing)}")
    out = {f: entry[f] for f in ENTRY_FIELDS if f in entry}
    pictures = [p for p in sorted(source.glob('picture.*')) if p.suffix.lower() in PICTURE_TYPES]
    if len(pictures) > 1:
        sys.exit(f"{source.name}: more than one picture ({', '.join(p.name for p in pictures)})")
    if pictures:
        out['picture_uri'] = picture_uri(pictures[0])
    return out


def catalog_text(models: list[dict], upcoming: list[dict]) -> str:
    """The catalogue as written: with no model in preparation, as it was before them."""
    catalog: dict = {'format': 1, 'models': models}
    if upcoming:
        catalog['upcoming'] = upcoming
    return json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'


def main() -> None:
    if both := sorted(set(LISTED) & set(UPCOMING)):
        sys.exit(f"{', '.join(both)} is in LISTED and in UPCOMING; a model is published "
                 'or in preparation, not both')
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
    if missing := [i for i in UPCOMING if not (PREPARING / i / 'entry.json').is_file()]:
        sys.exit(f"UPCOMING names {', '.join(missing)}, which has no entry.json under {PREPARING}")
    upcoming = [upcoming_entry(PREPARING / i) for i in UPCOMING]
    CATALOG.write_text(catalog_text([entries[i] for i in LISTED], upcoming), encoding='utf-8')
    print(f'{CATALOG.relative_to(ROOT)}  {len(LISTED)} models, {len(upcoming)} in preparation')


if __name__ == '__main__':
    main()
