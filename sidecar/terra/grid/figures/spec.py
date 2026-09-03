"""
What a figure is, before any of them is computed.

One table, for the reason terra/registry.py holds one: an action name that maps
to a module is one line to add, and a fact about a figure spelled in two places
is a fact that can disagree with itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FigureSpec:
    number: int
    #: The finding, as the published caption states it.
    title: str
    #: "site" needs an AOI; "system" refuses one.
    scope: str
    #: The module under this package that computes it.
    module: str
    #: Records the store must hold, by the key terra/grid/ons.py DATASETS uses.
    needs: tuple[str, ...] = ()
    #: Figures whose result this one corrects, delimits or demotes. Shown with
    #: the result, because four of the twelve retire an earlier reading and a
    #: reader who sees only the earlier one is reading something the series
    #: itself withdrew.
    supersedes: tuple[int, ...] = ()
    #: Stated limits that are part of the finding rather than boilerplate.
    caveats: tuple[str, ...] = field(default_factory=tuple)


FIGURES: dict[int, FigureSpec] = {
    1: FigureSpec(
        number=1,
        title=(
            'Photovoltaic curtailment in the SIN is systemic, of energy '
            'reason, and falls across the whole solar window'
        ),
        scope='system',
        module='fig01_curtailment',
        needs=('pv_curtailment',),
        caveats=(
            'The cut is defined only where a reason was recorded: '
            'max(coalesce(reference_final, reference) - generation, 0). '
            'val_geracaolimitada is NOT the cut -- it correlates 0.86 with '
            'verified generation and 0.02 with the loss.',
            'About one restricted row in five has reference below verified '
            'generation. Those are clipped to zero and counted separately '
            'rather than hidden.',
            'The time step is derived from the data, not assumed.',
        ),
    ),
}
