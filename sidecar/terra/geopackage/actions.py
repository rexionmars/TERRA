"""The GeoPackage action: list a file's layers and write each as GeoJSON for the map."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from terra.geopackage.reader import GeoPackageError, open_layers
from terra.protocol import Request


def open_file(req: Request, work_dir: Path) -> None:
    """Writes `{"geopackage": {"layers": [...]}}`, each drawable layer's file in work_dir."""
    path = str(req.get('path') or '').strip()
    if not path:
        raise GeoPackageError('no GeoPackage file was named')
    layers = open_layers(path, str(work_dir))
    sys.stdout.write(json.dumps({'geopackage': {'layers': layers}}, allow_nan=False))
    sys.stdout.flush()
