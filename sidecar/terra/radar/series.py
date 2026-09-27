"""
The arithmetic of a radar series: acquisitions read onto a grid, their means,
the speckle filter, the water share and the harvest window.

Everything here is testable without the network except `read_gamma0`, which
opens the cloud-optimised GeoTIFFs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np

COLLECTION = 'sentinel-1-rtc'
NODATA = -32768.0
# The equivalent number of looks the collection states for IW GRDH
# (sar:looks_equivalent_number); the Lee filter's noise term.
ENL = 4.4
LEE_WINDOW = 7
# An acquisition covering less of the area than this is not counted: the edge
# of a swath cuts a field in two, and half a field is another field's mean.
MIN_VALID = 0.9
# A cell is read as open water where, after the Lee filter, VH is below
# WATER_VH_DB and VV below WATER_VV_DB. Fixed, not fitted to a scene: a
# threshold drawn from each scene's histogram needs water in the scene to find
# the valley, and a field usually holds none.
#
# VH carries the test because wind roughens a water surface and raises VV far
# more than VH. Over a strip of the Itaipu reservoir (n=59 passes, Sep 2025 to
# Apr 2026) the median VV of the water ranged from -21.2 to -14.5 dB with the
# wind, VH from -27.6 to -24.1 dB. "VV < -18 dB" alone called a median 64% of
# the strip water, and none of it on one windy pass; this rule a median 100%,
# 38% at the least. Over a 300 m farmland square, bare after harvest in part of
# the period, both called none of it water in any of 60 passes. VV below -13
# dB is the second condition because smooth bare soil can reach VH -23 dB
# while its VV stays above that.
WATER_VH_DB = -23.0
WATER_VV_DB = -13.0
# The least drop in VH, in dB, read as a harvest, and the least fall of the
# cross ratio that has to come with it. Fixed; see the package note.
HARVEST_DROP_DB = 3.0
CR_DROP_DB = 1.0
# Acquisitions of one orbit needed before a peak and a drop are looked for.
MIN_ORBIT_POINTS = 4


def to_db(power: float | np.ndarray) -> Any:
    return 10.0 * np.log10(power)


@dataclass
class Acquisition:
    """Every item of one date and one relative orbit: one pass over the area."""

    date: str
    relative_orbit: int
    orbit_state: str
    platform: str
    items: list[Any]


def group_acquisitions(items: list[Any]) -> list[Acquisition]:
    """Items grouped into passes, in date order; an item without VV and VH is left out."""
    groups: dict[tuple[str, int], list[Any]] = {}
    for it in items:
        if 'vv' not in it.assets or 'vh' not in it.assets:
            continue
        key = (str(it.properties.get('datetime', ''))[:10], int(it.properties.get('sat:relative_orbit') or 0))
        groups.setdefault(key, []).append(it)
    out = []
    for (d, orbit), members in groups.items():
        p = members[0].properties
        out.append(
            Acquisition(
                date=d,
                relative_orbit=orbit,
                orbit_state=str(p.get('sat:orbit_state') or ''),
                platform=str(p.get('platform') or ''),
                items=sorted(members, key=lambda i: i.id),
            )
        )
    out.sort(key=lambda a: (a.date, a.relative_orbit))
    return out


def read_gamma0(items: list[Any], asset: str, grid, dtype=np.float32) -> np.ndarray:
    """
    One polarisation of every item of a pass mosaicked onto the grid, in linear
    power; NaN where no item has a valid value.

    The slices of one pass hold the same observation where they overlap, so the
    first valid value is kept, the slices in the grid's own UTM zone first.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    from terra.imagery import mosaic

    out = np.full((grid.height, grid.width), np.nan, dtype=dtype)
    own = grid.crs.to_epsg()
    for it in sorted(items, key=lambda i: (mosaic.item_epsg(i) != own, i.id)):
        with rasterio.open(it.assets[asset].href) as src:
            win = mosaic.source_window(src, grid)
            data = src.read(1, window=win, boundless=True, fill_value=NODATA).astype(dtype)
            data[(data == NODATA) | ~np.isfinite(data) | (data <= 0)] = np.nan
            tile = np.full_like(out, np.nan)
            # Bilinear: gamma0 is a continuous quantity, and power, not dB, is
            # what is averaged between cells.
            reproject(
                source=data,
                destination=tile,
                src_transform=src.window_transform(win),
                src_crs=src.crs,
                src_nodata=np.nan,
                dst_transform=grid.transform,
                dst_crs=grid.crs,
                dst_nodata=np.nan,
                resampling=Resampling.bilinear,
            )
        empty = ~np.isfinite(out)
        out[empty] = tile[empty]
    return out


def lee_filter(power: np.ndarray, size: int = LEE_WINDOW, enl: float = ENL) -> np.ndarray:
    """
    Lee's (1980) local-statistics filter on an intensity image, NaN-aware.

    With local mean m and variance v over the window, and the speckle's
    coefficient of variation Cu = 1/sqrt(ENL), each cell becomes
    m + W (x - m), W = max(0, (1 - Cu^2 / Ci^2) / (1 + Cu^2)), Ci^2 = v / m^2.
    A homogeneous area (Ci near Cu) is smoothed to its mean; an edge or a point
    target (Ci well above Cu) keeps its value.
    """
    from scipy.ndimage import uniform_filter

    valid = np.isfinite(power)
    x = np.where(valid, power, 0.0).astype(np.float64)
    w = uniform_filter(valid.astype(np.float64), size=size, mode='constant')
    with np.errstate(invalid='ignore', divide='ignore'):
        m = uniform_filter(x, size=size, mode='constant') / w
        m2 = uniform_filter(x * x, size=size, mode='constant') / w
        v = np.maximum(m2 - m * m, 0.0)
        cu2 = 1.0 / enl
        ci2 = v / (m * m)
        weight = np.clip((1.0 - cu2 / ci2) / (1.0 + cu2), 0.0, 1.0)
        weight = np.where(np.isfinite(weight), weight, 0.0)
        out = m + weight * (x - m)
    out[~valid] = np.nan
    return out.astype(np.float32)


@dataclass
class Observation:
    """One pass over the area: its means, and its images when they are kept."""

    date: str
    relative_orbit: int
    orbit_state: str
    platform: str
    vv_db: float
    vh_db: float
    cr_db: float
    water_fraction: float
    valid_fraction: float
    vv: np.ndarray | None = field(default=None, repr=False)
    vh: np.ndarray | None = field(default=None, repr=False)

    def point(self) -> dict[str, Any]:
        return {
            'date': self.date,
            'relative_orbit': self.relative_orbit,
            'orbit_state': self.orbit_state,
            'platform': self.platform,
            'vv_db': round(self.vv_db, 3),
            'vh_db': round(self.vh_db, 3),
            'cr_db': round(self.cr_db, 3),
            'water_fraction': round(self.water_fraction, 4),
            'valid_fraction': round(self.valid_fraction, 4),
        }


def water_mask(vv: np.ndarray, vh: np.ndarray) -> np.ndarray:
    """Open water, by the two thresholds above, after the Lee filter."""
    with np.errstate(invalid='ignore', divide='ignore'):
        return (to_db(lee_filter(vh)) < WATER_VH_DB) & (to_db(lee_filter(vv)) < WATER_VV_DB)


def measure(acq: Acquisition, vv: np.ndarray, vh: np.ndarray, inside: np.ndarray, keep: bool) -> Observation | None:
    """
    A pass's figures over the area, or None where it saw too little of it.

    The means are taken in power and converted afterwards: the mean of dB
    values is the log of a geometric mean, which speckle biases low.
    """
    ok = inside & np.isfinite(vv) & np.isfinite(vh)
    n_inside = int(inside.sum())
    if n_inside == 0:
        return None
    valid = float(ok.sum()) / n_inside
    if valid < MIN_VALID:
        return None
    vv_mean = float(np.mean(vv[ok]))
    vh_mean = float(np.mean(vh[ok]))
    water = ok & water_mask(vv, vh)
    return Observation(
        date=acq.date,
        relative_orbit=acq.relative_orbit,
        orbit_state=acq.orbit_state,
        platform=acq.platform,
        vv_db=float(to_db(vv_mean)),
        vh_db=float(to_db(vh_mean)),
        cr_db=float(to_db(vh_mean / vv_mean)),
        water_fraction=float(water.sum()) / float(ok.sum()),
        valid_fraction=valid,
        vv=vv if keep else None,
        vh=vh if keep else None,
    )


# --- Canopy losses (harvests) ----------------------------------------------
#
# A period that spans a winter crop and a summer crop holds two harvests, and
# the largest drop alone reported one of them: in western Parana the winter
# crop leaves in September or October and the soybean from January to March.
# So every qualifying drop is reported, in date order.


def orbit_losses(obs: list[Observation]) -> list[dict[str, Any]]:
    """
    Every canopy loss in one orbit's series: a VH drop of at least
    HARVEST_DROP_DB between consecutive passes, with the cross ratio falling by
    at least CR_DROP_DB and standing above the orbit's median before it.

    The cross ratio is the canopy test. Soil moisture moves VV and VH together
    and leaves it nearly where it was, so the drying after rain -- which took
    VH down by 3 to 4 dB over every square tested in October 2025 -- does not
    qualify; a canopy removed takes VH down more than VV. Standing above the
    median says there was a canopy to remove.
    """
    s = sorted(obs, key=lambda o: o.date)
    if len(s) < MIN_ORBIT_POINTS:
        return []
    cr_median = float(np.median([o.cr_db for o in s]))
    out = []
    for a, b in zip(s, s[1:], strict=False):
        drop = a.vh_db - b.vh_db
        cr_drop = a.cr_db - b.cr_db
        if drop >= HARVEST_DROP_DB and cr_drop >= CR_DROP_DB and a.cr_db > cr_median:
            out.append(
                {
                    'relative_orbit': a.relative_orbit,
                    'orbit_state': a.orbit_state,
                    'date_from': a.date,
                    'date_to': b.date,
                    'drop_db': round(drop, 3),
                    'cr_drop_db': round(cr_drop, 3),
                }
            )
    return out


def _midpoint(a: str, b: str) -> str:
    return date.fromordinal((date.fromisoformat(a).toordinal() + date.fromisoformat(b).toordinal()) // 2).isoformat()


def losses(obs: list[Observation]) -> list[dict[str, Any]]:
    """
    Canopy losses across orbits, one per event, in date order.

    The losses of different orbits whose windows overlap are one event. Its
    window is where they all overlap, narrower than any one orbit's; where the
    overlap is empty the orbits disagree on when, and the event spans them all
    with `orbits_agree` false. An event seen by one orbit keeps that orbit's
    window: the revisit of one orbit is twelve days with one satellite.
    """
    by_orbit: dict[int, list[Observation]] = {}
    for o in obs:
        by_orbit.setdefault(o.relative_orbit, []).append(o)
    found = sorted(
        (x for _, v in sorted(by_orbit.items()) for x in orbit_losses(v)),
        key=lambda x: (x['date_from'], x['date_to']),
    )
    events: list[list[dict[str, Any]]] = []
    for x in found:
        if events and x['date_from'] < max(e['date_to'] for e in events[-1]):
            events[-1].append(x)
        else:
            events.append([x])
    out = []
    for group in events:
        lo = max(e['date_from'] for e in group)
        hi = min(e['date_to'] for e in group)
        agree = lo < hi
        if not agree:
            lo = min(e['date_from'] for e in group)
            hi = max(e['date_to'] for e in group)
        out.append(
            {
                'date': _midpoint(lo, hi),
                'date_from': lo,
                'date_to': hi,
                'orbits_agree': agree,
                'n_orbits': len({e['relative_orbit'] for e in group}),
                'drop_db': max(e['drop_db'] for e in group),
                'cr_drop_db': max(e['cr_drop_db'] for e in group),
            }
        )
    return out


def orbits(obs: list[Observation]) -> list[dict[str, Any]]:
    """Each relative orbit read, its direction and how many passes it gave."""
    seen: dict[int, dict[str, Any]] = {}
    for o in obs:
        e = seen.setdefault(o.relative_orbit, {'relative_orbit': o.relative_orbit, 'orbit_state': o.orbit_state, 'n': 0})
        e['n'] += 1
    return [seen[k] for k in sorted(seen)]


def composite_rgba(vv: np.ndarray, vh: np.ndarray, outside: np.ndarray) -> np.ndarray:
    """
    The usual dual-polarisation false colour: red VV, green VH, blue VV/VH, all
    Lee-filtered and in dB, each stretched over fixed ranges so two dates are
    drawn on one scale.
    """
    vv_db = to_db(lee_filter(vv))
    vh_db = to_db(lee_filter(vh))
    ratio = vv_db - vh_db
    channels = [
        (vv_db, -20.0, 0.0),
        (vh_db, -28.0, -8.0),
        (ratio, 2.0, 14.0),
    ]
    h, w = vv.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    ok = np.isfinite(vv_db) & np.isfinite(vh_db) & ~outside
    for c, (x, lo, hi) in enumerate(channels):
        t = np.clip((np.nan_to_num(x, nan=lo) - lo) / (hi - lo), 0.0, 1.0)
        rgba[..., c] = (t * 255).astype(np.uint8)
    rgba[..., 3] = np.where(ok, 255, 0).astype(np.uint8)
    return rgba


def water_rgba(vv: np.ndarray, vh: np.ndarray, outside: np.ndarray) -> np.ndarray:
    """Water cells in blue, the rest of the area in a faint grey, outside clear."""
    rgba = np.zeros((*vv.shape, 4), dtype=np.uint8)
    ok = np.isfinite(vv) & np.isfinite(vh) & ~outside
    rgba[ok] = (200, 200, 200, 70)
    rgba[ok & water_mask(vv, vh)] = (0, 114, 178, 230)
    return rgba

