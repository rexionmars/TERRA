"""
The month windows a seasonal figure is cut on.

Read by two products in this slice -- the seasonal irradiation maps and the
plant chain's seasonal energies -- so it sits beside neither. Thin on purpose:
a season is a definition, and a definition stated twice is a definition that
disagrees with itself.

NOT terra.sun.record.doy_window_mask, which selects a window of days around a
date for a canopy that grew in it. This selects by NAMED season from a month
table.
"""

from __future__ import annotations

import numpy as np

# --------------------------------------------------------------------- seasons
#
# The annual map averages a geometry that reverses within the year: a
# north-facing slope receives far more than a south-facing one in winter and
# marginally less in summer. A quantity read from the annual map alone is the
# mean of two opposite situations, so the windows are carried explicitly.
SEASONS = {
    "annual": list(range(1, 13)),
    "winter": [6, 7, 8],
    "summer": [12, 1, 2],
    # Sowing to harvest of the western Parana winter cereals.
    "winter_crop": [5, 6, 7, 8, 9],
}


def season_mask(index, season: str) -> np.ndarray:
    return np.isin(index.month, SEASONS[season])


def season_years(index, season: str) -> float:
    """Seasons covered, so a total is per season rather than per record."""
    months = SEASONS[season]
    n_hours = int(season_mask(index, season).sum())
    denom = 8766.0 * len(months) / 12.0
    return (n_hours / denom) if denom > 0 else 1.0
