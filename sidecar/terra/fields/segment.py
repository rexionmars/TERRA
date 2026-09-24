"""
The network, and running it over a grid of any size.

THE ARCHITECTURE IS READ FROM THE CHECKPOINT. Every FTW semantic checkpoint
is a torchgeo/Lightning file whose hyper-parameters name the decoder, the
encoder, the input channels and the classes; the network is rebuilt from them
with segmentation-models-pytorch and the state dict loaded strictly, as
ftw_tools/inference/models.py load_model_from_checkpoint does. ftw-tools
itself is not a dependency: it pins lightning below 2.6 and torchvision below
0.26, and installing it would downgrade the torch stack the Prithvi path runs
on.

UPSAMPLED BY TWO. `ftw inference run` defaults to --resize_factor 2: the image
is enlarged bilinearly before the network and the prediction brought back to
the 10 m grid by nearest neighbour. The same is done here and recorded in every
result; experiments/field_boundaries.py measures what factor 1 does instead.

TILES WITH A DISCARDED MARGIN. A grid larger than one tile is cut into tiles
that overlap by twice MARGIN and only each tile's centre is kept, so every
kept pixel was predicted with at least MARGIN pixels of context on each side
wherever the image extends that far -- ftw-tools discards a padding of the same
kind (ftw_tools/inference/inference.py, setup_inference).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np

from terra import protocol

CLASS_BACKGROUND = 0
CLASS_INTERIOR = 1
CLASS_BOUNDARY = 2
CLASS_NAMES = ('background', 'interior', 'boundary')

RESIZE = 2
# Sizes in pixels of the upsampled image, multiples of 32 as the U-Net's five
# poolings require.
TILE = 1024
MARGIN = 64


def require_network() -> None:
    """Fail with a sentence when torch or segmentation-models-pytorch is absent."""
    protocol.require_torch('Field boundary delineation')
    try:
        import segmentation_models_pytorch  # noqa: F401
    except ImportError as e:
        raise protocol.MissingDependency(
            'Field boundary delineation needs segmentation-models-pytorch, which '
            'is not installed in this environment. It is one of the optional '
            'packages Settings > System can add, after torch.'
        ) from e


def device():
    import torch

    if torch.backends.mps.is_available():
        return torch.device('mps')
    if torch.cuda.is_available():
        return torch.device('cuda')
    return torch.device('cpu')


def load_network(path: Path):
    """
    The network the checkpoint describes, weights loaded, in eval mode.

    weights_only=False because a Lightning checkpoint pickles its training
    state beside the tensors. The file reaching here has been verified against
    a recorded digest (weights.ensure), which is what makes unpickling it
    acceptable.
    """
    require_network()
    import segmentation_models_pytorch as smp
    import torch

    ckpt = torch.load(path, map_location='cpu', weights_only=False)
    hp = ckpt.get('hyper_parameters', {})
    if hp.get('model') != 'unet':
        raise ValueError(f'unsupported FTW decoder {hp.get("model")!r}; expected unet')
    net = smp.Unet(
        encoder_name=hp['backbone'],
        encoder_weights=None,
        in_channels=int(hp['in_channels']),
        classes=int(hp['num_classes']),
    )
    state = {
        k[len('model.'):]: v
        for k, v in ckpt['state_dict'].items()
        if k.startswith('model.')
    }
    net.load_state_dict(state, strict=True)
    net.eval()
    return net


def tile_origins(size: int, tile: int, margin: int) -> list[int]:
    """Where each kept core starts along one axis; cores tile [0, size) exactly."""
    step = tile - 2 * margin
    if step <= 0:
        raise ValueError('tile must exceed twice the margin')
    return list(range(0, size, step))


def predict(
    net,
    x: np.ndarray,
    resize: int = RESIZE,
    tile: int = TILE,
    margin: int = MARGIN,
    progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """
    Class probabilities, (classes, H, W) float32, for an (8, H, W) input.

    Each tile is padded by replication up to a multiple of 32; replication
    rather than reflection because a tile at the edge of a small grid can be
    narrower than the padding, which reflection refuses.
    """
    import torch
    import torch.nn.functional as F

    dev = device()
    net = net.to(dev)
    h, w = x.shape[-2:]
    xt = torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32))[None]
    if resize > 1:
        xt = F.interpolate(xt, scale_factor=resize, mode='bilinear', align_corners=False)
    big_h, big_w = xt.shape[-2:]
    step = tile - 2 * margin

    rows = tile_origins(big_h, tile, margin)
    cols = tile_origins(big_w, tile, margin)
    total = len(rows) * len(cols)
    out: torch.Tensor | None = None
    done = 0
    with torch.no_grad():
        for r0 in rows:
            for c0 in cols:
                r1, c1 = min(r0 + step, big_h), min(c0 + step, big_w)
                lo_r, lo_c = max(0, r0 - margin), max(0, c0 - margin)
                hi_r, hi_c = min(big_h, r1 + margin), min(big_w, c1 + margin)
                patch = xt[:, :, lo_r:hi_r, lo_c:hi_c]
                pad_h = (-patch.shape[-2]) % 32
                pad_w = (-patch.shape[-1]) % 32
                if pad_h or pad_w:
                    patch = F.pad(patch, (0, pad_w, 0, pad_h), mode='replicate')
                prob = torch.softmax(net(patch.to(dev)), dim=1)[0].float().cpu()
                if out is None:
                    out = torch.zeros((prob.shape[0], big_h, big_w), dtype=torch.float32)
                out[:, r0:r1, c0:c1] = prob[
                    :, r0 - lo_r:r1 - lo_r, c0 - lo_c:c1 - lo_c
                ]
                done += 1
                if progress:
                    progress(done / total)
    assert out is not None
    if resize > 1:
        out = F.interpolate(out[None], size=(h, w), mode='nearest')[0]
    return out.numpy()
