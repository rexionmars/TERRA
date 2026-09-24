"""
Field boundaries over a western Paraná box: which FTW checkpoint, at which
input scale.

WHAT THIS IS FOR. The field-boundary product (sidecar/terra/fields) runs one
checkpoint from the Fields of The World baselines at one input scale. Neither
choice can be settled by accuracy here: no reference field polygons for
western Paraná were found, and the FTW training data hold no Paraná field (its
Brazilian samples are presence-only labels from western Bahia, Oldoni et al.,
2020). What can be measured is what each configuration produces over the same
two scenes, and whether that output is plausible for the landscape:

  1. How many fields, how large, and how much of the area each class takes.
  2. Whether the outlines follow the field edges visible in the imagery.
  3. What the input scale does. `ftw inference run` enlarges the image by two
     before the network (--resize_factor 2); the product does the same, and
     this records what factor 1 produces instead.

Configurations: the first FTW release's CC-BY 3-class checkpoint, and the
PRUE checkpoints the product registers (EfficientNet-B3 CC-BY, EfficientNet-B7),
each at factors 1 and 2. The first release is marked legacy in
ftw_tools/inference/model_registry.py and is here as the reference the PRUE
paper compares against.

WHAT IT RUNS. The product's own modules, so the numbers are the product's and
not a re-implementation of it: scene choice, grid, network, tiling and
vectorisation all come from terra.fields.

WHAT IT WRITES, into experiments/data (all regenerable, none versioned):

  field_boundary_scenes.csv     the two scenes chosen and their clear fraction
  field_boundary_runs.csv       one row per configuration
  field_boundary_fields.csv     one row per field per configuration
  field_boundary_outlines.csv   the outline vertices, UTM metres, for drawing
  field_boundary_area.csv       the area outline, UTM metres
  field_boundary_grid.csv       the grid extent the two images are placed on
  field_boundary_window_{a,b}.png   true colour of each scene on the grid

Plotting is plot_field_boundaries.R. The checkpoints are read from, or
downloaded into, the directory the application caches them in, or the one
TERRA_FTW_WEIGHTS names.

    "$HOME/Library/Application Support/terra/python-env/bin/python" \\
        experiments/field_boundaries.py
    Rscript experiments/plot_field_boundaries.R
"""
# %%
from __future__ import annotations

import csv
import os
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / 'sidecar'))

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
DATA.mkdir(exist_ok=True)

from pyproj import Transformer  # noqa: E402
from shapely.geometry import box, shape  # noqa: E402
from shapely.ops import transform as shp_transform  # noqa: E402

from terra import mapbiomas  # noqa: E402
from terra.fields import polygons, scenes, segment, weights  # noqa: E402
from terra.fields.actions import _true_colour_rgba  # noqa: E402
from terra.imagery import cog, composite, grid as ref_grid  # noqa: E402

# The box around the area "drawn 10" in the local store, 4,017 ha.
AREA = box(-53.24, -25.34, -53.18, -25.28)
# The 2024/25 summer season: sowing, then maturity and harvest.
WINDOW_A = ('2024-10-10', '2024-11-30')
WINDOW_B = ('2025-01-10', '2025-03-10')
MAX_CLOUD = 60.0
BUFFER_M = 320.0

# The first FTW release's CC-BY checkpoint, which the product does not
# register. Digest of the file at this URL.
FTW_V1_CCBY = weights.Checkpoint(
    name='FTW_v1_3_Class_CCBY',
    title='FTW v1: CC-BY, 3-Class',
    url='https://github.com/fieldsoftheworld/ftw-baselines/releases/download/'
        'v1/3_Class_CCBY_FTW_Pretrained.ckpt',
    sha256='d04671c498c181a2bca4b9c1a82fb8dcc93384eaf55841cb6672692f6fb21d3c',
    size_bytes=204471122,
    license='CC-BY-4.0',
)
CHECKPOINTS = [
    FTW_V1_CCBY,
    weights.CHECKPOINTS['FTW_PRUE_EFNET_B3_CCBY'],
    weights.CHECKPOINTS['FTW_PRUE_EFNET_B7'],
]
RESIZE_FACTORS = (1, 2)


def weights_dir() -> Path:
    env = os.environ.get('TERRA_FTW_WEIGHTS')
    if env:
        return Path(env)
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'terra' / 'models' / 'ftw'
    return Path.home() / '.local' / 'share' / 'terra' / 'models' / 'ftw'


def write_csv(name: str, rows: list[dict]) -> None:
    path = DATA / name
    with open(path, 'w', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f'  {path.relative_to(REPO)} ({len(rows)} rows)')


def outline_rows(config: str, features: list[dict], to_utm) -> list[dict]:
    """Every ring of every field as ordered vertices in the grid's metres."""
    rows = []
    for f in features:
        geom = shp_transform(to_utm, shape(f['geometry']))
        parts = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
        ring_id = 0
        for part in parts:
            for ring in [part.exterior, *part.interiors]:
                ring_id += 1
                for order, (x, y) in enumerate(ring.coords):
                    rows.append({
                        'config': config,
                        'field': f['properties']['field'],
                        'ring': ring_id,
                        'hole': ring is not part.exterior,
                        'order': order,
                        'x': round(x, 2),
                        'y': round(y, 2),
                    })
    return rows


# %%
def main() -> None:
    cog.configure()
    grid = scenes.reference_grid(AREA, BUFFER_M)
    inside = scenes.area_mask(AREA, grid)
    print(f'Grid: {grid.crs.to_string()}, {grid.width} x {grid.height} px, '
          f'area {inside.sum() * 1e-2:.1f} ha')

    chosen = {}
    for label, (start, end) in (('A', WINDOW_A), ('B', WINDOW_B)):
        found = scenes.search_scenes(grid, start, end, MAX_CLOUD)
        chosen[label] = scenes.choose(found, grid, inside)
        s = chosen[label]
        print(f'Window {label}: {s.date}, {len(s.items)} tiles, '
              f'{100 * s.clear_fraction:.1f}% of the area clear')
    bands_a = scenes.read_bands(chosen['A'], grid)
    bands_b = scenes.read_bands(chosen['B'], grid)
    valid = (
        scenes.usable(chosen['A'].scl) & scenes.usable(chosen['B'].scl)
        & (bands_a > 0).all(axis=0) & (bands_b > 0).all(axis=0)
    )
    x = scenes.network_input(bands_a, bands_b)

    mb_path = mapbiomas.fetch_mapbiomas_window(AREA, DATA)
    cropland = np.isin(
        ref_grid.reproject_to_reference(
            str(mb_path), grid.profile(), np.ones((grid.height, grid.width), np.uint8)
        ),
        list(mapbiomas.CROP_CLASSES),
    )
    in_area = inside & valid

    to_utm = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True).transform
    run_rows, field_rows, outline = [], [], []
    for ckpt in CHECKPOINTS:
        net = segment.load_network(weights.ensure(ckpt, weights_dir()))
        for factor in RESIZE_FACTORS:
            config = f'{ckpt.name}_x{factor}'
            t0 = time.perf_counter()
            probs = segment.predict(net, x, resize=factor)
            seconds = time.perf_counter() - t0
            classes = probs.argmax(axis=0).astype(np.uint8)
            classes[~valid] = 255
            features = polygons.fields_from_classes(
                classes, probs[segment.CLASS_INTERIOR], valid, grid, AREA,
                cropland=cropland,
            )
            summary = polygons.area_summary(features) or {}
            row = {
                'config': config,
                'checkpoint': ckpt.name,
                'license': ckpt.license,
                'resize_factor': factor,
                'inference_s': round(seconds, 2),
                **{
                    f'frac_{name}': round(float((classes[in_area] == i).mean()), 4)
                    for i, name in enumerate(segment.CLASS_NAMES)
                },
                'mean_max_prob': round(float(probs.max(axis=0)[in_area].mean()), 4),
                'n_fields': len(features),
                **{f'area_ha_{k}': v for k, v in summary.items()},
            }
            run_rows.append(row)
            for f in features:
                field_rows.append({'config': config, **f['properties']})
            outline.extend(outline_rows(config, features, to_utm))
            print(f'{config}: {len(features)} fields, median '
                  f'{summary.get("median", float("nan"))} ha, '
                  f'boundary fraction {row["frac_boundary"]}, {seconds:.1f} s')
        del net

    print('Writing:')
    write_csv('field_boundary_scenes.csv', [
        {'window': k, **{kk: (';'.join(v) if isinstance(v, list) else v)
                         for kk, v in s.summary().items()}}
        for k, s in chosen.items()
    ])
    write_csv('field_boundary_runs.csv', run_rows)
    write_csv('field_boundary_fields.csv', field_rows)
    write_csv('field_boundary_outlines.csv', outline)
    area_utm = shp_transform(to_utm, AREA)
    write_csv('field_boundary_area.csv', [
        {'order': i, 'x': round(px, 2), 'y': round(py, 2)}
        for i, (px, py) in enumerate(area_utm.exterior.coords)
    ])
    left, bottom, right, top = grid.bounds
    write_csv('field_boundary_grid.csv', [{
        'crs': grid.crs.to_string(), 'xmin': left, 'xmax': right,
        'ymin': bottom, 'ymax': top, 'width': grid.width, 'height': grid.height,
    }])
    for key, bands in (('a', bands_a), ('b', bands_b)):
        out = DATA / f'field_boundary_window_{key}.png'
        composite.write_rgba_png(_true_colour_rgba(bands, (bands > 0).all(axis=0)), out)
        print(f'  {out.relative_to(REPO)}')


if __name__ == '__main__':
    main()
