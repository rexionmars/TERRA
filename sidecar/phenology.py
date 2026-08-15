"""Phenology helpers for the geosense-infer sidecar.

Ported from mestrado notebooks (phenology_vs_prithvi_ablation,
phenology_state_graph) without research-only dependencies.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np

try:
    from scipy.signal import savgol_filter
except ImportError:  # pragma: no cover
    savgol_filter = None

STATE_SOIL = 0
STATE_GREENUP = 1
STATE_MATURE = 2
STATE_SENESCENCE = 3
STATE_FALLOW = 4

STATE_NAMES = {
    STATE_SOIL: "Bare / low",
    STATE_GREENUP: "Green-up",
    STATE_MATURE: "Peak / mature",
    STATE_SENESCENCE: "Senescence",
    STATE_FALLOW: "Fallow / interim",
}

STATE_COLORS = {
    STATE_SOIL: "#8c510a",
    STATE_GREENUP: "#66c2a5",
    STATE_MATURE: "#006d2c",
    STATE_SENESCENCE: "#fdae61",
    STATE_FALLOW: "#bdbdbd",
}


def _smooth(y: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    if savgol_filter is None or len(y) < 5:
        return y
    w = min(7, len(y) // 2 * 2 + 1)
    return savgol_filter(y, window_length=w, polyorder=2)


def assign_states_from_ndvi(ndvi: np.ndarray) -> np.ndarray:
    """Label each NDVI sample with a phenological state."""
    y = _smooth(np.asarray(ndvi, dtype=float))
    t = len(y)
    if t < 3:
        return np.zeros(t, dtype=np.int64)

    base = float(np.percentile(y, 15))
    peak = float(np.percentile(y, 90))
    amp = max(peak - base, 1e-3)
    thr_low = base + 0.25 * amp
    thr_high = base + 0.60 * amp

    slope = np.gradient(y)
    s_thr = 0.35 * np.std(slope) if np.std(slope) > 1e-6 else 0.01

    """
    LEVEL DECIDES BEFORE SLOPE AT THE TOP OF THE RANGE, and that ordering is the
    whole of this fix.

    Senescence used to be tested before maturity, which labels every peak as
    senescing: a maximum is by definition the point where the derivative turns,
    so the smoothed slope there is already negative while the value is still the
    highest of the season. Measured on a real soybean AOI, the largest NDVI of
    the year -- 0.3142, and the same date `phenology_metrics` independently
    returns as POS -- came back "Senescence", while a lower reading months later
    came back "Peak / mature". Two functions in this module disagreed about
    where the season peaked.

    A sample sitting at or above thr_high is mature whatever its slope is doing.
    Falling is what a canopy does on the way down from mature, so senescence
    still needs a negative slope, but it now only claims the samples that have
    actually left the top.
    """
    states = np.empty(t, dtype=np.int64)
    for i in range(t):
        v, s = y[i], slope[i]
        if v >= thr_high:
            states[i] = STATE_MATURE
        # `v < thr_high` is implied by the branch above, so the original
        # condition is unchanged here rather than merely equivalent: this fix
        # moves one test and rewrites none of the others.
        elif s > s_thr:
            states[i] = STATE_GREENUP
        elif s < -s_thr and v > thr_low:
            states[i] = STATE_SENESCENCE
        elif v <= thr_low:
            states[i] = STATE_SOIL
        else:
            states[i] = STATE_FALLOW
    return states


def _to_ordinal(d) -> int:
    if isinstance(d, datetime):
        return d.toordinal()
    return datetime.strptime(str(d)[:10], "%Y-%m-%d").toordinal()


def phenology_metrics(ndvi, dates, threshold_pct: float = 0.5) -> dict:
    """Compute SOS/POS/EOS/LOS/Peak/Base/Amplitude from an AOI NDVI curve."""
    y = np.asarray(ndvi, dtype=float)
    ords = np.array([_to_ordinal(d) for d in dates], dtype=float)
    valid = np.isfinite(y) & (y != 0)
    empty = {
        "sos_doy": None,
        "pos_doy": None,
        "eos_doy": None,
        "los_days": None,
        "peak": None,
        "base": None,
        "amplitude": None,
    }
    if valid.sum() < 4:
        return empty

    day = np.arange(ords[valid].min(), ords[valid].max() + 1)
    yi = np.interp(day, ords[valid], y[valid])
    if len(yi) >= 7 and savgol_filter is not None:
        w = min(11, len(yi) // 2 * 2 + 1)
        yi = savgol_filter(yi, window_length=w, polyorder=2)

    pos = int(np.argmax(yi))
    peak = float(yi[pos])
    base = float(np.percentile(yi, 10))
    amp = peak - base

    def doy(idx: int) -> float:
        return float(datetime.fromordinal(int(day[idx])).timetuple().tm_yday)

    if amp < 1e-3:
        d = doy(pos)
        return {
            "sos_doy": d,
            "pos_doy": d,
            "eos_doy": d,
            "los_days": 0.0,
            "peak": round(peak, 4),
            "base": round(base, 4),
            "amplitude": 0.0,
        }

    thr = base + threshold_pct * amp
    sos = pos
    for i in range(pos, 0, -1):
        if yi[i] >= thr and yi[i - 1] < thr:
            sos = i
            break
    else:
        above = np.where(yi[: pos + 1] >= thr)[0]
        sos = int(above[0]) if len(above) else 0

    eos = pos
    crossed = False
    for i in range(pos, len(yi) - 1):
        if yi[i] >= thr and yi[i + 1] < thr:
            eos = i
            crossed = True
            break
    if not crossed:
        above = np.where(yi[pos:] >= thr)[0]
        eos = pos + int(above[-1]) if len(above) else pos

    return {
        "sos_doy": round(doy(sos), 1),
        "pos_doy": round(doy(pos), 1),
        "eos_doy": round(doy(eos), 1),
        "los_days": float(max(0, int(day[eos]) - int(day[sos]))),
        "peak": round(peak, 4),
        "base": round(base, 4),
        "amplitude": round(amp, 4),
    }


def state_timeline(ndvi, dates) -> list[dict]:
    """Build per-date phenological state labels for the AOI mean NDVI curve."""
    y = np.asarray(ndvi, dtype=float)
    states = assign_states_from_ndvi(y)
    out = []
    for i, d in enumerate(dates):
        sid = int(states[i]) if i < len(states) else STATE_SOIL
        date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
        out.append(
            {
                "date": date_str,
                "state": sid,
                "state_name": STATE_NAMES.get(sid, str(sid)),
                "color": STATE_COLORS.get(sid, "#cccccc"),
                "ndvi_mean": round(float(y[i]), 4) if np.isfinite(y[i]) else None,
            }
        )
    return out
