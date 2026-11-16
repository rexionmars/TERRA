#!/usr/bin/env python3
"""
Build the outlines the trajectory slice tells a field's region by:
terra/trajectory/data/regions.json.

A gp_series model scales its interval by the region it was calibrated on, and
the regions are the states its development fields came from: Bahia, Mato
Grosso and Paraná. The outlines are the IBGE state meshes (API v3 malhas,
quality "maxima", IBGE 2022 territorial division), simplified to within
TOLERANCE_DEG of the mesh and rounded to 4 decimals (about 11 m). A field
whose centroid lies within terra.trajectory.region.MARGIN_M of an outline is
given no region, so neither the simplification nor the rounding can move a
field from one state into another.

The intermediate-quality meshes are smaller and were not used: against the
maximum-quality ones their Hausdorff distance is 7.5 km for Bahia, 3.7 km for
Mato Grosso and 5.7 km for Paraná (measured 2026-11-15), larger than any
margin a field could be asked to keep from a border.

Usage, with network access:

    python sidecar/tools/build_regions.py
"""
from __future__ import annotations

import gzip
import json
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.validation import make_valid

REGIONS = {'BA': 'Bahia', 'MT': 'Mato Grosso', 'PR': 'Paraná'}
URL = (
    'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{code}'
    '?formato=application/vnd.geo%2Bjson&qualidade=maxima'
)
# At most 331 m from the mesh after simplifying (Mato Grosso, measured
# 2026-11-15), six times inside the 2 km margin.
TOLERANCE_DEG = 0.003
DECIMALS = 4
OUT = Path(__file__).resolve().parents[1] / 'terra/trajectory/data/regions.json'


def rounded(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, DECIMALS) for c in coords]
    return [rounded(c) for c in coords]


def main() -> None:
    features = []
    for code, name in REGIONS.items():
        with urllib.request.urlopen(URL.format(code=code), timeout=120) as r:
            body = r.read()
        # The API answers gzip whether or not the request accepts it.
        if body[:2] == b'\x1f\x8b':
            body = gzip.decompress(body)
        mesh = json.loads(body)
        geometry = shape(mesh['features'][0]['geometry'])
        simple = geometry.simplify(TOLERANCE_DEG, preserve_topology=True)
        # Paraná's bay islands can touch the coast once simplified.
        if not simple.is_valid:
            simple = make_valid(simple)
        g = mapping(simple)
        features.append({
            'type': 'Feature',
            'properties': {'code': code, 'name': name},
            'geometry': {'type': g['type'], 'coordinates': rounded(g['coordinates'])},
        })
        print(f'{code}: {geometry.geom_type}, simplified within {TOLERANCE_DEG} degrees')
    collection = {
        'type': 'FeatureCollection',
        'source': 'IBGE, API v3 malhas, estados, qualidade maxima',
        'tolerance_deg': TOLERANCE_DEG,
        'features': features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(collection, ensure_ascii=False, separators=(',', ':')) + '\n',
                   encoding='utf-8')
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
