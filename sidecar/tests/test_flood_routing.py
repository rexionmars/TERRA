"""
The overland routing solver, checked against what it is supposed to conserve.

Every test here is a property the scheme must have rather than a number it once
produced, because the defects this module was written around are all silent: the
run completes, the depths look plausible, and they are wrong. Water trapped in
unfilled sinks, a domain that never drains, and a boundary that supplies water
from nothing are each checked directly, since all three shipped in a prototype
and none announced itself.

The breach mode these tests once covered is gone, and so are its tests. What is
left needs no inlet, which is exactly why it is what is left.
"""

import numpy as np
import pytest

from terra.flood import routing
from terra.terrain import hand

DX = DY = 30.0


def valley(ny=120, nx=60, sink=True):
    """A V-shaped valley falling north to south, optionally with a false sink.

    The sink is what a resampled 30 m DEM leaves in a channel: not topography,
    sampling. It is dug deep enough that a solver taking it literally cannot
    hide the fact.
    """
    y, x = np.mgrid[0:ny, 0:nx]
    z = 1000.0 - 3.0 * y + 0.9 * np.abs(x - nx // 2) ** 1.6
    if sink:
        z[ny // 2:ny // 2 + 4, nx // 2 - 1:nx // 2 + 2] -= 25.0
    return z


def terrain(z):
    """The filled surface, which is all the router needs now."""
    return hand.fill_depressions(z)


def test_a_motionless_lake_over_irregular_bed_stays_motionless():
    zf = terrain(valley())
    assert routing.lake_at_rest_residual(zf, DX, DY) < 1e-8


def test_the_mass_balance_closes_on_every_term_it_reports():
    """in + clip = stored + out, to machine noise.

    Not `in - stored == out`, which is what this was and which is not a balance:
    the positivity clip at the wetting front creates mass, and differencing it
    away hides a source term. Every term is measured and every term is
    asserted, so a change that quietly leaks mass has nowhere to hide it.
    """
    zf = terrain(valley())
    out = routing.route(zf, DX, DY, minutes=30, rain_mm_h=120.0, rain_minutes=10.0)
    residual = (
        out["volume_in_m3"]
        + out["volume_clipped_m3"]
        - out["volume_stored_m3"]
        - out["volume_out_m3"]
    )
    assert abs(residual) < 1e-9 * max(out["volume_in_m3"], 1.0), (
        f"{residual} m3 unaccounted")


def test_the_domain_drains_rather_than_filling_like_a_tank():
    """A real share of the rain must reach a boundary and leave.

    The failure this guards produced exactly zero: a torus, then a wall on the
    edge the water wanted, then a ghost cell feeding the domain instead of
    draining it. The measured symptom each time was the whole input still
    standing after hours, with depths that are a filling level and not a flow.

    The bar is a fifth rather than a half. Rain is not a breach wave: it wets
    every cell at once, most of it moves slowly over ground that is not a
    channel, and there is no infiltration in this model to take it away. About
    37% leaves in 40 minutes on this valley, so a fifth clears the defect by a
    wide margin without asserting a drainage rate the physics does not promise.
    """
    zf = terrain(valley())
    out = routing.route(zf, DX, DY, minutes=40, rain_mm_h=120.0, rain_minutes=20.0)
    assert out["volume_out_m3"] > 0.2 * out["volume_in_m3"]


def test_an_unfilled_bed_traps_the_water_the_filled_one_carries_through():
    # Not a check on the solver but on what it is given. Routing over the raw
    # surface is the defect; the assertion is that it is a defect, so that the
    # filling in the action cannot be dropped without a test noticing.
    z = valley(sink=True)
    zf = terrain(z)
    kw = dict(minutes=40, rain_mm_h=150.0, rain_minutes=20.0)
    filled = routing.route(zf, DX, DY, **kw)
    raw = routing.route(z, DX, DY, **kw)
    assert raw["volume_stored_m3"] > filled["volume_stored_m3"]


def test_rain_on_the_grid_wets_ground_without_any_inlet():
    zf = terrain(valley())
    out = routing.route(zf, DX, DY, minutes=20, rain_mm_h=120.0, rain_minutes=10.0)
    assert (out["peak_depth_m"] > 0.05).sum() > 0

