"""
The three model paths, and what a class map says once one of them has run.

All three emit the same MapBiomas classes, so a run from one is comparable with
a run from another and with the reference. Prithvi and the Temporal Transformer
need PyTorch, which is deliberately outside requirements.txt; both ask for it
through protocol.require_torch so a missing optional package reaches the user
as a sentence rather than as an exit status.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np

from terra import protocol
from terra.imagery import sentinel2
from terra.mapbiomas import (
    CLASSIFIER_COLORS as MAPBIOMAS_COLORS,
    CLASSIFIER_LEGEND as MAPBIOMAS_LEGEND,
)


def classify_from_features(feature_matrix, valid_mask, model, scaler, label_encoder):
    """Apply the trained model; return (H,W) class map and confidence map."""
    height, width = valid_mask.shape
    classification_map = np.full((height, width), -1, dtype=np.int32)
    confidence_map = np.zeros((height, width), dtype=np.float32)
    X_scaled = scaler.transform(feature_matrix)
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X_scaled)
        conf = proba.max(axis=1).astype(np.float32)
        pred_encoded = proba.argmax(axis=1)
    else:
        pred_encoded = model.predict(X_scaled)
        conf = np.ones(len(pred_encoded), dtype=np.float32)
    pred_classes = label_encoder.inverse_transform(pred_encoded)
    rows, cols = np.where(valid_mask)
    classification_map[rows, cols] = pred_classes
    confidence_map[rows, cols] = conf
    return classification_map, confidence_map


def classify_temporal_transformer(products, polygon, ref_profile, model_dir):
    """Classify with the mestrado Temporal Transformer (T×6 reflectance)."""
    protocol.require_torch("The Temporal Transformer")
    import torch

    from terra.landcover import temporal_transformer as tt

    ckpt_path = Path(model_dir) / "tt_mapbiomas.pt"
    if not ckpt_path.exists():
        protocol.fail(f"Temporal Transformer checkpoint missing: {ckpt_path.name}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    model, scaler, classes = tt.load_checkpoint(ckpt_path, device=device)

    band_specs = [
        ("B02", "10m"),
        ("B03", "10m"),
        ("B04", "10m"),
        ("B8A", "20m"),
        ("B11", "20m"),
        ("B12", "20m"),
    ]
    frames = []
    for product in products:
        bands = []
        try:
            for name, res in band_specs:
                arr = sentinel2.load_band_to_reference_grid(
                    product, name, polygon, ref_profile, resolution=res
                )
                bands.append(np.clip(sentinel2.as_trained(arr), 0, 1).astype(np.float32))
            frames.append(np.stack(bands, axis=0))
        except Exception as e:
            sys.stderr.write(json.dumps({"progress": -1, "msg": f"TT band error: {e}"}) + "\n")
            continue
    if not frames:
        protocol.fail("no valid Sentinel-2 frames for Temporal Transformer")

    stack = np.stack(frames, axis=0)  # (T, 6, H, W)
    stack = tt.pad_temporal(stack, tt.NUM_FRAMES)
    t, c, height, width = stack.shape
    valid = stack[:, 2].mean(axis=0) > 0  # mean red > 0
    rows, cols = np.where(valid)
    if rows.size == 0:
        protocol.fail("no valid pixels for Temporal Transformer")

    x = np.stack([stack[:, :, r, c] for r, c in zip(rows, cols)], axis=0).astype(np.float32)
    x = np.clip(x, 0.0, 1.0)

    protocol.emit_progress(70, f"Temporal Transformer inference ({len(x)} pixels)")
    pred_idx, conf = tt.predict_pixels(model, scaler, x, device)
    cls_map = np.full((height, width), -1, dtype=np.int32)
    conf_map = np.zeros((height, width), dtype=np.float32)
    cls_map[rows, cols] = classes[pred_idx]
    conf_map[rows, cols] = conf.astype(np.float32)
    return cls_map, conf_map


def class_statistics(classification_map):
    """Build per-class statistics (pixels, pct, area_ha) at 10 m resolution."""
    valid = classification_map[classification_map >= 0]
    total = int(valid.size)
    stats = []
    if total == 0:
        return stats
    unique_pred, counts = np.unique(valid, return_counts=True)
    for cls_id, count in zip(unique_pred, counts):
        cls_id = int(cls_id)
        stats.append({
            'class_id': cls_id,
            'name': MAPBIOMAS_LEGEND.get(cls_id, f'Class {cls_id}'),
            'color': MAPBIOMAS_COLORS.get(cls_id, '#cccccc'),
            'pixels': int(count),
            'pct': float(round(100.0 * count / total, 2)),
            'area_ha': float(round(count * 100.0 / 10000.0, 2)),
        })
    stats.sort(key=lambda s: s['pixels'], reverse=True)
    return stats


def classify_prithvi(products, polygon, ref_profile, model_dir, mode):
    """
    Classify a representative acquisition using frozen Prithvi-EO 2.0 embeddings
    and the matching Random Forest head. mode is 'pixel' or 'patch'.
    Returns a (H, W) map of MapBiomas class ids (-1 = invalid).
    """
    # prithvi imports torch on the way in, so the same absence surfaces here as
    # an unexplained traceback rather than as a missing package.
    protocol.require_torch("Prithvi-EO 2.0")
    from terra.landcover import prithvi as pv

    rf_path = model_dir / f'prithvi_rf_{mode}.joblib'
    sc_path = model_dir / f'prithvi_scaler_{mode}.joblib'
    le_path = model_dir / 'prithvi_label_encoder.joblib'
    for p in (rf_path, sc_path, le_path):
        if not p.exists():
            protocol.fail(f'Prithvi model artifact missing: {p.name}. Train it with train_prithvi.py')
    rf = joblib.load(rf_path)
    sc = joblib.load(sc_path)
    le = joblib.load(le_path)

    target = products[len(products) // 2]
    protocol.emit_progress(30, f'loading Prithvi bands ({target["date"].strftime("%Y-%m-%d")})')
    bands = []
    for name, res in [('B02', '10m'), ('B03', '10m'), ('B04', '10m'),
                      ('B8A', '20m'), ('B11', '20m'), ('B12', '20m')]:
        arr = sentinel2.load_band_to_reference_grid(target, name, polygon, ref_profile, resolution=res)
        bands.append(np.clip(sentinel2.as_trained(arr), 0, 1))
    band_stack = np.stack(bands, axis=0).astype(np.float32)

    ref0 = bands[2]  # B04
    valid = ref0 > 0
    height, width = valid.shape
    cls_map = np.full((height, width), -1, dtype=np.int32)

    protocol.emit_progress(45, f'extracting Prithvi embeddings ({mode})')
    if mode == 'patch':
        emb_map = pv.embed_patches(band_stack, valid)
        X = emb_map[valid]
    else:
        X = pv.embed_pixels(band_stack, valid)

    protocol.emit_progress(85, 'classifying embeddings')
    X_scaled = sc.transform(X)
    if hasattr(rf, "predict_proba"):
        proba = rf.predict_proba(X_scaled)
        conf = proba.max(axis=1).astype(np.float32)
        pred = le.inverse_transform(proba.argmax(axis=1))
    else:
        pred = le.inverse_transform(rf.predict(X_scaled))
        conf = np.ones(len(pred), dtype=np.float32)
    rows, cols = np.where(valid)
    cls_map[rows, cols] = pred
    conf_map = np.zeros((height, width), dtype=np.float32)
    conf_map[rows, cols] = conf
    return cls_map, conf_map
