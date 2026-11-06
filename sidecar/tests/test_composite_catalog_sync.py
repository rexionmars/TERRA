"""
The panel's index list must describe the indices the sidecar draws.

frontend/src/lib/compositeCatalog.ts is written by hand. An entry there names
the ramp its legend is drawn with and the formula the reader is shown; if
either disagrees with COMPOSITE_INDICES the legend describes a raster that was
not drawn that way, and nothing else would fail.
"""

from __future__ import annotations

import re
from pathlib import Path

from terra.imagery import composite as comp

CATALOG_TS = (
    Path(__file__).resolve().parents[2] / 'frontend' / 'src' / 'lib' / 'compositeCatalog.ts'
)


def _block(text: str, name: str) -> str:
    """The body of `export const <name>... = [ ... ]`, up to its closing bracket."""
    match = re.search(rf'^export const {name}\b.*?= \[\n(.*?)^\]', text, re.M | re.S)
    assert match, f'{name} not found in {CATALOG_TS.name}'
    return match.group(1)


def _indices() -> dict[str, dict[str, str]]:
    body = _block(CATALOG_TS.read_text(encoding='utf-8'), 'INDICES')
    out: dict[str, dict[str, str]] = {}
    for entry in re.findall(r'^  \{\n(.*?)^  \},', body, re.M | re.S):
        fields = dict(re.findall(r'^    (\w+): "([^"]*)",', entry, re.M))
        out[fields['id']] = fields
    return out


def test_the_panel_lists_every_index_the_sidecar_draws_and_no_other():
    assert set(_indices()) == set(comp.COMPOSITE_INDICES)


def test_each_legend_names_the_ramp_that_drew_its_raster():
    for name, entry in _indices().items():
        assert entry['cmap'] == comp.COMPOSITE_INDICES[name].ramp, name


def test_each_formula_shown_reads_the_bands_the_sidecar_reads():
    for name, entry in _indices().items():
        shown = set(re.findall(r'B\d[\dA]', entry['formula']))
        assert shown == set(comp.COMPOSITE_INDICES[name].bands), name


def test_the_channel_picker_offers_the_bands_the_sidecar_loads():
    body = _block(CATALOG_TS.read_text(encoding='utf-8'), 'S2_BANDS')
    assert tuple(re.findall(r'id: "(B\w+)"', body)) == comp.ALLOWED_BANDS


def test_the_panel_offers_the_kinds_the_sidecar_draws():
    from terra.scenes import actions

    body = _block(CATALOG_TS.read_text(encoding='utf-8'), 'KINDS')
    offered = re.findall(r'^    id: "(\w+)",', body, re.M)
    # biomass is answered by its own action, biomass_map.
    assert offered == [*actions.KINDS, 'biomass']


def test_the_canopy_variables_offered_are_the_networks_there_are():
    from terra.scenes import sl2p

    body = _block(CATALOG_TS.read_text(encoding='utf-8'), 'BIOPHYSICAL_VARIABLES')
    assert set(re.findall(r'id: "(\w+)"', body)) == set(sl2p.VARIABLES)


def test_the_biomass_years_offered_are_the_years_the_map_covers():
    from terra.biomass import cci

    body = _block(CATALOG_TS.read_text(encoding='utf-8'), 'BIOMASS_YEARS')
    assert sorted(int(y) for y in re.findall(r'\d{4}', body)) == list(cci.YEARS)
