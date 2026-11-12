"""
A model package: the manifest that describes a trained model, and the files it names.

THE APPLICATION SHIPS NO MODEL. A reader installs the ones they want -- from the
published catalogue, or from a package of their own -- and the shell hands this
sidecar the directory of the one a run asked for. Installing is the shell's
business (internal/models); this module reads what was installed and refuses it
unless it is whole.

PINNED BY DIGEST, CHECKED ON EVERY LOAD. A joblib file and a torch checkpoint
are pickles, and loading one runs whatever it says. The manifest records the
SHA-256 of every file, and a file that does not hash to it is refused before
anything opens it, so a package changed on disk since it was installed is not
run. The same digests make a run reproducible: `digest` folds them into one
fingerprint, which the result carries and the store keeps.

WEIGHTS ONLY, IN A KNOWN FAMILY. A package brings no code. It names one of the
architectures this sidecar can run, and ROLES says which files each needs. A
new architecture is code here and a line in ROLES; a new model of a known one
is a manifest and its files, and nothing else.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

# The manifest's own version, so a later shape can be told from this one.
FORMAT = 1
MANIFEST = 'model.json'

# Each family the sidecar runs, and the files it reads. An embedding head has
# one model and scaler per variant (pixel or patch), named model_<variant> and
# scaler_<variant>, beside the shared label encoder.
ROLES: dict[str, tuple[str, ...]] = {
    'feature_rf': ('model', 'scaler', 'label_encoder', 'feature_names'),
    'sequence_transformer': ('checkpoint',),
    'embedding_rf': ('label_encoder',),
}

# Lower case, digits, dot, dash and underscore: an id is a directory name on
# every platform the application runs on, and part of a URL in the catalogue.
_ID = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
_SHA256 = re.compile(r'^[0-9a-f]{64}$')
_CHUNK = 1 << 20


class PackageError(Exception):
    """A package that cannot be run, in a sentence a reader can act on."""


@dataclass(frozen=True)
class ModelFile:
    name: str
    sha256: str
    size: int


@dataclass(frozen=True)
class Package:
    root: Path
    id: str
    version: str
    name: str
    family: str
    classes: tuple[int, ...]
    files: dict[str, ModelFile]
    variants: tuple[str, ...]

    def path(self, role: str) -> Path:
        return self.root / self.files[role].name

    @property
    def digest(self) -> str:
        return digest(self.files)


def digest(files: dict[str, ModelFile]) -> str:
    """
    One SHA-256 for the whole package: over each role and its file's digest,
    sorted by role, so the same files give the same value whatever order the
    manifest lists them in.
    """
    h = hashlib.sha256()
    for role in sorted(files):
        h.update(f'{role}:{files[role].sha256}\n'.encode())
    return h.hexdigest()


def _required_roles(family: str, variants: tuple[str, ...]) -> tuple[str, ...]:
    roles = ROLES[family]
    if family == 'embedding_rf':
        roles = roles + tuple(
            r for v in variants for r in (f'model_{v}', f'scaler_{v}'))
    return roles


def load(root: Path) -> Package:
    """
    Read the manifest at `root` and check that it describes a runnable package.

    Checks the shape only. Whether the files are the ones the manifest names is
    `verify`, which reads every byte and is kept apart so listing packages
    stays cheap.
    """
    manifest_path = root / MANIFEST
    try:
        raw = json.loads(manifest_path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise PackageError(f'no {MANIFEST} in {root}') from None
    except (OSError, ValueError) as e:
        raise PackageError(f'{MANIFEST} in {root} cannot be read: {e}') from None
    if not isinstance(raw, dict):
        raise PackageError(f'{MANIFEST} in {root} is not an object')

    if raw.get('format') != FORMAT:
        raise PackageError(
            f'model package format {raw.get("format")!r} is not {FORMAT}; '
            'a newer application may be needed')
    model_id = raw.get('id')
    if not isinstance(model_id, str) or not _ID.match(model_id):
        raise PackageError(f'model id {model_id!r} is not a valid id')
    family = raw.get('family')
    if family not in ROLES:
        raise PackageError(
            f'model {model_id} is a {family!r}, which this application cannot run')
    version = raw.get('version')
    if not isinstance(version, str) or not version:
        raise PackageError(f'model {model_id} has no version')

    variants_raw = raw.get('variants') or []
    if not isinstance(variants_raw, list) or not all(
            isinstance(v, str) and _ID.match(v) for v in variants_raw):
        raise PackageError(f'model {model_id} lists invalid variants')
    variants = tuple(variants_raw)
    if family == 'embedding_rf' and not variants:
        raise PackageError(f'model {model_id} names no variant')

    classes_raw = raw.get('classes')
    if not isinstance(classes_raw, list) or not classes_raw or not all(
            isinstance(c, int) and not isinstance(c, bool) for c in classes_raw):
        raise PackageError(f'model {model_id} lists no classes')

    files_raw = raw.get('files')
    if not isinstance(files_raw, dict):
        raise PackageError(f'model {model_id} lists no files')
    files: dict[str, ModelFile] = {}
    for role, entry in files_raw.items():
        if not isinstance(entry, dict):
            raise PackageError(f'model {model_id}: file {role!r} is not described')
        name, sha, size = entry.get('name'), entry.get('sha256'), entry.get('size')
        # A bare file name: a package cannot point outside its own directory.
        if not isinstance(name, str) or not name or Path(name).name != name:
            raise PackageError(f'model {model_id}: file {role!r} has no plain name')
        if not isinstance(sha, str) or not _SHA256.match(sha):
            raise PackageError(f'model {model_id}: {name} has no SHA-256')
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise PackageError(f'model {model_id}: {name} has no size')
        files[role] = ModelFile(name, sha, size)

    missing = [r for r in _required_roles(family, variants) if r not in files]
    if missing:
        raise PackageError(
            f'model {model_id} lacks the {", ".join(missing)} its family needs')

    return Package(
        root=root,
        id=model_id,
        version=version,
        name=str(raw.get('name') or model_id),
        family=family,
        classes=tuple(classes_raw),
        files=files,
        variants=variants,
    )


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def verify(pkg: Package) -> None:
    """Refuse the package unless every file it names is on disk and hashes to its digest."""
    for role, f in pkg.files.items():
        path = pkg.root / f.name
        if not path.is_file():
            raise PackageError(f'model {pkg.id} is missing {f.name}')
        if path.stat().st_size != f.size or _sha256(path) != f.sha256:
            raise PackageError(
                f'model {pkg.id}: {f.name} is not the file it was installed as '
                f'({role}); reinstall the model')
