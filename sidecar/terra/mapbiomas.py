"""
MapBiomas: the raster, and what its class ids mean.

One reader for one external source, like terra/stac.py. Three things were
split across three packages before, and every one of them is a fact about the
source rather than about a product of ours: the window fetched from the Brazil
COG, the legend and colours every raster of these ids is drawn in, and which
ids count as cropland.

That split is what the independence contract refused. The photovoltaic siting
chain needs a MapBiomas window to say what occupies the ground, and the canopy
needs the crop class set to suggest a species; neither is reaching into the
land-cover product, and with the source in one place neither has to.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

MAPBIOMAS_LEGEND = {
    3: "Forest Formation",
    4: "Savanna Formation",
    9: "Forest Plantation",
    11: "Wetland",
    15: "Pasture",
    20: "Sugar Cane",
    21: "Agriculture-Pasture Mosaic",
    24: "Urban Area",
    25: "Non-vegetated Area",
    33: "Water",
    39: "Soybean",
    41: "Other Temporary Crops",
    46: "Coffee",
}

MAPBIOMAS_COLORS = {
    3: "#006400",
    4: "#00ff00",
    9: "#ad4400",
    11: "#45c2a5",
    15: "#ffd966",
    20: "#c59ff4",
    21: "#fff3bf",
    24: "#d4271e",
    25: "#ffa07a",
    33: "#0000ff",
    39: "#f5b3c8",
    41: "#e974ed",
    46: "#d082de",
}

# The closed set the classifier can emit. There is no reject class, so every
# pixel is assigned to whichever of these five is nearest in feature space.
CLASSIFIER_CLASS_IDS = (3, 21, 25, 39, 41)

CLASSIFIER_LEGEND = {cid: MAPBIOMAS_LEGEND[cid] for cid in CLASSIFIER_CLASS_IDS}
CLASSIFIER_COLORS = {cid: MAPBIOMAS_COLORS[cid] for cid in CLASSIFIER_CLASS_IDS}


def hex_to_rgb(hex_color):
    """The three channels of a #rrggbb literal.

    One definition rather than the two this module was written to end: the
    classification path and the reference path each carried their own, beside
    their own colour table.
    """
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# As classes que são lavoura de fato, para mascarar a série de índice.
#
# O MOSAICO AGRICULTURA-PASTAGEM (21) NÃO ENTRA, e essa é a decisão que faz a
# máscara valer alguma coisa. Ele é mistura declarada: incluí-lo devolve para
# dentro da média exatamente a diluição que mascarar existe para tirar. Numa AOI
# medida, soja cobria 50% e mosaico 42%, então incluir o mosaico deixaria 92% da
# área "lavoura" e a média praticamente onde estava.
#
# Cana e café ficam porque são lavoura e a série é sobre a lavoura; que o Helios
# não cresça essas plantas é problema da simulação, não da extração do índice.
CROP_CLASSES = frozenset({
    20,  # Sugar Cane
    39,  # Soybean
    41,  # Other Temporary Crops
    46,  # Coffee
})


def crop_mask(classification_map):
    """Máscara booleana dos pixels de lavoura num mapa de classes.

    `-1` é o que `classify_from_features` escreve onde não houve predição, e cai
    fora por não estar no conjunto.
    """
    import numpy as np

    m = np.asarray(classification_map)
    out = np.zeros(m.shape, dtype=bool)
    for cid in CROP_CLASSES:
        out |= m == cid
    return out


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
