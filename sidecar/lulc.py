"""Land cover / land use analysis from MapBiomas (descriptive, no model).

Used by the geosense-infer sidecar both as a standalone action (`action=lulc`)
and as an attachment to classification results when a MapBiomas raster is available.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.mask import mask as rio_mask
from rasterio.warp import reproject, Resampling
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform
from pyproj import Transformer

# Extended MapBiomas Coleção 10 legend (classes seen on PR farms + study targets).
from class_palette import MAPBIOMAS_LEGEND  # noqa: E402,F401

# Shared with the classification path so both render a class id identically;
# see class_palette.py.
from class_palette import MAPBIOMAS_COLORS  # noqa: E402,F401

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


def pred_vs_ref_composition(pred_map: np.ndarray, ref_map: np.ndarray) -> list[dict]:
    """Compare predicted vs MapBiomas composition on overlapping valid pixels."""
    valid = (pred_map >= 0) & (ref_map > 0)
    n_tot = int(valid.sum())
    rows = []
    for cid in TARGET_COMPARE:
        n_pred = int(((pred_map == cid) & valid).sum())
        n_ref = int(((ref_map == cid) & valid).sum())
        rows.append({
            "class_id": cid,
            "name": MAPBIOMAS_LEGEND.get(cid, f"Class {cid}"),
            "color": MAPBIOMAS_COLORS.get(cid, "#bbbbbb"),
            "pct_ref": float(round(100.0 * n_ref / n_tot, 2)) if n_tot else 0.0,
            "pct_pred": float(round(100.0 * n_pred / n_tot, 2)) if n_tot else 0.0,
        })
    return rows


def analyze_mapbiomas(
    mapbiomas_path: str,
    polygon,
    work_dir: Path | None = None,
    pred_map: np.ndarray | None = None,
    ref_on_pred_grid: np.ndarray | None = None,
    px_ha_override: float | None = None,
) -> dict:
    """
    Build a full LULC analysis payload.

    Prefer clipping the native MapBiomas raster to the polygon. When
    `ref_on_pred_grid` is provided (already reprojected to the Sentinel grid),
    composition uses that grid with `px_ha_override` (typically 0.01 ha @ 10 m).
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
        pred_vs_ref = pred_vs_ref_composition(pred_map, ref_on_pred_grid)

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
