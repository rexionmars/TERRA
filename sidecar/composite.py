"""Band composite / spectral-index rendering helpers (offline-testable)."""

from __future__ import annotations

import numpy as np

# Sentinel-2 L2A band → native resolution used when loading SAFE/STAC assets.
BAND_RESOLUTION = {
    "B02": "10m",
    "B03": "10m",
    "B04": "10m",
    "B05": "20m",
    "B06": "20m",
    "B07": "20m",
    "B08": "10m",
    "B8A": "20m",
    "B11": "20m",
    "B12": "20m",
}

RGB_PRESETS = {
    "true_color": ("B04", "B03", "B02"),
    "false_color_ir": ("B08", "B04", "B03"),
    "agriculture": ("B11", "B08", "B02"),
    "swir": ("B12", "B8A", "B04"),
}

ALLOWED_BANDS = tuple(BAND_RESOLUTION.keys())
ALLOWED_INDICES = ("ndvi", "ndwi", "ndmi", "evi")


def percentile_stretch(
    arr: np.ndarray,
    mask: np.ndarray,
    low: float = 2.0,
    high: float = 98.0,
) -> np.ndarray:
    """Linear stretch of valid pixels to [0, 1] using percentiles."""
    out = np.zeros(arr.shape, dtype=np.float32)
    valid = mask & np.isfinite(arr)
    if not np.any(valid):
        return out
    vals = arr[valid]
    p_lo, p_hi = np.percentile(vals, [low, high])
    if p_hi <= p_lo:
        out[valid] = 0.5
        return out
    scaled = (arr - p_lo) / (p_hi - p_lo)
    out[valid] = np.clip(scaled[valid], 0.0, 1.0)
    return out


def calculate_ndwi(green: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """McFeeters NDWI: (Green - NIR) / (Green + NIR)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        ndwi = (green - nir) / (green + nir)
        ndwi = np.where(np.isfinite(ndwi), ndwi, 0.0)
    return np.clip(ndwi, -1.0, 1.0)


def calculate_ndmi(nir: np.ndarray, swir: np.ndarray) -> np.ndarray:
    """NDMI: (NIR - SWIR) / (NIR + SWIR)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        ndmi = (nir - swir) / (nir + swir)
        ndmi = np.where(np.isfinite(ndmi), ndmi, 0.0)
    return np.clip(ndmi, -1.0, 1.0)


def _lerp_cmap(t: np.ndarray, stops: list[tuple[float, float, float]]) -> np.ndarray:
    """Map t in [0,1] through RGB color stops → (…, 3) float 0–1."""
    t = np.clip(t, 0.0, 1.0)
    n = len(stops) - 1
    idx = np.minimum((t * n).astype(np.int32), n - 1)
    f = t * n - idx
    stops_a = np.array(stops, dtype=np.float32)
    c0 = stops_a[idx]
    c1 = stops_a[idx + 1]
    return c0 + (c1 - c0) * f[..., None]


# Approximate RdYlGn for vegetation indices (low→high).
_RDYLGN = [
    (0.65, 0.0, 0.15),
    (0.96, 0.43, 0.26),
    (0.99, 0.75, 0.39),
    (1.0, 1.0, 0.75),
    (0.67, 0.87, 0.54),
    (0.4, 0.74, 0.39),
    (0.1, 0.47, 0.22),
]

# Blues for water-oriented indices.
_BLUES = [
    (0.97, 0.98, 1.0),
    (0.78, 0.86, 0.94),
    (0.42, 0.68, 0.84),
    (0.19, 0.45, 0.69),
    (0.03, 0.19, 0.42),
]

# ---------------------------------------------------------------- solar ramps
#
# The two ramps above are diverging and hue-coded for a judgement: red is bad,
# green is good, blue is wet. That reading is wrong for a physical quantity, and
# the red-green axis is the one most affected by colour-vision deficiency.
# Irradiation and shading therefore use the perceptually uniform ramps the
# research figures use, so an overlay and a published figure of the same
# quantity are the same colours.
#
# Each is 17 evenly spaced samples of the matplotlib lookup table. Interpolating
# linearly between them departs from the true ramp by at most 6.7/255 (inferno),
# 5.4/255 (viridis) and 7.6/255 (RdBu reversed), which is below a visible step.

# Irradiation, matching the research terrain and seasonal maps.
_INFERNO = [
    (0.0015, 0.0005, 0.0139),
    (0.0423, 0.0281, 0.1411),
    (0.1293, 0.0473, 0.2908),
    (0.2383, 0.0366, 0.3964),
    (0.3415, 0.0623, 0.4294),
    (0.4412, 0.0993, 0.4316),
    (0.5409, 0.1347, 0.4151),
    (0.6401, 0.1714, 0.3811),
    (0.7357, 0.2159, 0.3302),
    (0.8224, 0.2752, 0.2661),
    (0.8943, 0.3534, 0.1936),
    (0.9470, 0.4492, 0.1153),
    (0.9784, 0.5579, 0.0349),
    (0.9879, 0.6753, 0.0653),
    (0.9746, 0.7977, 0.2063),
    (0.9476, 0.9174, 0.4107),
    (0.9884, 0.9984, 0.6449),
]

# Shading loss, matching the research horizon-shading map.
_VIRIDIS = [
    (0.2670, 0.0049, 0.3294),
    (0.2823, 0.0950, 0.4173),
    (0.2788, 0.1755, 0.4834),
    (0.2590, 0.2515, 0.5247),
    (0.2297, 0.3224, 0.5457),
    (0.1994, 0.3876, 0.5546),
    (0.1727, 0.4488, 0.5579),
    (0.1490, 0.5081, 0.5573),
    (0.1276, 0.5669, 0.5506),
    (0.1206, 0.6258, 0.5335),
    (0.1579, 0.6838, 0.5017),
    (0.2461, 0.7389, 0.4520),
    (0.3692, 0.7889, 0.3829),
    (0.5160, 0.8312, 0.2943),
    (0.6785, 0.8637, 0.1895),
    (0.8456, 0.8873, 0.0997),
    (0.9932, 0.9062, 0.1439),
]

# Seasonal ratio. Diverging is right here because the quantity has a reference:
# one means the two seasons deliver the same irradiation.
_RDBU_R = [
    (0.0196, 0.1882, 0.3804),
    (0.0885, 0.3211, 0.5649),
    (0.1634, 0.4450, 0.6975),
    (0.2471, 0.5557, 0.7541),
    (0.4207, 0.6764, 0.8187),
    (0.6065, 0.7898, 0.8803),
    (0.7615, 0.8685, 0.9246),
    (0.8780, 0.9257, 0.9519),
    (0.9691, 0.9665, 0.9649),
    (0.9839, 0.8976, 0.8468),
    (0.9825, 0.8007, 0.7061),
    (0.9603, 0.6678, 0.5363),
    (0.8946, 0.5038, 0.3998),
    (0.8171, 0.3322, 0.2810),
    (0.7285, 0.1550, 0.1974),
    (0.5769, 0.0554, 0.1493),
    (0.4039, 0.0000, 0.1216),
]

# Named ramps, so a response can say which one drew its raster and the client can
# build the matching legend instead of keeping its own transcription.
CONTINUOUS_STOPS = {
    "rdylgn": _RDYLGN,
    "blues": _BLUES,
    "inferno": _INFERNO,
    "viridis": _VIRIDIS,
    "rdbu_r": _RDBU_R,
}


def index_to_rgba(
    index: np.ndarray,
    mask: np.ndarray,
    name: str,
    stretch_low: float = 2.0,
    stretch_high: float = 98.0,
) -> np.ndarray:
    """Colormap a spectral index to RGBA uint8."""
    stretched = percentile_stretch(index.astype(np.float32), mask, stretch_low, stretch_high)
    stops = _BLUES if name in ("ndwi", "ndmi") else _RDYLGN
    rgb = _lerp_cmap(stretched, stops)
    h, w = index.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (rgb[..., 0] * 255).astype(np.uint8)
    rgba[..., 1] = (rgb[..., 1] * 255).astype(np.uint8)
    rgba[..., 2] = (rgb[..., 2] * 255).astype(np.uint8)
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
    return rgba


def rgb_to_rgba(
    r: np.ndarray,
    g: np.ndarray,
    b: np.ndarray,
    mask: np.ndarray,
    stretch_low: float = 2.0,
    stretch_high: float = 98.0,
) -> np.ndarray:
    """Percentile-stretch three reflectance bands to RGBA uint8."""
    rs = percentile_stretch(r, mask, stretch_low, stretch_high)
    gs = percentile_stretch(g, mask, stretch_low, stretch_high)
    bs = percentile_stretch(b, mask, stretch_low, stretch_high)
    h, w = r.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (rs * 255).astype(np.uint8)
    rgba[..., 1] = (gs * 255).astype(np.uint8)
    rgba[..., 2] = (bs * 255).astype(np.uint8)
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
    return rgba


def write_rgba_png(rgba: np.ndarray, out_path) -> None:
    """Write (H,W,4) uint8 PNG via rasterio."""
    import rasterio
    from rasterio.transform import Affine

    h, w = rgba.shape[:2]
    profile = {
        "driver": "PNG",
        "height": h,
        "width": w,
        "count": 4,
        "dtype": "uint8",
        "transform": Affine.identity(),
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def write_rgba_geotiff(rgba: np.ndarray, ref_profile: dict, out_path) -> None:
    """Write (H,W,4) uint8 RGBA GeoTIFF using the reference grid georeferencing."""
    import rasterio

    h, w = rgba.shape[:2]
    profile = {
        "driver": "GTiff",
        "height": h,
        "width": w,
        "count": 4,
        "dtype": "uint8",
        "crs": ref_profile.get("crs"),
        "transform": ref_profile["transform"],
        "compress": "lzw",
        "photometric": "RGB",
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def extent_from_profile(profile: dict) -> dict:
    """Lon/lat bounds from a rasterio-like profile (EPSG:4326 or projected)."""
    from pyproj import Transformer
    from rasterio.transform import array_bounds

    transform = profile["transform"]
    h = profile["height"]
    w = profile["width"]
    left, bottom, right, top = array_bounds(h, w, transform)
    crs = profile.get("crs")
    if crs is None or str(crs) in ("EPSG:4326", "OGC:CRS84"):
        return {
            "lon_min": float(left),
            "lat_min": float(bottom),
            "lon_max": float(right),
            "lat_max": float(top),
        }
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon_a, lat_a = transformer.transform(left, bottom)
    lon_b, lat_b = transformer.transform(right, top)
    return {
        "lon_min": float(min(lon_a, lon_b)),
        "lat_min": float(min(lat_a, lat_b)),
        "lon_max": float(max(lon_a, lon_b)),
        "lat_max": float(max(lat_a, lat_b)),
    }
