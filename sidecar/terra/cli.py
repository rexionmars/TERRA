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
    registry.resolve(action)(req, work_dir)
