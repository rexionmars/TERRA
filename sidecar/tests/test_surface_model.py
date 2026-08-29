"""
The surface raster is written for a decoder, and this is the other end of it.

action_surface_model carries elevation to the map as three bytes per cell,
normalised to the window's own relief. Nothing about that is visible in the
image: a wrong scale draws a plausible hypsometric ramp in the wrong units, and
a wrong packing draws a plausible one of the wrong ground. Both are caught here
and nowhere else.

The decoding is MapLibre's, declared in
frontend/src/components/map/scalarTiles.ts as positional base-256:

    value = r * 1 + g * (1/256) + b * (1/65536)

and a decoded value v is floor_m + v * relief_m / VALUE_FULL_SCALE.
"""

import numpy as np
import pytest

VALUE_FULL_SCALE = 255.0
VALUE_ABSENT = 0.0
VALUE_FLOOR = 1.0


def pack(elevation, lo, hi, absent=None):
    """The lines action_surface_model runs, over a window small enough to read."""
    span = max(hi - lo, 1e-6)
    fraction = np.clip((elevation - lo) / span, 0.0, 1.0)
    normalised = VALUE_FLOOR + fraction * (VALUE_FULL_SCALE - VALUE_FLOOR)
    if absent is not None:
        normalised = np.where(absent, VALUE_ABSENT, normalised)
    packed = np.clip(np.rint(normalised * 65536.0).astype("uint32"), 0, 0xFFFFFF)
    return (
        ((packed >> 16) & 0xFF).astype(np.uint8),
        ((packed >> 8) & 0xFF).astype(np.uint8),
        (packed & 0xFF).astype(np.uint8),
    )


def decode(r, g, b, lo, hi):
    value = r * 1.0 + g / 256.0 + b / 65536.0
    span = VALUE_FULL_SCALE - VALUE_FLOOR
    return lo + (value - VALUE_FLOOR) * (hi - lo) / span


@pytest.mark.parametrize(
    "lo,hi",
    [
        (0.0, 1.0),        # a flat field: the whole ramp inside one metre
        (812.0, 3140.0),   # a Himalayan window
        (-30.0, 5.0),      # ground below sea level, which the void test must not eat
        (400.0, 400.5),    # half a metre of relief
    ],
)
def test_elevation_survives_the_packing(lo, hi):
    elevation = np.linspace(lo, hi, 97, dtype="float32").reshape(1, 97)
    r, g, b = pack(elevation, lo, hi)
    back = decode(r.astype(float), g.astype(float), b.astype(float), lo, hi)

    # The step the three channels leave is relief/65536. Two of those is the
    # most rounding can cost, and it is the bound worth asserting: a claim of
    # exactness would fail on a window where it is merely very good.
    tolerance = 2.0 * (hi - lo) / 65536.0 + 1e-6
    assert np.max(np.abs(back - elevation)) <= tolerance


def test_the_ends_of_the_window_are_the_ends_of_the_range():
    lo, hi = 100.0, 900.0
    r, g, b = pack(np.array([[lo, hi]], dtype="float32"), lo, hi)
    value = r * 1.0 + g / 256.0 + b / 65536.0
    assert value[0, 0] == pytest.approx(VALUE_FLOOR)
    assert value[0, 1] == pytest.approx(VALUE_FULL_SCALE)


def test_absence_is_a_value_the_floor_cannot_be_confused_with():
    """
    Why one value is reserved, and what it cost when it was not.

    The scalar protocol answers every tile it is asked for, and outside the
    raster it writes zero. On a count that is free -- zero already means no
    product called the cell flooded. On a continuous surface it is not: zero
    was a legitimate elevation, the window's own floor, so the ramp painted the
    whole planet the colour of the valley bottom.

    The surface therefore starts at VALUE_FLOOR, and the gap between absence
    and the lowest measured ground is what the map's ramp is transparent
    across.
    """
    lo, hi = 300.0, 451.0
    elevation = np.array([[lo, (lo + hi) / 2, hi]], dtype="float32")
    absent = np.array([[True, False, False]])
    r, g, b = pack(elevation, lo, hi, absent=absent)
    value = r * 1.0 + g / 256.0 + b / 65536.0

    assert value[0, 0] == pytest.approx(VALUE_ABSENT)
    # The lowest measured cell sits at the floor, not at absence, so no ground
    # can be mistaken for no ground.
    assert value[0, 1] > VALUE_FLOOR
    assert value[0, 2] == pytest.approx(VALUE_FULL_SCALE)
    assert VALUE_ABSENT < VALUE_FLOOR


def test_a_single_channel_would_terrace_a_mountain_window():
    """
    Why the fraction channels are carried, stated as a measurement.

    At 255 steps a 3000 m window quantises to nearly 12 m, which a hypsometric
    ramp shows as terracing. The test fails if someone drops green and blue on
    the grounds that a colour ramp cannot show the difference.
    """
    lo, hi = 0.0, 3000.0
    elevation = np.array([[1500.0, 1505.0]], dtype="float32")
    r, _, _ = pack(elevation, lo, hi)
    span = VALUE_FULL_SCALE - VALUE_FLOOR
    red_only = lo + (r.astype(float) - VALUE_FLOOR) * (hi - lo) / span
    assert abs(red_only[0, 0] - red_only[0, 1]) < 1e-9  # indistinguishable
    r2, g2, b2 = pack(elevation, lo, hi)
    full = decode(r2.astype(float), g2.astype(float), b2.astype(float), lo, hi)
    assert abs(full[0, 0] - full[0, 1]) == pytest.approx(5.0, abs=0.1)
