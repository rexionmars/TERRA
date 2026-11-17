#!/usr/bin/env python3
"""
Measure a Sentinel-1 source over open water and over farmland: the figures
behind terra/radar/series.py CALIBRATIONS.

A threshold in dB holds for the processing chain it was measured on, so a
second source of Sentinel-1 gets thresholds of its own, measured the way the
first source's were and on the same passes where both have them.

What is measured, per pass and per area, on TERRA's 10 m grid and through the
reader the radar product uses (stac.search, series.group_acquisitions,
series.read_gamma0):

- the median over the area of VV and VH in dB, after the Lee filter run with
  the source's equivalent number of looks;
- the share of the area the water rule calls water, with the Planetary
  Computer's thresholds and, where the source has a calibration of its own,
  with its own;
- the equivalent number of looks over the water strip, mean squared over
  variance of VV power before the filter. Calm open water is the most uniform
  surface a radar sees, and on the grid as read, which is where the filter
  works, so the figure is the one the filter needs. For the Planetary Computer
  it is a check of the method against the 4.4 its collection states.

Two runs, one per source, each writing a JSON file; then `compare` pairs their
passes by date and relative orbit and gives the offset between the sources.

Usage, with network access (OPERA also needs EARTHDATA_TOKEN):

    python sidecar/tools/radar_calibration.py measure planetary-computer pc.json
    python sidecar/tools/radar_calibration.py measure opera opera.json
    python sidecar/tools/radar_calibration.py compare pc.json opera.json
"""
from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

# The open-water strip, 1 km by 300 m in the Itaipu reservoir off Santa
# Helena, 2.5 km from the nearest shore in the Sentinel-2 scene classification
# of 2025-08-29 (every cell class 6, water). The farmland square, 300 m, near
# Toledo, Paraná.
WATER = (-54.4212, -24.8657, -54.4113, -24.8631)
LAND = (-53.7515, -24.7265, -53.7485, -24.7235)
START, END = '2025-09-01', '2026-04-30'
READERS = 8


def measure(source: str, out: Path) -> None:
    os.environ['TERRA_SENTINEL1_SOURCE'] = source

    from rasterio.warp import transform_bounds
    from shapely.geometry import box

    from terra import stac
    from terra.imagery import cog, mosaic
    from terra.radar import series

    cog.configure()
    cal = series.CALIBRATIONS.get(source, series.PLANETARY_COMPUTER)
    rows: list[dict] = []
    for name, bounds in (('water', WATER), ('land', LAND)):
        polygon = box(*bounds)
        grid = mosaic.reference_grid(polygon, 0.0)
        inside = mosaic.area_mask(polygon, grid)
        bbox = transform_bounds(grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21)
        passes = series.group_acquisitions(
            stac.search(series.COLLECTION, bbox=bbox, datetime=f'{START}/{END}')
        )
        print(f'{source} {name}: {len(passes)} passes', file=sys.stderr, flush=True)

        def read(acq, polygon_inside=inside, grid=grid, name=name):
            vv = series.read_gamma0(acq.items, 'vv', grid)
            vh = series.read_gamma0(acq.items, 'vh', grid)
            ok = polygon_inside & np.isfinite(vv) & np.isfinite(vh)
            if ok.sum() < series.MIN_VALID * polygon_inside.sum():
                return None
            with np.errstate(invalid='ignore', divide='ignore'):
                vv_db = series.to_db(series.lee_filter(vv, enl=cal.enl))[ok]
                vh_db = series.to_db(series.lee_filter(vh, enl=cal.enl))[ok]
            row = {
                'area': name,
                'date': acq.date,
                'relative_orbit': acq.relative_orbit,
                'vv_db': float(np.median(vv_db)),
                'vh_db': float(np.median(vh_db)),
                'water_share_pc': float(np.mean(
                    (vh_db < series.PLANETARY_COMPUTER.water_vh_db)
                    & (vv_db < series.PLANETARY_COMPUTER.water_vv_db)
                )),
                'water_share': float(np.mean((vh_db < cal.water_vh_db) & (vv_db < cal.water_vv_db))),
            }
            if name == 'water':
                p = vv[ok].astype(np.float64)
                row['enl_vv'] = float(p.mean() ** 2 / p.var())
            return row

        with ThreadPoolExecutor(max_workers=READERS) as pool:
            for row in pool.map(read, passes):
                if row is not None:
                    rows.append(row)
    rows.sort(key=lambda r: (r['area'], r['date'], r['relative_orbit']))
    out.write_text(json.dumps({'source': source, 'rows': rows}, indent=1))
    summarise(source, rows)


def summarise(source: str, rows: list[dict]) -> None:
    for area in ('water', 'land'):
        a = [r for r in rows if r['area'] == area]
        if not a:
            continue
        vv = [r['vv_db'] for r in a]
        vh = [r['vh_db'] for r in a]
        share = [r['water_share_pc'] for r in a]
        own = [r['water_share'] for r in a if 'water_share' in r]
        print(
            f'{source:20s} {area:5s} n={len(a):3d}  '
            f'VV {min(vv):6.1f} .. {max(vv):6.1f} (median {np.median(vv):6.1f})  '
            f'VH {min(vh):6.1f} .. {max(vh):6.1f} (median {np.median(vh):6.1f})  '
            f'PC rule water share median {np.median(share):.2f}, least {min(share):.2f}'
            + (f'; own rule median {np.median(own):.3f}, least {min(own):.3f}, most {max(own):.3f}'
               if own else '')
        )
    enl = [r['enl_vv'] for r in rows if 'enl_vv' in r]
    if enl:
        print(f'{source:20s} ENL over water: median {np.median(enl):.2f} '
              f'(quartiles {np.percentile(enl, 25):.2f} to {np.percentile(enl, 75):.2f})')


def compare(a_path: Path, b_path: Path) -> None:
    a, b = json.loads(a_path.read_text()), json.loads(b_path.read_text())
    index = {(r['area'], r['date'], r['relative_orbit']): r for r in a['rows']}
    for area in ('water', 'land'):
        pairs = [
            (index[k], r)
            for r in b['rows']
            if r['area'] == area and (k := (area, r['date'], r['relative_orbit'])) in index
        ]
        if not pairs:
            print(f'{area}: no pass in both')
            continue
        dvv = np.array([y['vv_db'] - x['vv_db'] for x, y in pairs])
        dvh = np.array([y['vh_db'] - x['vh_db'] for x, y in pairs])
        print(
            f'{area:5s} {len(pairs)} passes in both; {b["source"]} minus {a["source"]}: '
            f'VV median {np.median(dvv):+.2f} dB (quartiles {np.percentile(dvv, 25):+.2f} '
            f'to {np.percentile(dvv, 75):+.2f}), VH median {np.median(dvh):+.2f} dB '
            f'(quartiles {np.percentile(dvh, 25):+.2f} to {np.percentile(dvh, 75):+.2f})'
        )


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    if sys.argv[1:2] == ['measure'] and len(sys.argv) == 4:
        measure(sys.argv[2], Path(sys.argv[3]))
    elif sys.argv[1:2] == ['compare'] and len(sys.argv) == 4:
        compare(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        sys.exit(__doc__)
