"""
What a fetched POWER record says, summarised over time.

Everything here reads POWER parameter names and returns a description of the
cell: annual totals, a trend, a monthly climatology, the clearness of the sky
and the beam share of what arrived. Nothing here knows about a collector, which
is the line between this module and terra/energy.

scipy is deferred inside linear_trend. This module is on the canopy path, and
the canopy has no use for a regression.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def annual_totals(daily: pd.DataFrame, column: str = "ALLSKY_SFC_SW_DWN") -> pd.Series:
    """
    Annual sums over complete calendar years only.

    A partial year would read as a low one and would bias both the spread and
    the trend.
    """
    s = daily[column].dropna()
    if s.empty:
        return pd.Series(dtype=float)
    counts = s.groupby(s.index.year).count()
    complete = counts[counts >= 365].index
    return s[s.index.year.isin(complete)].groupby(lambda t: t.year).sum()


def linear_trend(values: pd.Series) -> tuple[float, float]:
    """
    Least-squares slope per year and its two-sided p-value.

    Returns (0, 1) for fewer than three points, which reads as no detectable
    trend rather than as a fitted one.
    """
    if values.size < 3:
        return 0.0, 1.0
    from scipy import stats

    res = stats.linregress(values.index.astype(float), values.values.astype(float))
    return float(res.slope), float(res.pvalue)


def monthly_climatology(daily: pd.DataFrame) -> list[dict]:
    """Mean daily GHI, DNI, DHI and clearness index by calendar month."""
    out: list[dict[str, Any]] = []
    by_month = daily.groupby(daily.index.month)
    for month, block in by_month:
        row: dict[str, Any] = {"month": int(month)}
        for key, name in (
            ("ALLSKY_SFC_SW_DWN", "ghi"),
            ("ALLSKY_SFC_SW_DNI", "dni"),
            ("ALLSKY_SFC_SW_DIFF", "dhi"),
            ("ALLSKY_KT", "kt"),
        ):
            v = block[key].mean() if key in block else np.nan
            row[name] = None if pd.isna(v) else round(float(v), 4)
        out.append(row)
    return out


def clear_sky_index(daily: pd.DataFrame) -> float | None:
    """
    All-sky over clear-sky irradiation: how much of the available resource the
    atmosphere actually delivered.
    """
    if "ALLSKY_SFC_SW_DWN" not in daily or "CLRSKY_SFC_SW_DWN" not in daily:
        return None
    allsky = daily["ALLSKY_SFC_SW_DWN"].sum()
    clear = daily["CLRSKY_SFC_SW_DWN"].sum()
    if not clear or pd.isna(clear) or clear <= 0:
        return None
    return round(float(allsky / clear), 4)


def clearness(df) -> float | None:
    """
    Global irradiance over its clear-sky reference, across the whole record.

    How much of the sun that was available actually arrived: 1.0 is a cloudless
    record, and the difference from 1 is cloud. Measured over the cell this was
    developed against, a 21-day window runs 0.743 in February against 0.927 in
    October -- the same site, two visibly different skies.
    """
    if df is None or len(df) == 0 or "clrsky" not in df.columns:
        return None
    ghi = df["ghi"].to_numpy()
    clear = df["clrsky"].to_numpy()
    ok = np.isfinite(ghi) & np.isfinite(clear) & (clear > 0)
    if not ok.any():
        return None
    total = float(np.sum(clear[ok]))
    return float(np.sum(ghi[ok]) / total) if total > 0 else None


def beam_fraction(df) -> float:
    """
    Share of the horizontal irradiation carried by the beam component.

    Shading removes beam energy only, so the loss fraction is scaled by this
    before it is applied to a plane-of-array total. The published shading layer
    stays unscaled, which is what the research reports.
    """
    ghi = float(np.nansum(df["ghi"].to_numpy()))
    dhi = float(np.nansum(df["dhi"].to_numpy()))
    if ghi <= 0:
        return 0.0
    return float(np.clip((ghi - dhi) / ghi, 0.0, 1.0))


def doy_window_mask(index, centre_date, half_width_days: int = 21):
    """
    Hours whose day of year lies within `half_width_days` of `centre_date`.

    NOT `season_mask`, which is further down this module and selects by NAMED
    season from a month table. This one centres on a date the caller observed,
    which is what a dated question needs and what a fixed set of months cannot
    express.

    WHY A RECORD IS NOT A SKY. A multi-year hourly record answers "what sun does
    this cell get", and averaging all of it answers a question nobody asked: the
    sun of no particular time. For anything dated -- a canopy observed on one
    Sentinel-2 pass, a yield on one harvest -- the season is the larger term.
    Measured on this project's own cached POWER records, faPAR varies by 0.068
    across months at one site against 0.016 across the entire latitude range of
    Brazil, so a whole-record average is wrong by four times the geographic
    signal it was assembled to capture.

    Kept as a day-of-year window rather than a date range so the other years in
    the record still contribute. One February in one year is a few hundred
    daylight hours and a thin histogram; three Februaries is a sky.

    The window wraps at the new year, which is not a detail in the southern
    hemisphere: the December-January window covers the peak of the Brazilian
    summer crop, and a naive `abs(doy - centre)` would cut it in half and keep
    the wrong half.

    Returns a boolean array, or None when there is no date to centre on -- the
    caller then keeps the whole record and says that it did.
    """
    if centre_date is None:
        return None
    try:
        centre = pd.Timestamp(str(centre_date)[:10]).dayofyear
    except (ValueError, TypeError):
        return None

    half = int(half_width_days)
    if half <= 0 or half >= 183:
        return None

    doy = np.asarray(index.dayofyear, dtype=float)
    gap = np.abs(doy - float(centre))
    gap = np.minimum(gap, 366.0 - gap)
    return gap <= half
