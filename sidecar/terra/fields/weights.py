"""
The checkpoints this product can run, and getting one onto disk.

NOT SHIPPED WITH THE APPLICATION. The default checkpoint is 270 MB, more than
everything in model/ together, and it is read only by the users who delineate
fields. It is downloaded on first use into a directory the caller names --
the application's data directory, so it survives updates of the application
and is fetched once per machine.

PINNED BY DIGEST. A Lightning checkpoint is a pickle, and loading it runs
whatever the pickle says. The digest recorded here is what makes reading a file
from the network acceptable: a download that does not hash to it is deleted
and refused, never loaded.

THE LICENCE TRAVELS WITH THE NAME. The FTW releases carry two licence regimes.
The checkpoints trained on the full dataset are published under "mixed open
licences", which include CC-BY-NC-SA country subsets; the "CCBY" checkpoints
were trained on CC-BY and CC0 data alone. Each entry states its own, and every
result names the checkpoint that produced it.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from terra import protocol

_RELEASES = 'https://github.com/fieldsoftheworld/ftw-baselines/releases/download/'


@dataclass(frozen=True)
class Checkpoint:
    name: str
    title: str
    url: str
    sha256: str
    size_bytes: int
    license: str

    @property
    def filename(self) -> str:
        return self.url.rsplit('/', 1)[-1]


# Names as ftw_tools/inference/model_registry.py spells them, so a result can
# be traced to the release entry. Digests computed on the files downloaded from
# these URLs; adding a checkpoint means downloading it and recording its digest.
CHECKPOINTS: dict[str, Checkpoint] = {
    c.name: c
    for c in (
        # The final PRUE configuration: pixel IoU 0.76 and object F1 0.47 on
        # the FTW test set, against 0.70 and 0.38 for the first FTW baseline
        # (Muhawenayo et al., 2026, Table 1).
        Checkpoint(
            name='FTW_PRUE_EFNET_B7',
            title='FTW v3: Standard, B7',
            url=_RELEASES + 'v3/prue_efnet7_checkpoint.ckpt',
            sha256='2b1b34a17b85b8f70da6ff737529743b6bc6049e987bce5a1fcdd7279eb3b120',
            size_bytes=270119641,
            license='Mixed open licences (includes CC-BY-NC-SA data)',
        ),
        Checkpoint(
            name='FTW_PRUE_EFNET_B3_CCBY',
            title='FTW v3: CC-BY, B3',
            url=_RELEASES + 'v3.1/prue_efnetb3_ccby_checkpoint.ckpt',
            sha256='cd51f020168e66ddd1eff501e81da347b39632af34bebf19a6a20d6c73c5a6d4',
            size_bytes=53242827,
            license='CC-BY-4.0',
        ),
    )
}

DEFAULT = 'FTW_PRUE_EFNET_B7'

# Bytes read per request chunk, and how often progress is reported. A report
# every few per cent keeps the runner's inactivity watchdog fed on a slow link
# without flooding the channel on a fast one.
_CHUNK = 1 << 20
_REPORT_EVERY = 0.05


def lookup(name: str | None) -> Checkpoint:
    """The checkpoint called `name`, or the default when none is given."""
    key = (name or DEFAULT).strip()
    if key not in CHECKPOINTS:
        known = ', '.join(sorted(CHECKPOINTS))
        raise ValueError(f'unknown field-boundary checkpoint {key!r}; known: {known}')
    return CHECKPOINTS[key]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(_CHUNK), b''):
            digest.update(block)
    return digest.hexdigest()


def ensure(
    checkpoint: Checkpoint,
    weights_dir: Path,
    progress: Callable[[float, str], None] | None = None,
    fetch: Callable[[str], object] | None = None,
) -> Path:
    """
    The checkpoint on disk, downloading and verifying it when it is not there.

    A file already present is accepted on its size alone. The digest was
    checked when it was written, and hashing 270 MB on every run to re-prove
    it costs a second of every delineation for a failure -- a file changed in
    place to the same length -- nothing here can produce.

    `fetch` returns a streaming response and exists for tests; production uses
    requests. Network failures reach the user as protocol.Unavailable, which
    says what is missing rather than printing a traceback.
    """
    weights_dir.mkdir(parents=True, exist_ok=True)
    target = weights_dir / checkpoint.filename
    if target.exists() and target.stat().st_size == checkpoint.size_bytes:
        return target

    partial = target.with_suffix(target.suffix + '.part')
    try:
        _download(checkpoint, partial, progress, fetch)
    except OSError as e:
        partial.unlink(missing_ok=True)
        raise protocol.Unavailable(
            f'the field-boundary weights ({checkpoint.title}, '
            f'{checkpoint.size_bytes / 1e6:.0f} MB) could not be downloaded from '
            f'{checkpoint.url}: {e}'
        ) from e

    got = sha256_of(partial)
    if got != checkpoint.sha256:
        partial.unlink(missing_ok=True)
        raise protocol.Unavailable(
            f'the downloaded field-boundary weights do not match the recorded '
            f'digest (expected {checkpoint.sha256[:12]}..., got {got[:12]}...); '
            f'the file was deleted rather than loaded'
        )
    os.replace(partial, target)
    return target


def _download(checkpoint, partial, progress, fetch):
    if fetch is None:
        import requests

        def fetch(url):
            try:
                resp = requests.get(url, stream=True, timeout=(15, 120))
                resp.raise_for_status()
            except requests.RequestException as e:
                raise OSError(str(e)) from e
            return resp

    resp = fetch(checkpoint.url)
    total = checkpoint.size_bytes
    written = 0
    next_report = 0.0
    try:
        with open(partial, 'wb') as fh:
            for block in resp.iter_content(chunk_size=_CHUNK):
                if not block:
                    continue
                fh.write(block)
                written += len(block)
                frac = written / total if total else 0.0
                if progress and frac >= next_report:
                    progress(
                        frac,
                        f'downloading {checkpoint.title} '
                        f'({written / 1e6:.0f}/{total / 1e6:.0f} MB)',
                    )
                    next_report = frac + _REPORT_EVERY
    except Exception as e:
        if isinstance(e, OSError):
            raise
        raise OSError(str(e)) from e
