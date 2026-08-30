"""Temporal Transformer classifier for geosense-infer (from mestrado)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler

NUM_FRAMES = 22
N_BANDS = 6


class TemporalTransformerClassifier(nn.Module):
    """Transformer encoder over temporal tokens (one token per acquisition)."""

    def __init__(
        self,
        n_bands: int = N_BANDS,
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 3,
        dim_feedforward: int = 256,
        n_classes: int = 5,
        dropout: float = 0.25,
        max_len: int = NUM_FRAMES,
    ):
        super().__init__()
        self.input_proj = nn.Linear(n_bands, d_model)
        self.pos_embed = nn.Parameter(torch.zeros(1, max_len, d_model))
        nn.init.normal_(self.pos_embed, std=0.02)
        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            batch_first=True,
            activation="gelu",
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.norm = nn.LayerNorm(d_model)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(d_model, n_classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        t = x.size(1)
        h = self.input_proj(x) + self.pos_embed[:, :t]
        h = self.encoder(h)
        h = self.norm(h.mean(dim=1))
        return self.head(h)


def pad_temporal(x: np.ndarray, length: int = NUM_FRAMES) -> np.ndarray:
    """Pad/truncate (T, ...) to fixed length along axis 0."""
    t = x.shape[0]
    if t == length:
        return x
    if t > length:
        return x[-length:]
    pad_shape = (length - t,) + x.shape[1:]
    pad = np.repeat(x[-1:], length - t, axis=0) if t else np.zeros(pad_shape, dtype=x.dtype)
    if t:
        return np.concatenate([x, pad], axis=0)
    return pad.astype(x.dtype)


def load_checkpoint(path: Path, device: torch.device | None = None):
    """Load tt_mapbiomas.pt → (model, scaler, class_ids)."""
    device = device or torch.device("cpu")
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    classes = np.asarray(ckpt["classes"])
    arch = ckpt.get("architecture")
    # Checkpoints may store a class name string or a hyperparam dict.
    if not isinstance(arch, dict):
        arch = {}
    model = TemporalTransformerClassifier(
        n_bands=int(ckpt.get("n_bands", N_BANDS)),
        d_model=int(arch.get("d_model", 128)),
        nhead=int(arch.get("nhead", 4)),
        num_layers=int(arch.get("num_layers", 3)),
        dim_feedforward=int(arch.get("dim_feedforward", 256)),
        n_classes=len(classes),
        max_len=int(ckpt.get("num_frames", NUM_FRAMES)),
    )
    model.load_state_dict(ckpt["model_state"])
    model.to(device)
    model.eval()

    scaler = StandardScaler()
    scaler.mean_ = np.asarray(ckpt["scaler_mean"], dtype=np.float64)
    scaler.scale_ = np.asarray(ckpt["scaler_scale"], dtype=np.float64)
    scaler.var_ = scaler.scale_ ** 2
    scaler.n_features_in_ = scaler.mean_.shape[0]
    return model, scaler, classes


@torch.no_grad()
def predict_pixels(
    model: TemporalTransformerClassifier,
    scaler: StandardScaler,
    x: np.ndarray,
    device: torch.device,
    batch_size: int = 256,
) -> tuple[np.ndarray, np.ndarray]:
    """x: (N, T, C) reflectance → (class indices, softmax confidence)."""
    n, t, c = x.shape
    x_scaled = scaler.transform(x.reshape(-1, c)).reshape(n, t, c).astype(np.float32)
    preds, confs = [], []
    for i in range(0, n, batch_size):
        batch = torch.tensor(x_scaled[i : i + batch_size], dtype=torch.float32, device=device)
        probs = torch.softmax(model(batch), dim=1)
        conf, idx = probs.max(dim=1)
        preds.append(idx.cpu().numpy())
        confs.append(conf.cpu().numpy())
    return np.concatenate(preds), np.concatenate(confs)
