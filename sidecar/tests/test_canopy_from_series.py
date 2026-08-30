"""
The vegetation-index series read as a crop.

None of this was reachable by a test while it sat inside canopy_from_aoi: the
inversion, the state labelling, the per-cycle age, the peak split, and the
choice of which observation the canopy is built for. Two of those exist because
of a defect measured in the field, and both are checked here.

The ladder and the inversion are stood in for. Nothing here grows a plant.
"""

from __future__ import annotations

import numpy as np
import pytest

from terra import phenology as phen
from terra.canopy import from_series, lai_ndvi, lai_to_age


def dates_from(day_numbers, year=2024):
    import datetime
    return [(datetime.date(year, 1, 1) + datetime.timedelta(days=d)).isoformat()
            for d in day_numbers]


@pytest.fixture
def ladder(monkeypatch):
    """resolve_series answering an age proportional to leaf area."""
    def resolve_series(lai, density, species, states=None, dates=None):
        return [{'lai': float(v), 'day': None if v < 0.2 else round(20.0 * float(v)),
                 'plateau_day': 120.0} for v in lai]

    monkeypatch.setattr(lai_to_age, 'resolve_series', resolve_series)
    monkeypatch.setattr(lai_to_age, 'disagreement',
                        lambda day, plateau, since, season: {'comparable': True})
    monkeypatch.setattr(lai_ndvi, 'invert_series',
                        lambda ndvi, days=None: {'lai': [3.0 * v for v in ndvi]})
    return resolve_series


def test_every_observation_gets_a_row_and_a_cycle(ladder):
    ndvi = [0.20, 0.55, 0.80, 0.60, 0.25]
    out = from_series.read(ndvi, dates_from([0, 20, 40, 60, 80]), 'soybean', 30.0)

    assert len(out.resolved) == len(ndvi)
    assert all('cycle' in row for row in out.resolved)
    assert out.inverted['lai'][2] == pytest.approx(2.4)


def test_a_row_past_the_peak_offers_no_age_comparison(ladder):
    """
    The ladder is a growth curve and a season is not: past the peak it still
    answers, but the answer means "a plant carrying this much leaf" rather than
    "a canopy of this age". Left uncompared it read as a hundred days of
    disagreement by the end of the season.
    """
    ndvi = [0.20, 0.80, 0.30]
    out = from_series.read(ndvi, dates_from([0, 30, 60]), 'soybean', 30.0)

    before, peak, after = out.resolved
    assert out.peak_index == 1
    assert after['declining'] is True
    assert after['age_check']['comparable'] is False
    assert before['declining'] is False


def test_the_lit_row_is_the_densest_the_ladder_resolved_not_the_peak(ladder):
    """
    A season that reaches the species' ceiling has its peak where the ladder
    returns no age, and a naive max over the series then fell through to the
    first usable row: LAI 0.10 lit instead of 3.75.
    """
    ndvi = [0.05, 0.90, 0.50]      # 0.05 inverts below the ladder's floor
    out = from_series.read(ndvi, dates_from([0, 30, 60]), 'soybean', 30.0)

    assert out.lit_row is not None
    assert out.lit_row['lai'] == pytest.approx(2.7)
    assert all(row['day'] is not None for row in out.usable)


def test_a_date_the_smoother_cannot_read_is_refused_by_name(ladder):
    with pytest.raises(from_series.UndatedObservation, match='ISO-8601'):
        from_series.read([0.5, 0.6], ['2024-01-01', 'not a date'], 'soybean', 30.0)


def test_an_observation_with_no_date_is_refused(ladder):
    with pytest.raises(from_series.UndatedObservation):
        from_series.read([0.5, 0.6], ['2024-01-01', None], 'soybean', 30.0)


def test_the_ladder_failure_travels_to_the_caller(monkeypatch):
    """
    LadderError is not caught here. Reporting it is the action's, because the
    action is what owns the process.
    """
    monkeypatch.setattr(lai_ndvi, 'invert_series',
                        lambda ndvi, days=None: {'lai': list(ndvi)})

    def refuse(*a, **k):
        raise lai_to_age.LadderError('no ladder for cane')

    monkeypatch.setattr(lai_to_age, 'resolve_series', refuse)

    with pytest.raises(lai_to_age.LadderError):
        from_series.read([0.5], dates_from([0]), 'cane', 30.0)


def test_progress_is_the_callers_and_the_read_writes_to_no_stream(ladder, capsys):
    seen = []
    from_series.read([0.2, 0.8], dates_from([0, 30]), 'soybean', 30.0,
                     progress=lambda pct, msg: seen.append(pct))

    assert seen == [20, 35, 50]
    captured = capsys.readouterr()
    assert captured.out == '' and captured.err == ''


def test_more_than_one_cycle_is_reported_as_more_than_one(ladder):
    """A window covering two crops has every age measured from its own
    cycle's green-up, not from the start of the record."""
    # Long enough for the smoother: its window is counted in samples, and a
    # six-point series is shorter than the window it asks for.
    ndvi = [0.15, 0.35, 0.75, 0.80, 0.45, 0.18,
            0.15, 0.30, 0.70, 0.85, 0.50, 0.20]
    out = from_series.read(ndvi, dates_from(list(range(0, 360, 30))),
                           'soybean', 30.0)

    assert len(out.cycles) == len(phen.cycles(
        phen.assign_states_from_ndvi(np.asarray(ndvi, dtype=float))))
