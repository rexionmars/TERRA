"""Land cover / land use analysis from MapBiomas (descriptive, no model).

Used by the geosense-infer sidecar both as a standalone action (`action=lulc`)
and as an attachment to classification results when a MapBiomas raster is available.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.mask import mask as rio_mask
from shapely.geometry import mapping
from shapely.ops import transform as shp_transform

# Extended MapBiomas Coleção 10 legend (classes seen on PR farms + study targets).
# Shared with the classification path so both render a class id identically;
# see class_palette.py.
from class_palette import (
    MAPBIOMAS_COLORS,  # noqa: E402,F401
    MAPBIOMAS_LEGEND,  # noqa: E402,F401
)

LULC_GROUP = {
    3: "Natural vegetation",
    4: "Natural vegetation",
    9: "Forestry",
    11: "Natural vegetation",
    15: "Pasture",
    20: "Perennial / semi-perennial",
    21: "Mosaic / mixed",
    24: "Non-agricultural anthropogenic",
    25: "Non-agricultural anthropogenic",
    33: "Water",
    39: "Annual cropland (soybean)",
    41: "Annual cropland (other)",
    46: "Perennial / semi-perennial",
}

GROUP_COLORS = {
    "Natural vegetation": "#006d2c",
    "Forestry": "#ad4400",
    "Pasture": "#ffd966",
    "Mosaic / mixed": "#fee391",
    "Annual cropland (soybean)": "#4292c6",
    "Annual cropland (other)": "#9e9ac8",
    "Perennial / semi-perennial": "#d082de",
    "Non-agricultural anthropogenic": "#d73027",
    "Water": "#3182bd",
    "Other": "#bbbbbb",
}

GROUP_ORDER = [
    "Annual cropland (soybean)",
    "Annual cropland (other)",
    "Mosaic / mixed",
    "Pasture",
    "Natural vegetation",
    "Forestry",
    "Perennial / semi-perennial",
    "Non-agricultural anthropogenic",
    "Water",
    "Other",
]

TARGET_COMPARE = [3, 21, 25, 39, 41]

# MapBiomas Brazil Collection 10 (2023) COG — same source as download_mapbiomas_farms.py
MAPBIOMAS_COG_URL = (
    "https://storage.googleapis.com/mapbiomas-public/"
    "initiatives/brasil/collection_10/lulc/coverage/"
    "brazil_coverage_2023.tif"
)

# Approximate continental Brazil envelope (WGS84).
BRAZIL_BOUNDS = (-74.0, -34.0, -28.0, 6.0)
BUFFER_DEG = 0.01


def _configure_gdal_for_cog():
    import os

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF,.tiff")
    os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
    os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
    os.environ.setdefault("VSI_CACHE", "TRUE")


def polygon_in_brazil(polygon) -> bool:
    minx, miny, maxx, maxy = polygon.bounds
    bminx, bminy, bmaxx, bmaxy = BRAZIL_BOUNDS
    return not (maxx < bminx or minx > bmaxx or maxy < bminy or miny > bmaxy)


def fetch_mapbiomas_window(polygon, work_dir: Path, buffer_deg: float = BUFFER_DEG) -> Path:
    """Stream a MapBiomas COG window for the AOI and write a local GeoTIFF."""
    from rasterio.windows import from_bounds

    if not polygon_in_brazil(polygon):
        raise ValueError(
            "MapBiomas Brazil coverage only — AOI is outside Brazil "
            "(lon/lat bounds do not intersect the country)."
        )

    _configure_gdal_for_cog()
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path = work_dir / "mapbiomas_aoi_2023.tif"

    bounds = polygon.bounds
    bbox = (
        bounds[0] - buffer_deg,
        bounds[1] - buffer_deg,
        bounds[2] + buffer_deg,
        bounds[3] + buffer_deg,
    )

    with rasterio.open(MAPBIOMAS_COG_URL) as src:
        window = from_bounds(*bbox, transform=src.transform)
        data = src.read(1, window=window)
        win_transform = src.window_transform(window)
        profile = src.profile.copy()
        profile.update(
            height=data.shape[0],
            width=data.shape[1],
            transform=win_transform,
            driver="GTiff",
            compress="lzw",
        )

    if data.size == 0 or not np.any(data > 0):
        raise ValueError("No MapBiomas pixels in the AOI window (empty download).")

    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(data, 1)
    return out_path


def resolve_mapbiomas_path(mapbiomas_path, polygon, work_dir: Path) -> str:
    """Use a local raster when present; otherwise fetch the Brazil COG window."""
    if mapbiomas_path and Path(mapbiomas_path).exists():
        return str(mapbiomas_path)
    return str(fetch_mapbiomas_window(polygon, work_dir))


def pixel_area_ha(res, lat: float) -> float:
    dx, dy = abs(res[0]), abs(res[1])
    m_lat = 111_320.0
    m_lon = 111_320.0 * np.cos(np.deg2rad(lat))
    return (dx * m_lon) * (dy * m_lat) / 10_000.0


def hex_to_rgb(h: str):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def shannon_diversity(pcts) -> float:
    p = np.asarray(pcts, dtype=float)
    p = p[p > 0] / 100.0
    if p.size == 0:
        return 0.0
    return float(-(p * np.log(p)).sum())


def pielou_evenness(h: float, n_classes: int) -> float:
    if n_classes <= 1:
        return 0.0
    return float(h / np.log(n_classes))


def clip_mapbiomas_to_polygon(mapbiomas_path: str, polygon) -> tuple[np.ndarray, float, object]:
    """Mask MapBiomas to the AOI polygon. Returns (array, px_ha, transform)."""
    with rasterio.open(mapbiomas_path) as src:
        lat = (src.bounds.top + src.bounds.bottom) / 2.0
        px_ha = pixel_area_ha(src.res, lat)
        poly = polygon
        if src.crs and str(src.crs) not in ("EPSG:4326", "OGC:CRS84"):
            transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
            poly = shp_transform(transformer.transform, polygon)
        clipped, transform = rio_mask(
            src, [mapping(poly)], crop=True, all_touched=True, filled=True, nodata=0
        )
        return clipped[0], px_ha, transform


def composition_from_array(arr: np.ndarray, px_ha: float) -> list[dict]:
    valid = arr > 0
    labels = arr[valid]
    if labels.size == 0:
        return []
    ids, counts = np.unique(labels, return_counts=True)
    rows = []
    for cid, n in zip(ids.tolist(), counts.tolist()):
        cid = int(cid)
        rows.append({
            "class_id": cid,
            "name": MAPBIOMAS_LEGEND.get(cid, f"Class {cid}"),
            "color": MAPBIOMAS_COLORS.get(cid, "#bbbbbb"),
            "group": LULC_GROUP.get(cid, "Other"),
            "pixels": int(n),
            "pct": float(round(100.0 * n / labels.size, 2)),
            "area_ha": float(round(n * px_ha, 3)),
        })
    rows.sort(key=lambda r: r["area_ha"], reverse=True)
    return rows


def groups_from_composition(composition: list[dict]) -> list[dict]:
    bucket: dict[str, dict] = {}
    for row in composition:
        g = row["group"]
        if g not in bucket:
            bucket[g] = {
                "group": g,
                "color": GROUP_COLORS.get(g, "#bbbbbb"),
                "pct": 0.0,
                "area_ha": 0.0,
            }
        bucket[g]["pct"] += row["pct"]
        bucket[g]["area_ha"] += row["area_ha"]
    ordered = []
    for g in GROUP_ORDER:
        if g in bucket:
            item = bucket[g]
            item["pct"] = float(round(item["pct"], 2))
            item["area_ha"] = float(round(item["area_ha"], 3))
            ordered.append(item)
    for g, item in bucket.items():
        if g not in GROUP_ORDER:
            item["pct"] = float(round(item["pct"], 2))
            item["area_ha"] = float(round(item["area_ha"], 3))
            ordered.append(item)
    return ordered


def metrics_from_composition(composition: list[dict], area_ha: float, n_pixels: int) -> dict:
    if not composition:
        return {
            "area_ha": 0.0,
            "n_pixels": 0,
            "n_classes": 0,
            "shannon_h": 0.0,
            "pielou_j": 0.0,
            "dominant_class": "",
            "dominant_pct": 0.0,
            "soja_pct": 0.0,
            "outras_lav_pct": 0.0,
            "agricola_pct": 0.0,
        }
    pcts = [r["pct"] for r in composition]
    h = shannon_diversity(pcts)
    n_cls = len(composition)
    soja = sum(r["pct"] for r in composition if r["class_id"] == 39)
    outras = sum(r["pct"] for r in composition if r["class_id"] == 41)
    agricola = sum(
        r["pct"]
        for r in composition
        if r["group"].startswith("Annual cropland") or r["group"] == "Mosaic / mixed"
    )
    return {
        "area_ha": float(round(area_ha, 3)),
        "n_pixels": int(n_pixels),
        "n_classes": n_cls,
        "shannon_h": float(round(h, 4)),
        "pielou_j": float(round(pielou_evenness(h, n_cls), 4)),
        "dominant_class": composition[0]["name"],
        "dominant_pct": float(composition[0]["pct"]),
        "soja_pct": float(round(soja, 2)),
        "outras_lav_pct": float(round(outras, 2)),
        "agricola_pct": float(round(agricola, 2)),
    }


def write_lulc_png(arr: np.ndarray, out_path: Path) -> None:
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for cid, hex_color in MAPBIOMAS_COLORS.items():
        mask = arr == cid
        if np.any(mask):
            r, g, b = hex_to_rgb(hex_color)
            rgba[mask] = [r, g, b, 255]
    with rasterio.open(
        out_path, "w", driver="PNG", height=h, width=w, count=4, dtype="uint8"
    ) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def reference_cell_grid(
    ref_profile: dict,
    mapbiomas_path: str,
) -> np.ndarray | None:
    """
    Flat index of the native MapBiomas cell each reference-grid pixel came from.

    MapBiomas Collection rasters are native at 30 m. When one is reprojected onto
    the 10 m classification grid, roughly nine destination pixels are filled from
    a single source cell and therefore carry one label observation between them.
    Areas stay correct because area is area, but a count of those pixels is not a
    sample size: it counts each observation about nine times.

    Returns an array shaped like the reference grid, where pixels sharing a value
    were resampled from the same native cell. Adapted from
    mestrado/experiments/class41_decomposition/build_wide_aoi.py.

    Returns None when the MapBiomas raster cannot be opened, so callers keep
    reporting pixel counts rather than an incorrect sample size.
    """
    from rasterio.transform import rowcol as rio_rowcol, xy as rio_xy

    try:
        with rasterio.open(mapbiomas_path) as src:
            mb_transform = src.transform
            mb_crs = src.crs
            mb_width = int(src.width)
    except Exception:
        return None

    height = int(ref_profile["height"])
    width = int(ref_profile["width"])
    rows, cols = np.meshgrid(
        np.arange(height, dtype=np.int64),
        np.arange(width, dtype=np.int64),
        indexing="ij",
    )
    xs, ys = rio_xy(
        ref_profile["transform"], rows.ravel(), cols.ravel(), offset="center"
    )
    tf = Transformer.from_crs(ref_profile["crs"], mb_crs, always_xy=True)
    lon, lat = tf.transform(np.asarray(xs), np.asarray(ys))
    mb_rows, mb_cols = rio_rowcol(mb_transform, lon, lat)
    ids = np.asarray(mb_rows, dtype=np.int64) * mb_width + np.asarray(
        mb_cols, dtype=np.int64
    )
    return ids.reshape(height, width)


def distinct_reference_cells(
    cell_ids: np.ndarray | None, mask: np.ndarray
) -> int | None:
    """
    Number of distinct native reference cells covered by a boolean mask.

    None when the cell mapping is unavailable, which callers report as an absent
    sample size rather than substituting the pixel count.
    """
    if cell_ids is None:
        return None
    if not mask.any():
        return 0
    return int(np.unique(cell_ids[mask]).size)


def _wilson_interval(k: int, n: int, z: float = 1.96) -> list[float]:
    """
    Wilson score interval for a proportion.

    Not the normal approximation: at the accuracies and sample sizes seen here
    the Wald interval runs past 0 or 1 and is known to undercover, while Wilson
    stays inside the unit interval and holds its nominal rate at small n
    (Brown, Cai & DasGupta 2001).
    """
    if n <= 0:
        return [0.0, 0.0]
    p = k / n
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return [
        float(round(100.0 * max(0.0, centre - half), 2)),
        float(round(100.0 * min(1.0, centre + half), 2)),
    ]


#: Blocks per side for the spatial breakdown. Six gives 36 blocks, which is
#: enough for a small AOI to put a usable number of reference cells in most of
#: them while still resolving a corner from a centre.
BLOCKS_PER_SIDE = 6

#: Reference cells a block needs before its agreement is reported as a figure.
#: Below this the percentage is arithmetic rather than a measurement -- three
#: cells can only ever read 0, 33, 67 or 100 -- and reporting it beside blocks
#: of several hundred would invite comparing the two.
MIN_BLOCK_CELLS = 20


def agreement_against_reference(
    pred_map: np.ndarray,
    ref_map: np.ndarray,
    cell_ids: np.ndarray | None = None,
    n_blocks: int = BLOCKS_PER_SIDE,
) -> dict | None:
    """
    Per-cell agreement between the classification and the reference.

    WHY THIS EXISTS BESIDE pred_vs_ref_composition. That function compares the
    two marginal distributions -- how much of each class each map holds. Equal
    marginals are not agreement: a classifier that swaps soybean for other
    temporary crops in equal measure reproduces the reference composition
    exactly while being wrong on every pixel it swapped. The decomposition
    below separates the two, and the composition panel was showing the quantity
    component alone.

    AGGREGATED TO THE REFERENCE CELL, NOT THE PIXEL. MapBiomas is native at
    30 m and is resampled onto the 10 m classification grid, so about nine
    pixels carry one label observation. Counting pixels would state a sample
    size nine times the number of independent labels and an interval about
    three times too narrow. Each native cell contributes one observation: the
    reference label it carries, against the majority class predicted across its
    pixels.

    Returns None when the cell mapping is unavailable, because without it there
    is no honest denominator -- and an accuracy with the wrong n is worse than
    no accuracy, since it is still believed.
    """
    if cell_ids is None:
        return None

    valid = (pred_map >= 0) & (ref_map > 0)
    if not valid.any():
        return None

    cells = cell_ids[valid]
    preds = pred_map[valid]
    refs = ref_map[valid]
    # Where each valid pixel sits, in the same C order `cell_ids[valid]` takes,
    # so the block a cell falls in can be read off after the sort below.
    ys, xs = np.nonzero(valid)

    order = np.argsort(cells, kind="stable")
    cells_s, preds_s, refs_s = cells[order], preds[order], refs[order]
    ys_s, xs_s = ys[order], xs[order]
    # Contiguous runs of one cell id, so each native cell is visited once.
    starts = np.flatnonzero(np.r_[True, cells_s[1:] != cells_s[:-1]])
    bounds = np.r_[starts, cells_s.size]

    classes = list(TARGET_COMPARE)
    index = {c: i for i, c in enumerate(classes)}
    k = len(classes)
    matrix = np.zeros((k, k), dtype=np.int64)  # rows predicted, cols reference
    outside = 0

    # Correct and total per spatial block, filled alongside the matrix.
    h, w = pred_map.shape
    block_n = np.zeros((n_blocks, n_blocks), dtype=np.int64)
    block_hit = np.zeros((n_blocks, n_blocks), dtype=np.int64)

    for a, b in zip(bounds[:-1], bounds[1:]):
        ref_vals = refs_s[a:b]
        # One reference label per native cell; the mode guards a cell straddling
        # a resampling boundary rather than assuming the run is homogeneous.
        rv, rc = np.unique(ref_vals, return_counts=True)
        ref_label = int(rv[int(np.argmax(rc))])
        if ref_label not in index:
            # The reference says something the classifier has no label for --
            # water, urban, forestry. Counting it as an error would conflate
            # "misclassified" with "not in the legend", so it is reported
            # separately instead.
            outside += 1
            continue
        pv, pc = np.unique(preds_s[a:b], return_counts=True)
        pred_label = int(pv[int(np.argmax(pc))])
        if pred_label not in index:
            continue
        matrix[index[pred_label], index[ref_label]] += 1

        # The cell's first pixel places it. Every pixel of a native cell is
        # inside the same 30 m square, so the choice only matters for a cell
        # straddling a block edge -- and any rule has to break such a tie
        # somewhere.
        br = min(n_blocks - 1, int(ys_s[a]) * n_blocks // h)
        bc = min(n_blocks - 1, int(xs_s[a]) * n_blocks // w)
        block_n[br, bc] += 1
        if pred_label == ref_label:
            block_hit[br, bc] += 1

    n = int(matrix.sum())
    if n == 0:
        return None

    correct = int(np.trace(matrix))
    pred_tot = matrix.sum(axis=1)  # predicted totals (rows)
    ref_tot = matrix.sum(axis=0)   # reference totals (cols)

    per_class = []
    for c in classes:
        i = index[c]
        hit = int(matrix[i, i])
        pa = float(round(100.0 * hit / ref_tot[i], 2)) if ref_tot[i] else None
        ua = float(round(100.0 * hit / pred_tot[i], 2)) if pred_tot[i] else None
        per_class.append({
            "class_id": c,
            "name": MAPBIOMAS_LEGEND.get(c, f"Class {c}"),
            "color": MAPBIOMAS_COLORS.get(c, "#bbbbbb"),
            # Producer's accuracy: of the reference cells of this class, the
            # share the classifier found. Its complement is omission.
            "producers_pct": pa,
            "producers_ci": _wilson_interval(hit, int(ref_tot[i])) if ref_tot[i] else None,
            # User's accuracy: of the cells called this class, the share that
            # really are. Its complement is commission.
            "users_pct": ua,
            "users_ci": _wilson_interval(hit, int(pred_tot[i])) if pred_tot[i] else None,
            "n_reference": int(ref_tot[i]),
            "n_predicted": int(pred_tot[i]),
        })

    # Pontius & Millones (2011): total disagreement splits into a quantity term
    # -- the two maps hold different amounts of a class -- and an allocation
    # term -- they hold the same amount in different places. Kappa is omitted
    # deliberately; that paper's argument against it is what this replaces.
    p = matrix / n
    p_pred = p.sum(axis=1)
    p_ref = p.sum(axis=0)
    diag = np.diag(p)
    quantity = float(0.5 * np.abs(p_pred - p_ref).sum())
    allocation = float(
        0.5 * sum(2 * min(p_pred[i] - diag[i], p_ref[i] - diag[i]) for i in range(k))
    )

    return {
        "n_reference_cells": n,
        "overall_pct": float(round(100.0 * correct / n, 2)),
        "overall_ci": _wilson_interval(correct, n),
        "quantity_disagreement_pct": float(round(100.0 * quantity, 2)),
        "allocation_disagreement_pct": float(round(100.0 * allocation, 2)),
        "per_class": per_class,
        # Reference cells whose class the model has no label for. Not errors,
        # but the share of the area the assessment says nothing about.
        "n_outside_legend": int(outside),
        "matrix": matrix.tolist(),
        "matrix_classes": classes,
        "blocks": _block_agreement(block_hit, block_n, n_blocks),
    }


def _block_agreement(
    hit: np.ndarray, total: np.ndarray, n_blocks: int
) -> dict | None:
    """
    Agreement within each spatial block, as a distribution rather than a mean.

    WHY A BREAKDOWN AND NOT ANOTHER SCALAR. `overall_pct` cannot distinguish a
    classifier that is uniformly mediocre from one that is accurate everywhere
    except a corner, and the two call for different work: the first is a model
    problem, the second is usually one landscape -- a floodplain, a reservoir
    margin, a block of a crop the legend has no label for.

    It is also what makes two AOIs comparable on more than one number. A single
    figure per area hides whether the areas differ in level or in evenness, and
    the spread here is the second of those.

    NOT A SIGNIFICANCE TEST. Blocks are a fixed grid over the raster's own
    extent, not a designed sample: they vary in how many reference cells they
    hold, they are not independent of the landscape's own structure, and the
    spread below is descriptive. Olofsson et al. (2014) is the reference for an
    accuracy assessment with a sampling design behind it, and this is not one.
    """
    n = int(total.sum())
    if n == 0:
        return None
    cells = []
    for r in range(n_blocks):
        for c in range(n_blocks):
            t = int(total[r, c])
            if t == 0:
                continue
            cells.append({
                "row": r,
                "col": c,
                "n_reference_cells": t,
                # Reported only where the denominator can carry it; the count
                # travels either way so a reader can see why it is absent.
                "overall_pct": (
                    float(round(100.0 * int(hit[r, c]) / t, 2))
                    if t >= MIN_BLOCK_CELLS
                    else None
                ),
            })
    measured = [c["overall_pct"] for c in cells if c["overall_pct"] is not None]
    if not measured:
        return None
    arr = np.asarray(measured, dtype=np.float64)
    return {
        "rows": n_blocks,
        "cols": n_blocks,
        "min_cells": MIN_BLOCK_CELLS,
        "cells": cells,
        "n_measured": len(measured),
        "median_pct": float(round(float(np.median(arr)), 2)),
        "iqr_pct": float(
            round(float(np.percentile(arr, 75) - np.percentile(arr, 25)), 2)
        ),
        "min_pct": float(round(float(arr.min()), 2)),
        "max_pct": float(round(float(arr.max()), 2)),
    }


def pred_vs_ref_composition(
    pred_map: np.ndarray,
    ref_map: np.ndarray,
    cell_ids: np.ndarray | None = None,
) -> list[dict]:
    """
    Compare predicted vs MapBiomas composition on overlapping valid pixels.

    Percentages are pixel fractions and are unaffected by resampling. The counts
    reported alongside them are not interchangeable: `pixels_ref` counts 10 m
    pixels, while `n_reference_cells` counts the distinct 30 m MapBiomas cells
    those pixels were resampled from, which is the number of independent label
    observations and therefore the denominator an agreement statistic needs.
    """
    valid = (pred_map >= 0) & (ref_map > 0)
    n_tot = int(valid.sum())
    rows = []
    for cid in TARGET_COMPARE:
        pred_mask = (pred_map == cid) & valid
        ref_mask = (ref_map == cid) & valid
        n_pred = int(pred_mask.sum())
        n_ref = int(ref_mask.sum())
        row = {
            "class_id": cid,
            "name": MAPBIOMAS_LEGEND.get(cid, f"Class {cid}"),
            "color": MAPBIOMAS_COLORS.get(cid, "#bbbbbb"),
            "pct_ref": float(round(100.0 * n_ref / n_tot, 2)) if n_tot else 0.0,
            "pct_pred": float(round(100.0 * n_pred / n_tot, 2)) if n_tot else 0.0,
            "pixels_ref": n_ref,
        }
        cells = distinct_reference_cells(cell_ids, ref_mask)
        if cells is not None:
            row["n_reference_cells"] = cells
        rows.append(row)
    return rows


def analyze_mapbiomas(
    mapbiomas_path: str,
    polygon,
    work_dir: Path | None = None,
    pred_map: np.ndarray | None = None,
    ref_on_pred_grid: np.ndarray | None = None,
    px_ha_override: float | None = None,
    cell_ids: np.ndarray | None = None,
) -> dict:
    """
    Build a full LULC analysis payload.

    Prefer clipping the native MapBiomas raster to the polygon. When
    `ref_on_pred_grid` is provided (already reprojected to the Sentinel grid),
    composition uses that grid with `px_ha_override` (typically 0.01 ha @ 10 m).

    `cell_ids` accompanies `ref_on_pred_grid`: on that grid the reference has
    been resampled from 30 m, so pixel counts are not sample sizes. See
    reference_cell_grid.
    """
    from rasterio.transform import array_bounds as rio_array_bounds

    map_png = ""
    transform = None
    if ref_on_pred_grid is not None and px_ha_override is not None:
        arr = np.asarray(ref_on_pred_grid)
        # Treat invalid / nodata as 0
        arr = np.where(arr > 0, arr, 0).astype(np.uint8)
        px_ha = px_ha_override
    else:
        arr, px_ha, transform = clip_mapbiomas_to_polygon(mapbiomas_path, polygon)

    composition = composition_from_array(arr, px_ha)
    n_pixels = int((arr > 0).sum())
    area_ha = float(n_pixels * px_ha)
    groups = groups_from_composition(composition)
    metrics = metrics_from_composition(composition, area_ha, n_pixels)

    if work_dir is not None:
        out = Path(work_dir) / "lulc_map.png"
        write_lulc_png(arr, out)
        map_png = str(out)

    pred_vs_ref = []
    if pred_map is not None and ref_on_pred_grid is not None:
        pred_vs_ref = pred_vs_ref_composition(
            pred_map, ref_on_pred_grid, cell_ids=cell_ids
        )

    # Prefer georeferenced raster bounds for map overlay; fall back to polygon.
    if transform is not None:
        left, bottom, right, top = rio_array_bounds(arr.shape[0], arr.shape[1], transform)
        extent = {
            "lon_min": float(left),
            "lat_min": float(bottom),
            "lon_max": float(right),
            "lat_max": float(top),
        }
    else:
        minx, miny, maxx, maxy = polygon.bounds
        extent = {
            "lon_min": float(minx),
            "lat_min": float(miny),
            "lon_max": float(maxx),
            "lat_max": float(maxy),
        }

    return {
        "year": 2023,
        "source": "MapBiomas Collection 10",
        "map_png": map_png,
        "extent": extent,
        "metrics": metrics,
        "composition": composition,
        "groups": groups,
        "pred_vs_ref": pred_vs_ref,
    }


def analyze_from_request(req: dict) -> dict:
    """Standalone entry used when sidecar action == 'lulc'."""
    from shapely.geometry import shape as shp_shape

    geom = req.get("polygon_geojson")
    if not geom:
        raise ValueError("polygon_geojson is required")
    polygon = shp_shape(geom)
    work_dir = Path(req.get("work_dir") or ".")
    work_dir.mkdir(parents=True, exist_ok=True)

    mb = resolve_mapbiomas_path(req.get("mapbiomas_path"), polygon, work_dir)
    return analyze_mapbiomas(mb, polygon, work_dir=work_dir)
