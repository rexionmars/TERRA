"""
The vegetation-index series read as a crop: leaf area, state, cycle and age.

Everything between an NDVI series and a decision about which canopy to build.
It computes and returns; it reads no request, writes to no stream, and does not
end the process. The action that calls it does all three.

The prose below records what each step is for, and in three places what it was
measured to get wrong before it existed. None of it was reachable by a test
while it sat inside a 374-line action.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

import numpy as np

from terra import phenology as phen
from terra.canopy import lai_ndvi, lai_to_age


class UndatedObservation(ValueError):
    """An observation carries no date, or one the smoother cannot read."""


@dataclass
class Reading:
    """One series, read. Every field is what a payload or a canopy needs."""

    inverted: dict
    states: list
    resolved: list
    cycles: list
    phenology: dict
    season_days: float
    peak_index: int

    @property
    def usable(self) -> list:
        """The rows the ladder resolved to an age."""
        return [row for row in self.resolved if row.get('day') is not None]

    @property
    def lit_row(self):
        """
        The row the canopy is built for.

        The densest canopy the ladder can actually build, which is where the
        architecture matters: at low LAI every geometry transmits alike and the
        answer says nothing.

        NOT the peak of the series, which is the obvious choice and is wrong
        often enough to matter -- a season that reaches the species' ceiling
        has its peak AT the plateau, where the ladder returns no age at all,
        and the naive `max` then silently fell through to the first usable
        row: LAI 0.10 lit instead of 3.75.
        """
        return max(self.usable, key=lambda row: row['lai'], default=None)


def read(ndvi, dates, species_name, density, progress=None) -> Reading:
    """
    Invert the series to leaf area, label its states, and age each observation.

    Raises UndatedObservation when the smoother cannot use the dates, and lets
    lai_to_age.LadderError through: both are the caller's to report, because
    the caller is what owns the process.
    """
    def say(percent, message):
        if progress:
            progress(percent, message)

    # Ordinal days for the smoother, which is by DATE and not by position:
    # a cloud-screened series is irregular, and a window counted in samples
    # averages across whatever survived.
    try:
        ordinals = [
            _dt.date.fromisoformat(d[:10]).toordinal() if d else None
            for d in dates
        ]
    except ValueError as e:
        raise UndatedObservation(
            f'a date in the series is not ISO-8601: {e}') from e
    if any(o is None for o in ordinals):
        raise UndatedObservation(
            'every observation needs a date for the smoother to use')

    say(20, 'inverting NDVI to leaf area index')
    inverted = lai_ndvi.invert_series(ndvi, days=ordinals)

    say(35, 'labelling phenological states')
    state_ids = phen.assign_states_from_ndvi(np.asarray(ndvi, dtype=float))
    state_slugs = {
        phen.STATE_SOIL: 'soil', phen.STATE_GREENUP: 'greenup',
        phen.STATE_MATURE: 'mature', phen.STATE_SENESCENCE: 'senescence',
        phen.STATE_FALLOW: 'fallow',
    }
    states = [state_slugs.get(int(s), 'soil') for s in state_ids]

    # THE INDEPENDENT AGE, COUNTED FROM ITS OWN CYCLE'S GREEN-UP.
    #
    # A year of Brazilian cropland holds more than one cycle -- a summer
    # crop and a safrinha, or a crop followed by a cover -- and taking the
    # first green-up of the whole series dates every later cycle from the
    # start of the file. Measured on a real AOI: the July and August 2026
    # observations were handed 344 days of age because the series begins
    # green in August 2025, when their own cycle had started weeks earlier.
    cycle_ids = phen.cycle_of(state_ids)
    cycle_list = phen.cycles(state_ids)
    greenup_by_cycle = {
        k: ordinals[c['greenup']] for k, c in enumerate(cycle_list)
    }

    say(50, 'matching leaf area to an age')
    resolved = lai_to_age.resolve_series(
        inverted['lai'], density, species_name,
        states=states, dates=dates)

    # THE LADDER IS A GROWTH CURVE AND A SEASON IS NOT.
    #
    # Helios plants only grow: leaf area rises with age and never falls, so
    # the ladder has no age for a canopy that is shedding. Past the peak the
    # inversion still answers -- a declining LAI matches a young plant -- but
    # the answer means "a plant carrying this much leaf", not "a canopy of
    # this age", and the two stop being the same thing.
    #
    # Left uncompared, that shows up as a disagreement growing to a hundred
    # days by the end of the season, which reads as the competition defect
    # and is not it. So the peak splits the series: before it the two ages
    # are measuring the same thing and their difference is informative;
    # after it the row says it is declining and offers no age comparison.
    lai_values = list(inverted['lai'])
    peak_index = int(np.nanargmax(lai_values)) if lai_values else 0
    # A duração da estação, para normalizar o progresso do campo contra o
    # do Helios. Do próprio NDVI, que é onde ela é observável.
    season_days = float(phen.phenology_metrics(ndvi, dates).get('los_days') or 0.0)
    for i, (row, o) in enumerate(zip(resolved, ordinals, strict=True)):
        k = int(cycle_ids[i])
        start = greenup_by_cycle.get(k)
        since = None if start is None else float(o - start)
        row['cycle'] = k if k >= 0 else None
        row['days_since_greenup'] = since
        row['declining'] = i > peak_index
        if row['declining']:
            row['age_check'] = {
                'comparable': False,
                'why': ('a série já passou do pico e está perdendo folha; a '
                        'escada só cresce, então a idade que ela devolve é a '
                        'de uma planta com esta área foliar, não a deste '
                        'dossel'),
            }
        else:
            row['age_check'] = lai_to_age.disagreement(
                row.get('day'), row.get('plateau_day'), since, season_days)


    return Reading(
        inverted=inverted,
        states=states,
        resolved=resolved,
        cycles=[
            {
                'start': dates[c['start']],
                'end': dates[c['end']],
                'greenup': dates[c['greenup']],
                'n': c['end'] - c['start'] + 1,
            }
            for c in cycle_list
        ],
        phenology=phen.phenology_metrics(ndvi, dates),
        season_days=season_days,
        peak_index=peak_index,
    )
