"""
What a fetched POWER record says, summarised over time.

Everything here reads POWER parameter names and returns a description of the
cell: annual totals, a trend, a monthly climatology, the clearness of the sky
and the beam share of what arrived. Nothing here knows about a collector, which
is the line between this module and terra/energy.

scipy is deferred inside linear_trend, so a caller that reads the record
without fitting a trend does not load it.
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
