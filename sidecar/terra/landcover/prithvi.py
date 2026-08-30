"""
Prithvi-EO 2.0 embedding extraction for geosense-infer.

Loads the frozen prithvi_eo_v2_300 backbone (IBM/NASA geospatial foundation
model) via TerraTorch and produces 1024-dimensional embeddings in two modes:

- pixel: each pixel is replicated to a 16x16 tile and encoded independently,
  yielding one embedding per pixel (same granularity as the spectral RF, 10 m).
- patch: the area is encoded as spatial tiles and each 16x16 patch (~160 m)
  receives one embedding, expanded back to the pixel grid.

The backbone uses six Sentinel-2 bands (B02, B03, B04, B8A, B11, B12). A single
temporal frame is used (num_frames=1) for a representative acquisition.
"""

import numpy as np
import torch
import torch.nn.functional as F

MODEL_NAME = "prithvi_eo_v2_300"
PRITHVI_BANDS = ["BLUE", "GREEN", "RED", "NIR_NARROW", "SWIR_1", "SWIR_2"]
# Sentinel-2 band names required for Prithvi (note B8A/B11/B12 at 20 m).
PRITHVI_S2_BANDS = ["B02", "B03", "B04", "B8A", "B11", "B12"]
EMBED_DIM = 1024
PATCH = 16

_MODEL = None
_DEVICE = None


def get_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_backbone():
    """Load and cache the frozen Prithvi backbone on the best available device."""
    global _MODEL, _DEVICE
    if _MODEL is not None:
        return _MODEL, _DEVICE
    try:
        from terratorch.registry import BACKBONE_REGISTRY
    except ImportError as e:
        raise ImportError(
            "Prithvi requires terratorch>=1.2 compatible with the installed torchgeo. "
            "In the geosense env run: uv pip install 'terratorch>=1.2'. "
            f"Original error: {e}"
        ) from e

    _DEVICE = get_device()
    model = BACKBONE_REGISTRY.build(
        MODEL_NAME, pretrained=True, num_frames=1, bands=PRITHVI_BANDS
    )
    model = model.to(_DEVICE).eval()
    for p in model.parameters():
        p.requires_grad_(False)
    _MODEL = model
    return _MODEL, _DEVICE


def _last_block(outputs):
    """Return the last transformer block output as (B, tokens, D)."""
    return outputs[-1] if isinstance(outputs, (list, tuple)) else outputs


def embed_pixels(band_stack, valid_mask, batch_size=256):
    """
    Per-pixel embeddings. Each valid pixel is replicated to a 16x16 tile and
    encoded; the patch tokens (excluding CLS) are mean-pooled to a 1024-d vector.

    Parameters:
        band_stack: (6, H, W) float32 reflectance in [0, 1], Prithvi band order.
        valid_mask: (H, W) boolean.

    Returns:
        (N_valid, 1024) float32 embeddings aligned to valid pixels (row-major).
    """
    model, device = load_backbone()
    c, h, w = band_stack.shape
    flat = band_stack.reshape(c, -1).T  # (H*W, 6)
    idx = np.where(valid_mask.reshape(-1))[0]
    pixels = flat[idx]  # (N, 6)

    embeddings = np.zeros((pixels.shape[0], EMBED_DIM), dtype=np.float32)
    n = pixels.shape[0]
    for start in range(0, n, batch_size):
        end = min(start + batch_size, n)
        chunk = pixels[start:end]  # (b, 6)
        b = chunk.shape[0]
        # (b, 6) -> (b, 6, 1, 1, 1) -> replicate to (b, 6, 1, 16, 16)
        t = torch.from_numpy(chunk).float().to(device)
        t = t.view(b, c, 1, 1, 1).expand(b, c, 1, PATCH, PATCH).contiguous()
        with torch.no_grad():
            out = _last_block(model(t))
        # (b, tokens, D) -> drop CLS, mean over patch tokens
        emb = out[:, 1:, :].mean(dim=1) if out.shape[1] > 1 else out[:, 0, :]
        embeddings[start:end] = emb.cpu().numpy()
    return embeddings


def embed_patches(band_stack, valid_mask, tile=224):
    """
    Per-patch spatial embeddings. The area is encoded in spatial tiles; each
    16x16 patch token becomes one 1024-d embedding, expanded to the pixel grid.

    Returns:
        emb_map: (H, W, 1024) float32 (patch embedding broadcast over its pixels)
    """
    model, device = load_backbone()
    c, h, w = band_stack.shape
    emb_map = np.zeros((h, w, EMBED_DIM), dtype=np.float32)

    grid = tile // PATCH  # patch tokens per side
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
            sub = band_stack[:, y0:y1, x0:x1]
            sh, sw = sub.shape[1], sub.shape[2]
            # pad to full tile (replicate) so the token grid is regular
            t = torch.from_numpy(sub).float().to(device).unsqueeze(0).unsqueeze(2)
            t = F.pad(t, (0, tile - sw, 0, tile - sh, 0, 0), mode="replicate")
            with torch.no_grad():
                out = _last_block(model(t))
            tokens = out[0, 1:, :] if out.shape[1] > 1 else out[0]
            tokens = tokens.cpu().numpy().reshape(grid, grid, EMBED_DIM)
            # expand each patch token over its 16x16 pixel block
            block = np.repeat(np.repeat(tokens, PATCH, axis=0), PATCH, axis=1)
            emb_map[y0:y1, x0:x1] = block[:sh, :sw]
    return emb_map
