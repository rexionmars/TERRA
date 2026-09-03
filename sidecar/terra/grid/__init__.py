"""
The electrical system: what the grid does to a plant, and what it did to every
plant already on it.

TERRA'S ENERGY PRODUCTS ANSWER ONE HALF OF THE QUESTION. terra/energy asks what
a site's resource is worth -- irradiance onto a plane, a yield from it, ground
that a plant could stand on. Every one of its five actions is about the site.
None is about the system the site would join, and in the Brazilian Northeast
that system withholds a third of what the resource delivers. A yield figure
that ignores it describes a plant with unlimited offtake, which is not the
plant that exists.

This slice is the other half, and it is a sibling of terra/energy rather than
an accessory to it. It has its own record, its own vocabulary and its own
actions, and neither slice is subordinate: a resource answer is not improved by
a curtailment number appended to it, and a curtailment answer is not a footnote
to a resource one. They are two questions that a project has to answer
separately before anyone can weigh them together.

    ONS     dados.ons.org.br. The operator's own account of the national
            system: what each plant generated, what it was told not to
            generate, and the network that carried it.
    ANEEL   the register that says where a plant is, which ONS never does.

WHAT IT IS NOT. Not a permitting analysis, not an access opinion, and not a
forecast of what an operator would allow at a site that has no meter. It is a
reading of what happened, at plants that are measured, published by the party
that made the decisions.

RESOLUTION, WHICH IS THE INVERSE OF terra/sun'S. NASA POWER resolves a 1 degree
cell, so terra/sun has to warn that a per-AOI number reads as more local than
it is. This record is per plant, named, half-hourly -- more local than the AOI.
Its caveat is the other one: it describes metered plants, so it says nothing
about a site that has none, and every action here refuses to borrow a
neighbour's figure silently.

    ons.py          the one reader of the published record; ingest only
    store.py        the local PostGIS store, its schema and its loaders
    curtailment.py  what was withheld, from whom, when and why
    congestion.py   the transmission network a site would have to reach
    actions.py      the questions the shell can ask
"""
