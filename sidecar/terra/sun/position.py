"""
Where the sun was, and how much beam energy came from there.

The busiest module of the service and the one the canopy path depends on: a
stand is lit by the hourly sun of its own location, with cast shadows and the
light colour of that sky, and all of that starts here.

pvlib is deferred inside prepare_hourly and must stay that way. It is the
heaviest dependency the sidecar reaches, and prepare_hourly is called by the
canopy and by every wind run through the modules beside it; hoisting the import
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


def mean_beam_direction(df, solpos) -> dict | None:
    """
    The DNI-weighted mean direction of the beam, as azimuth and elevation.

    WHY A VECTOR MEAN AND NOT A MEAN OF ANGLES. Averaging azimuths is averaging
    a circular quantity, and the average of 350 and 10 degrees is 180 -- the
    exact opposite of the answer. Summing unit vectors weighted by the energy
    that arrived along each and taking the direction of the sum is the only
    form that survives the wrap.

    This is the single direction that best represents what the march actually
    integrated, so a scene lit from here is lit by the same sun the number came
    from. It is not solar noon and should not be labelled as such: it sits
    toward the hours that carried the energy.

    Returns None when no hour of the record has the sun up with usable beam.
    """
    elev = np.radians(90.0 - solpos["apparent_zenith"].to_numpy())
    az = np.radians(solpos["azimuth"].to_numpy())
    dni = df["dni"].to_numpy()
    up = (elev > 0) & np.isfinite(dni) & (dni > 0)
    if not up.any():
        return None

    w = dni[up]
    ce = np.cos(elev[up])
    # East-north-up, matching the azimuth convention pvlib returns: measured
    # clockwise from north.
    x = float(np.sum(w * ce * np.sin(az[up])))
    y = float(np.sum(w * ce * np.cos(az[up])))
    z = float(np.sum(w * np.sin(elev[up])))
    horizontal = float(np.hypot(x, y))
    if horizontal <= 0 and z <= 0:
        return None
    return {
        "azimuth_deg": float(np.degrees(np.arctan2(x, y)) % 360.0),
        "elevation_deg": float(np.degrees(np.arctan2(z, horizontal))),
        # How concentrated the beam was in direction. Near 1 the sun effectively
        # came from one place all season; low means the energy was spread across
        # the sky and a single direction represents it poorly.
        "concentration": float(np.sqrt(x * x + y * y + z * z) / np.sum(w)),
    }


def representative_day(df):
    """
    The date in `df` whose daily beam total is the median of the record given.

    A REAL DAY RATHER THAN AN AVERAGED ONE, and the difference matters near the
    equator. Averaging hour-of-day across a window degenerates exactly where
    this application's AOIs are: at latitude -4.5 the noon sun passes within ten
    degrees of the zenith for much of the year, azimuth swings tens of degrees
    in half an hour there, and a per-hour mean of azimuth produces a direction
    no sun ever occupied. Picking one actual day avoids the whole class.

    The median by beam total rather than the mean or the brightest: a window
    holds clear days and overcast ones, and the median is the day a reader would
    call typical.

    Returns None for an empty record.
    """
    if df is None or len(df) == 0:
        return None
    totals = df["dni"].groupby(df.index.date).sum()
    totals = totals[np.isfinite(totals.to_numpy())]
    if len(totals) == 0:
        return None
    order = totals.sort_values()
    return order.index[len(order) // 2]


def sun_track(df, solpos, day=None) -> list[dict]:
    """
    One day of sun, hour by hour: where it was and what arrived.

    This is what a viewer needs in order to draw the sun rather than assume it.
    Hours with the sun below the horizon are left out, because a scene has
    nothing to do with them and their azimuth is not meaningful to a renderer.

    `clearness` is the hour's global irradiance over its clear-sky reference:
    1.0 is a cloudless hour, and low values are the overcast ones a scene should
    render as flat and hazy. Absent when the clear-sky column is not carried.

    HOURS ARE UTC, which is why the field says so in its name. This module asks
    POWER for `time-standard=UTC` explicitly because the API's default is Local
    Solar Time, and a consumer that assumed the label meant local would place
    the sun three hours wrong for a Brazilian AOI -- at this project's own cell
    solar noon lands at 15h UTC. A renderer should drive itself from azimuth and
    elevation and treat the hour as a caption; nothing here depends on the label.
    """
    if df is None or len(df) == 0:
        return []
    if day is None:
        day = representative_day(df)
    if day is None:
        return []

    mask = np.asarray(df.index.date) == day
    d, s = df[mask], solpos[mask]
    elev = 90.0 - s["apparent_zenith"].to_numpy()
    up = elev > 0
    has_clear = "clrsky" in d.columns

    out = []
    for i in np.flatnonzero(up):
        row = {
            "hour_utc": int(d.index[i].hour),
            "azimuth_deg": float(s["azimuth"].to_numpy()[i]),
            "elevation_deg": float(elev[i]),
            "dni": float(d["dni"].to_numpy()[i]),
            "dhi": float(d["dhi"].to_numpy()[i]),
            "ghi": float(d["ghi"].to_numpy()[i]),
        }
        # THE DIFFUSE SHARE IS COMPUTED HERE, CLAMPED, rather than left as
        # dhi/ghi for a consumer to divide.
        #
        # The ratio is not bounded by 1 in this record and the excess is not
        # small: over three years at this project's cell it reaches 1.531, and
        # 4.2 percent of daylight hours exceed 1. Those hours have a median
        # elevation of 3.3 degrees and none above 14.7, and POWER's own
        # components do not close there -- (DHI + DNI cos z) / GHI has a median
        # of 1.17 across them. It is a grazing-sun artefact in the source, most
        # likely the hour-averaged fluxes disagreeing with geometry evaluated at
        # the interval mid-point when the sun crosses the horizon inside the
        # hour.
        #
        # Clamped at the source because every consumer would otherwise have to
        # know this. A renderer that clamps still draws something sensible, but
        # a caption reading "120% diffuse" is a number no one can defend, and
        # the caption is exactly what a viewer of this array would write.
        if row["ghi"] > 0:
            row["diffuse_share"] = float(min(max(row["dhi"] / row["ghi"], 0.0), 1.0))
        if has_clear:
            clear = float(d["clrsky"].to_numpy()[i])
            if np.isfinite(clear) and clear > 0:
                row["clearness"] = float(min(row["ghi"] / clear, 1.0))
        out.append(row)
    return out


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
