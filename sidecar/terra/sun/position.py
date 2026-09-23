"""
Where the sun was, and how much beam energy came from there.

pvlib is deferred inside prepare_hourly and must stay that way. It is the
heaviest dependency the sidecar reaches, and prepare_hourly is called by
every wind run through the modules beside it; hoisting the import
would load pvlib on runs that never touch a photovoltaic array, and nothing
would fail to say so.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Hourly values are hour-averaged fluxes labelled by the hour they begin, so
# solar geometry is evaluated at the mid-point of the interval.
HOUR_LABEL_OFFSET_MIN = 30


# Sectors of the horizon, and therefore of the sky the sun crosses. It lives
# here, beside beam_energy_histogram, because a solar azimuth indexes straight
# into the horizon array terra.energy.terrain_irradiance builds: the two sector
# counts have to be the same number, and two literals is how they stop being.
N_HORIZON_AZIMUTHS = 16


def prepare_hourly(hourly: pd.DataFrame, lat: float, lon: float, elevation: float):
    """
    Hourly irradiance and solar position on a shared index.

    Geometry is evaluated at the mid-point of each interval because POWER
    labels an hour-averaged flux by the hour it begins.
    """
    import pvlib

    df = pd.DataFrame(
        {
            "ghi": hourly["ALLSKY_SFC_SW_DWN"],
            "dni": hourly["ALLSKY_SFC_SW_DNI"],
            "dhi": hourly["ALLSKY_SFC_SW_DIFF"],
            "temp_air": hourly["T2M"],
            "wind": hourly["WS2M"],
            # The clear-sky reference, kept rather than dropped: it is already
            # in HOURLY_PARAMS and already fetched, and ghi/clrsky is the
            # hourly clearness -- how much of the available sun actually
            # arrived. Nothing downstream had it, so every consumer that wanted
            # to say whether an hour was overcast had to do without, and the
            # column was being paid for and thrown away.
            #
            # NOT in the dropna subset: an hour with no clear-sky reference is
            # still a usable hour of irradiance, and dropping it would shrink
            # every existing series for the sake of a column they do not read.
            #
            # OPTIONAL, and that is not defensiveness for its own sake. The
            # on-disk POWER cache has no expiry by design, so a series written
            # before this parameter was requested is still read today and has no
            # such column; requiring it turned a working cache into a KeyError.
            # Callers that construct a frame directly -- every test in this
            # module among them -- are the same case.
            **(
                {"clrsky": hourly["CLRSKY_SFC_SW_DWN"]}
                if "CLRSKY_SFC_SW_DWN" in hourly
                else {}
            ),
        }
    ).dropna(subset=["ghi", "dni", "dhi"])
    mid = df.index + pd.Timedelta(minutes=HOUR_LABEL_OFFSET_MIN)
    solpos = pvlib.solarposition.get_solarposition(
        mid, lat, lon, altitude=elevation
    )
    solpos.index = df.index
    return df, solpos


def beam_energy_histogram(
    df,
    solpos,
    n_azimuths: int = N_HORIZON_AZIMUTHS,
    elev_step: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Beam energy binned over (solar azimuth, solar elevation).

    Pre-aggregating turns the per-pixel shading step into a table lookup instead
    of an hourly loop over every pixel.
    """
    elevation = 90.0 - solpos["apparent_zenith"].to_numpy()
    azimuth = solpos["azimuth"].to_numpy()
    dni = df["dni"].to_numpy()
    up = (elevation > 0) & np.isfinite(dni)

    az_bins = np.linspace(0, 360, n_azimuths + 1)
    el_edges = np.arange(0.0, 90.0 + elev_step, elev_step)
    az_idx = np.clip(np.digitize(azimuth[up], az_bins) - 1, 0, n_azimuths - 1)
    el_idx = np.clip(np.digitize(elevation[up], el_edges) - 1, 0, len(el_edges) - 2)

    hist = np.zeros((n_azimuths, len(el_edges) - 1), dtype=float)
    np.add.at(hist, (az_idx, el_idx), dni[up])
    return hist, el_edges
