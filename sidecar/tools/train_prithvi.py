#!/usr/bin/env python3
"""
Train Random Forest classifiers on Prithvi-EO 2.0 embeddings.

Extracts frozen Prithvi embeddings over a study area (six Sentinel-2 bands, one
representative acquisition) and trains a Random Forest against MapBiomas labels,
in two granularities:

- pixel: one embedding per pixel (comparable to the spectral RF, 10 m).
- patch: one embedding per 16x16 patch (~160 m), expanded to pixels.

Outputs (to --out): prithvi_rf_pixel.joblib, prithvi_scaler_pixel.joblib,
prithvi_rf_patch.joblib, prithvi_scaler_patch.joblib, prithvi_label_encoder.joblib.

Usage:
    python train_prithvi.py \
        --sentinel /Volumes/SanDisk/S2_dalacir_zanatta \
        --kml /Volumes/SanDisk/S2_dalacir_zanatta/KML_Delacir_Zanatta.kml \
        --mapbiomas ../global/data/mapbiomas/mapbiomas_delacir_zanatta_2023.tif \
        --tiles T22JBT T21JZN --out ../model
"""

import argparse
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, cohen_kappa_score, f1_score
from sklearn.preprocessing import LabelEncoder, StandardScaler

SIDECAR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR))

import prithvi  # noqa: E402
from terra import actions  # noqa: E402
from terra.imagery import sentinel2  # noqa: E402

warnings.filterwarnings("ignore")

# Non-observation MapBiomas ids to drop from training.
DROP_CLASSES = (0, 27)


def load_prithvi_band_stack(product, polygon, ref_profile):
    """Load the 6 Prithvi bands to the reference grid, reflectance in [0, 1]."""
    bands = []
    for name, res in [
        ("B02", "10m"), ("B03", "10m"), ("B04", "10m"),
        ("B8A", "20m"), ("B11", "20m"), ("B12", "20m"),
    ]:
        arr = sentinel2.load_band_to_reference_grid(product, name, polygon, ref_profile, resolution=res)
        bands.append(np.clip(arr / 10000.0, 0, 1))
    return np.stack(bands, axis=0).astype(np.float32)  # (6, H, W)


def reproject_mapbiomas(mapbiomas_path, ref_profile, ref_band):
    with rasterio.open(mapbiomas_path) as src:
        mb, mb_t, mb_crs = src.read(1), src.transform, src.crs
    dst = np.zeros((ref_profile["height"], ref_profile["width"]), dtype=np.uint8)
    reproject(
        source=mb.astype(np.uint8), destination=dst,
        src_transform=mb_t, src_crs=mb_crs,
        dst_transform=ref_profile["transform"], dst_crs=ref_profile["crs"],
        resampling=Resampling.nearest,
    )
    dst[~(ref_band > 0)] = 0
    return dst


def report(tag, y, yhat):
    print(f"  [{tag}] OA={accuracy_score(y, yhat):.4f} "
          f"kappa={cohen_kappa_score(y, yhat):.4f} "
          f"f1_macro={f1_score(y, yhat, average='macro'):.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sentinel", required=True)
    ap.add_argument("--kml", required=True)
    ap.add_argument("--mapbiomas", required=True)
    ap.add_argument("--tiles", nargs="*", default=["T22JBT", "T21JZN"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=None,
                    help="representative acquisition YYYY-MM-DD (default: median NDVI date)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    area = actions.parse_kml_coordinates(Path(args.kml), None)
    if area is None:
        sys.exit("polygon not found in KML")
    polygon = area["polygon"]

    products = sentinel2.list_sentinel_products(Path(args.sentinel), tile_list=args.tiles)
    if not products:
        sys.exit("no .SAFE products found")
    # Representative acquisition: a summer soybean date if not specified.
    target = products[len(products) // 2]
    if args.date:
        for p in products:
            if p["date"].strftime("%Y-%m-%d") == args.date:
                target = p
                break
    print(f"Representative acquisition: {target['date'].strftime('%Y-%m-%d')} "
          f"({target['tile']})")

    ref_band, ref_profile = sentinel2.load_and_clip_band(target, "B04", polygon)
    band_stack = load_prithvi_band_stack(target, polygon, ref_profile)
    labels = reproject_mapbiomas(args.mapbiomas, ref_profile, ref_band)

    valid = (ref_band > 0)
    for cls in DROP_CLASSES:
        valid &= (labels != cls)

    y_all = labels[valid]
    le = LabelEncoder()
    y = le.fit_transform(y_all)
    joblib.dump(le, out / "prithvi_label_encoder.joblib")
    print(f"Classes: {list(le.classes_)}  | samples: {y.shape[0]}")

    # --- pixel mode ---
    print("Extracting pixel embeddings (Prithvi)...")
    emb_pix = prithvi.embed_pixels(band_stack, valid)
    sc_pix = StandardScaler().fit(emb_pix)
    Xp = sc_pix.transform(emb_pix)
    rf_pix = RandomForestClassifier(
        n_estimators=300, max_depth=20, min_samples_split=5,
        min_samples_leaf=2, class_weight="balanced", random_state=42, n_jobs=-1,
    ).fit(Xp, y)
    report("pixel/train", y, rf_pix.predict(Xp))
    joblib.dump(rf_pix, out / "prithvi_rf_pixel.joblib")
    joblib.dump(sc_pix, out / "prithvi_scaler_pixel.joblib")

    # --- patch mode ---
    print("Extracting patch embeddings (Prithvi)...")
    emb_map = prithvi.embed_patches(band_stack, valid)
    emb_pat = emb_map[valid]
    sc_pat = StandardScaler().fit(emb_pat)
    Xq = sc_pat.transform(emb_pat)
    rf_pat = RandomForestClassifier(
        n_estimators=300, max_depth=20, min_samples_split=5,
        min_samples_leaf=2, class_weight="balanced", random_state=42, n_jobs=-1,
    ).fit(Xq, y)
    report("patch/train", y, rf_pat.predict(Xq))
    joblib.dump(rf_pat, out / "prithvi_rf_patch.joblib")
    joblib.dump(sc_pat, out / "prithvi_scaler_patch.joblib")

    print(f"Saved Prithvi classifiers to {out}")


if __name__ == "__main__":
    main()
