"""
The entry point: one request in, one result out, then the process ends.

Kept apart from the products so that reading how the sidecar is invoked does
not mean reading what it computes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from terra import protocol, registry


def main() -> None:
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        protocol.fail(f'invalid request JSON: {e}')

    action = req.get('action', registry.DEFAULT_ACTION)
    work_dir = Path(req.get('work_dir', '.'))
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        registry.resolve(action)(req, work_dir)
    except protocol.MissingDependency as e:
        # Raised from wherever the optional package was needed, which is a
        # product module: those do not end the process, and this is where the
        # process is owned.
        protocol.fail(str(e))
    except protocol.Unavailable as e:
        # Something the run needs is not there and no code change will make it
        # appear: a database that is not running, a record that was never
        # loaded. Reported as the sentence the raiser wrote, for the same
        # reason MissingDependency is -- the alternative reaches the settings
        # screen as a traceback, which says the process failed without saying
        # what to do about it.
        protocol.fail(str(e))


# Lightweight health check used by the desktop boot footer.
def ping(req: protocol.Request, work_dir: Path) -> None:
    sys.stdout.write(json.dumps({
        'ok': True,
        'python': sys.version.split()[0],
        'sidecar': 'infer.py',
    }))
    sys.stdout.flush()
