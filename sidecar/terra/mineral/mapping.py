"""
Surface mineralogy over an area, from EMIT reflectance and Tetracorder.

Separated from the action for the reason terra/water/survey.py is: everything
here takes an area and a reader and returns arrays, and nothing reads a request
or writes to a stream. A test can hand it a synthetic reader.

The output is one answer per reported Tetracorder group per 60 m cell: the
reference spectrum that best matched, its weighted fit and its weighted band
depth. Group 1 answers from the Fe2+/Fe3+ electronic absorptions below about
1.3 um, group 2 from the vibrational absorptions of 2.0 to 2.5 um, so a cell
can carry hematite from one and kaolinite from the other (Clark et al., 2003,
section 2.9). Band depth rises with abundance at fixed grain size but is not an
abundance; no unmixing is done.

EACH CELL'S ANSWER COMES FROM ONE PASS, the one in which its ground was least
covered by green vegetation and plant residue (terra/mineral/cover.py). Each
pass is read once; a cell keeps the spectrum of the pass that shows it most
openly so far, and the spectra kept are classified together at the end.

Beside the answer, and read from the same cells:

    fractional cover   EMIT L2B FRCOV of the chosen pass, where it exists;
    band positions     the Fe3+ and Al-OH absorption wavelengths over the
                       cells whose class makes them (terra/mineral/features.py);
    fit margin         how far the answer's fit stood above the best reference
                       of another class;
    agreement          the class the EMIT L2B product gave the same pixel
                       (terra/mineral/l2b.py);
    stability          optionally, how often the class held when each
                       channel was perturbed independently by its reported
                       one-sigma uncertainty; the correlation of that
                       uncertainty between channels is not modelled;
    acid-sulfate       the cells whose answer is a mineral of acid mine
                       drainage, with the setting the literature ties it to.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from terra import protocol
from terra.mineral import cover, emit, features, l2b, render, tetracorder

GROUP_LABELS = {
    1: 'Fe2+/Fe3+ electronic absorptions, 0.4-1.3 um',
    2: 'Vibrational absorptions, 2.0-2.5 um',
}

CLASS_LABELS = {
    'kaolinite': 'Kaolinite group',
    'gibbsite': 'Gibbsite',
    'goethite': 'Goethite',
    'hematite': 'Hematite',
    'smectite': 'Smectite (montmorillonite, nontronite)',
    'illite_muscovite': 'Illite / muscovite',
    'chlorite': 'Chlorite',
    'calcite': 'Calcite',
    'dolomite': 'Dolomite',
    'alunite': 'Alunite',
    'jarosite': 'Jarosite',
    'vegetation': 'Vegetation',
    'water': 'Water',
    'pyrophyllite': 'Pyrophyllite',
    'talc_serpentine': 'Talc / serpentine',
    'epidote_amphibole': 'Epidote / prehnite / amphibole',
    'gypsum': 'Gypsum',
    'vermiculite': 'Vermiculite',
    'biotite': 'Biotite / phlogopite',
    'fe_sulfate': 'Fe sulfates and acid-drainage minerals',
    'fe_oxyhydroxide': 'Ferrihydrite / lepidocrocite',
    'magnetite': 'Magnetite / maghemite',
    'manganese': 'Manganese minerals',
    'copper': 'Copper minerals',
    'ree': 'Rare-earth oxides (Nd, Sm)',
    'pyroxene_olivine': 'Pyroxene / olivine',
    'plastic': 'Plastics and roofing',
    'other': 'Other reference',
}

# Colours for the class maps and their legend, sent in the payload so the
# frontend draws the legend from the same values the PNG was drawn with. Every
# pair differs by more than 30 in some channel, so the frontend's inversion of
# colour to class never needs its tolerant pass.
CLASS_COLORS = {
    'kaolinite': '#4e79a7',
    'gibbsite': '#76b7b2',
    'goethite': '#edc948',
    'hematite': '#c43c39',
    'smectite': '#b07aa1',
    'illite_muscovite': '#ff9da7',
    'chlorite': '#8cd17d',
    'calcite': '#f28e2b',
    'dolomite': '#d4a373',
    'alunite': '#9d7660',
    'jarosite': '#b6992d',
    'vegetation': '#2f6b3a',
    'water': '#1f3b73',
    'pyrophyllite': '#a0cbe8',
    'talc_serpentine': '#499894',
    'epidote_amphibole': '#a5b83c',
    'gypsum': '#f3e9c6',
    'vermiculite': '#d37295',
    'biotite': '#5c3d2e',
    'fe_sulfate': '#e3b505',
    'fe_oxyhydroxide': '#a0522d',
    'magnetite': '#2b2b2b',
    'manganese': '#7b2d8b',
    'copper': '#17becf',
    'ree': '#ff00ff',
    'pyroxene_olivine': '#6e7a2e',
    'plastic': '#39ff14',
    'other': '#8c8c8c',
}
NO_ANSWER_RGBA = (200, 200, 200, 90)
MASKED_RGBA = (90, 90, 90, 140)
MASKED_ITEM = {'key': 'masked', 'label': 'Masked', 'color': '#5a5a5a',
               'alpha': MASKED_RGBA[3], 'excluded': True}

NOT_OBSERVED = -2   # cell inside the area that no scene observed usably
NO_ANSWER = -1      # observed, and no reference passed its constraints

# Passes compared per cell when the request names no number. EMIT observes a
# place on few, irregular passes (4 to 16 over 2022-2026 at four Brazilian
# sites, 2026-09), so this usually compares every pass of a period of a year.
DEFAULT_PASSES = 6
# The ceiling, which is the number of colours the pass layer has.
MAX_PASSES = 10
PASS_COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
               '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac']

EXPOSURE_LEGEND = [
    {'key': 'exposed', 'label': 'Exposed in the pass used', 'color': '#c9a26b'},
    {'key': 'covered', 'label': 'Covered in every pass compared', 'color': '#5b8c5a'},
    MASKED_ITEM,
]
SELECTION_RULE = ('each cell from the pass it is least covered in: exposed ground first '
                  '(NDVI -0.15 to 0.25, the GEOS3 limit of Dematte et al., 2018, and '
                  'cellulose absorption index CAI <= 0, Nagler et al., 2000), then lower NDVI')

# Answers that are a cover rather than a mineral. The comparison with EMIT L2B
# is of mineral identifications, so both count as no mineral answer on both
# sides: over vegetated ground a shared vegetation answer would otherwise make
# most of the agreement. Measured on the Quadrilatero Ferrifero (n = 5,987
# compared cells, 2024-09-03 and 2025-07-01), group 2 agreed on 91% of the cells
# both identified with vegetation counted and on 37% without it.
NOT_MINERAL = ('vegetation', 'water')

# EMIT L3 counts a cell as bare ground when FRCOV gives it a soil fraction
# above 0.65 (EMIT L3 ATBD V3, "Bare Earth Percentage Adjustment", after Okin
# et al., 2001).
FRCOV_BARE_THRESHOLD = 0.65

# The minerals of acid mine drainage, in the order a cell with two of them is
# drawn: the zone nearest the waste first. Swayze et al. (2000, Environmental
# Science & Technology 34:47-54) mapped jarosite in the innermost, most acid
# zone around mine waste and goethite in the outer, near-neutral one; Bigham
# et al. (1996, Geochimica et Cosmochimica Acta 60:2111-2121) found
# schwertmannite precipitating from waters of pH 2.8 to 4.5. Goethite and
# ferrihydrite are left out: in tropical soils they are pedogenic everywhere
# and mark no drainage.
ACID_SULFATE = [
    {'key': 'jarosite', 'label': 'Jarosite', 'components': ('jarosite',),
     'setting': 'innermost, most acid zone around mine waste (Swayze et al., 2000)',
     'color': '#b6992d'},
    {'key': 'fe_sulfate_salts', 'label': 'Efflorescent Fe sulfates',
     'components': ('copiapite', 'coquimbite', 'szomolnokite', 'fe2+generic_sulfate_butlerite'),
     'setting': 'salts left by evaporating acid sulfate water',
     'color': '#e3b505'},
    {'key': 'schwertmannite', 'label': 'Schwertmannite', 'components': ('schwertmannite',),
     'setting': 'precipitates from water of pH 2.8 to 4.5 (Bigham et al., 1996)',
     'color': '#f28e2b'},
    {'key': 'amd_assemblage', 'label': 'Acid mine drainage assemblage', 'components': ('acid_mine_drainage',),
     'setting': 'Tetracorder reference assemblages of mine drainage',
     'color': '#d95f02'},
    {'key': 'pyrite', 'label': 'Weathered pyrite', 'components': ('pyrite',),
     'setting': 'the sulfide whose oxidation produces the acid',
     'color': '#7570b3'},
]

AGREEMENT_LEGEND = [   # in the order of terra/mineral/l2b.py's codes
    {'key': 'agree', 'label': 'Same class as L2B', 'color': '#1a9850'},
    {'key': 'differ', 'label': 'Different class from L2B', 'color': '#d73027'},
    {'key': 'port_only', 'label': 'Identified here, not by L2B', 'color': '#fdae61'},
    {'key': 'l2b_only', 'label': 'Identified by L2B only', 'color': '#4575b4'},
    {'key': 'neither', 'label': 'Identified by neither', 'color': '#d9d9d9'},
]

# Ramps. Red-yellow-green (ColorBrewer RdYlGn) where a low value is the
# doubtful end; red to yellow for the Fe3+ position, hematite's colour to
# goethite's; blue to red (RdYlBu reversed) for Al-OH, Al-rich to Al-poor.
CONFIDENCE_COLORS = ['#d73027', '#fee08b', '#1a9850']
FE3_COLORS = ['#c43c39', '#f28e2b', '#edc948']
ALOH_COLORS = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c']
# The display range of the fit margin. Margins above it are drawn at its top;
# the figures in the reading use the values themselves.
MARGIN_DISPLAY_MAX = 0.3
# White mica's Al-OH range (van Ruitenbeek et al., 2006).
ALOH_RANGE_NM = (2190.0, 2225.0)


class NoScene(RuntimeError):
    """No EMIT granule observed the area in the period."""


@dataclass
class SceneUse:
    granule: str
    date: str
    cloud_cover: float | None
    mask_granule: str | None
    # Cells this pass answered for, and cells it saw only under its mask.
    cells: int = 0
    masked_cells: int = 0
    wavelength_offset_nm: float = 0.0
    # Cells this pass observed usably, and of those the ones it showed exposed.
    candidate_cells: int = 0
    exposed_cells: int = 0
    # Of the cells it answered for, those that were exposed in it.
    chosen_exposed_cells: int = 0
    frcov_granule: str | None = None
    l2b_granule: str | None = None
    acquired: str = ''


@dataclass
class MineralMap:
    grid: emit.OutputGrid
    inside: np.ndarray
    entry: dict[int, np.ndarray]          # per group, NOT_OBSERVED / NO_ANSWER / entry index
    fit: dict[int, np.ndarray]
    depth: dict[int, np.ndarray]
    masked: np.ndarray                    # inside, observed only as masked
    scenes: list[SceneUse]
    rules: tetracorder.Rules
    notes: list[str] = field(default_factory=list)
    runner_up: dict[int, np.ndarray] = field(default_factory=dict)
    pass_index: np.ndarray | None = None  # index into scenes, -1 where no pass
    exposed: np.ndarray | None = None     # the observation used passed cover's test
    ndvi: np.ndarray | None = None
    cai: np.ndarray | None = None
    frcov: dict[str, np.ndarray] = field(default_factory=dict)       # pv, npv, bare
    positions: dict[str, features.Position] = field(default_factory=dict)
    l2b_class: dict[int, np.ndarray] = field(default_factory=dict)   # class index, -1 none, -2 no value
    stability: dict[int, np.ndarray] = field(default_factory=dict)
    draws: int = 0

    # Cells and classes ---------------------------------------------------------

    def _cell_ha(self) -> np.ndarray:
        return self.grid.cell_area_ha()[:, None] * np.ones((1, self.grid.width))

    def _observed(self) -> np.ndarray:
        first = next(iter(self.entry.values()))
        return self.inside & (first != NOT_OBSERVED)

    def mineral_only(self, cls: np.ndarray) -> np.ndarray:
        """Class indices with the covers of NOT_MINERAL made -1, no mineral answer."""
        index = {c: i for i, c in enumerate(self.rules.classes)}
        out = cls.copy()
        for c in NOT_MINERAL:
            if c in index:
                out[out == index[c]] = -1
        return out

    def port_class(self, g: int) -> np.ndarray:
        """Class index per cell: -1 where nothing was identified, -2 where not observed."""
        index = {c: i for i, c in enumerate(self.rules.classes)}
        of_entry = np.array([index[e.klass] for e in self.rules.entries], dtype=np.int32)
        ent = self.entry[g]
        out = np.where(ent == NO_ANSWER, -1, -2).astype(np.int32)
        out[ent >= 0] = of_entry[ent[ent >= 0]]
        return out

    def to_payload(self, work_dir) -> dict:
        from terra.imagery import composite as comp

        work_dir = Path(work_dir)
        cell_ha = self._cell_ha()
        observed = self._observed()
        groups = []
        for g, ent in self.entry.items():
            png = work_dir / f'mineral_group{g}.png'
            comp.write_rgba_png(self.class_rgba(g), png)
            groups.append({
                'group': g,
                'label': GROUP_LABELS.get(g, f'group {g}'),
                'class_png': str(png),
                'detected_cells': int((self.inside & (ent >= 0)).sum()),
                'detected_area_ha': round(float(cell_ha[self.inside & (ent >= 0)].sum()), 2),
                'classes': self._class_rows(g, cell_ha, observed),
                'entries': self._entry_rows(g, cell_ha),
            })
        layers = self._layers(work_dir, comp)
        tif = work_dir / 'mineral_map.tif'
        self.write_geotiff(tif)
        src = self.rules.source
        return {
            'sensor': 'EMIT L2A reflectance',
            'expert_system': src['expert_system'],
            'libraries': [v['file'] for v in src['libraries'].values()],
            'aoi_cells': int(self.inside.sum()),
            'aoi_area_ha': round(float(cell_ha[self.inside].sum()), 2),
            'observed_cells': int(observed.sum()),
            'observed_area_ha': round(float(cell_ha[observed].sum()), 2),
            'masked_cells': int((self.inside & self.masked).sum()),
            'cell_size_deg': [self.grid.dlon, self.grid.dlat],
            'scenes': [s.__dict__ for s in self.scenes],
            'groups': groups,
            'legend': [{'class': c, 'label': CLASS_LABELS[c], 'color': CLASS_COLORS[c]}
                       for c in self.rules.classes],
            'selection': self._selection(cell_ha, observed),
            'cover': self._cover(cell_ha, observed),
            'positions': self._positions(),
            'confidence': self._confidence(),
            'agreement': self._agreement(),
            'acid_sulfate': self._acid_sulfate_rows(cell_ha),
            'layers': layers,
            'geotiff': str(tif),
            'extent': self.grid.extent(),
            'notes': self.notes,
        }

    def class_rgba(self, g: int) -> np.ndarray:
        h, w = self.grid.height, self.grid.width
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        ent = self.entry[g]
        rgba[self.inside & (ent == NO_ANSWER)] = NO_ANSWER_RGBA
        rgba[self.inside & self.masked & (ent == NOT_OBSERVED)] = MASKED_RGBA
        for e in self.rules.entries:
            if g not in e.competes_in:
                continue
            sel = self.inside & (ent == e.index)
            if sel.any():
                hexc = CLASS_COLORS[e.klass]
                rgba[sel] = (int(hexc[1:3], 16), int(hexc[3:5], 16), int(hexc[5:7], 16), 235)
        return rgba

    def _class_rows(self, g: int, cell_ha: np.ndarray, observed: np.ndarray) -> list[dict]:
        ent = self.entry[g]
        obs_ha = float(cell_ha[observed].sum()) or 1.0
        by_class: dict[str, np.ndarray] = {}
        for e in self.rules.entries:
            sel = self.inside & (ent == e.index)
            if sel.any():
                by_class[e.klass] = by_class.get(e.klass, np.zeros_like(sel)) | sel
        rows: list[dict[str, Any]] = []
        for c in self.rules.classes:
            sel = by_class.get(c)
            if sel is None:
                continue
            ha = float(cell_ha[sel].sum())
            rows.append({
                'class': c, 'label': CLASS_LABELS[c], 'color': CLASS_COLORS[c],
                'cells': int(sel.sum()), 'area_ha': round(ha, 2),
                'fraction_of_observed': round(ha / obs_ha, 4),
                'mean_depth': round(float(self.depth[g][sel].mean()), 4),
            })
        rows.sort(key=lambda r: -r['cells'])
        return rows

    def _entry_rows(self, g: int, cell_ha: np.ndarray, top: int = 15) -> list[dict]:
        ent = self.entry[g]
        rows = []
        idx, counts = np.unique(ent[self.inside & (ent >= 0)], return_counts=True)
        ranked: list[tuple[int, int]] = sorted(
            zip((int(i) for i in idx), (int(n) for n in counts), strict=True),
            key=lambda t: -t[1],
        )
        for i, n in ranked[:top]:
            e = self.rules.entries[i]
            sel = self.inside & (ent == i)
            rows.append({
                'id': e.ident, 'title': e.title, 'class': e.klass,
                'cells': int(n), 'area_ha': round(float(cell_ha[sel].sum()), 2),
                'mean_fit': round(float(self.fit[g][sel].mean()), 4),
                'mean_depth': round(float(self.depth[g][sel].mean()), 4),
            })
        return rows

    # Derived figures -------------------------------------------------------------

    def _selection(self, cell_ha: np.ndarray, observed: np.ndarray) -> dict | None:
        if self.pass_index is None or self.exposed is None:
            return None
        exposed = observed & self.exposed
        return {
            'rule': SELECTION_RULE,
            'compared_passes': len(self.scenes),
            'contributing_passes': sum(1 for s in self.scenes if s.cells > 0),
            'exposed_cells': int(exposed.sum()),
            'exposed_area_ha': round(float(cell_ha[exposed].sum()), 2),
        }

    def _cover(self, cell_ha: np.ndarray, observed: np.ndarray) -> dict | None:
        if not self.frcov:
            return None
        pv, npv, bare = self.frcov['pv'], self.frcov['npv'], self.frcov['bare']
        has = observed & np.isfinite(pv) & np.isfinite(npv) & np.isfinite(bare)
        if not has.any():
            return None
        soil = has & (bare > FRCOV_BARE_THRESHOLD)
        per_group = []
        for g, ent in self.entry.items():
            on = soil & (ent >= 0)
            per_group.append({'group': g, 'identified_cells': int(on.sum()),
                              'identified_area_ha': round(float(cell_ha[on].sum()), 2)})
        return {
            'product': 'EMIT L2B FRCOV V001',
            'cells': int(has.sum()),
            'area_ha': round(float(cell_ha[has].sum()), 2),
            'mean_pv': round(float(pv[has].mean()), 4),
            'mean_npv': round(float(npv[has].mean()), 4),
            'mean_bare': round(float(bare[has].mean()), 4),
            'bare_threshold': FRCOV_BARE_THRESHOLD,
            'bare_cells': int(soil.sum()),
            'bare_area_ha': round(float(cell_ha[soil].sum()), 2),
            'groups': per_group,
        }

    def _positions(self) -> list[dict]:
        out = []
        spectra = _library_spectra(self.rules)
        waves = self.rules.wavelengths * 1000.0
        for w in features.WINDOWS:
            m = self.positions.get(w.key)
            if m is None:
                continue
            cls = self.port_class(w.group)
            index = {c: i for i, c in enumerate(self.rules.classes)}
            rows = []
            for klass in w.classes:
                sel = self.inside & (cls == index.get(klass, -99))
                s = render.spread(np.where(sel, m.position, np.nan))
                if s:
                    rows.append({'class': klass, 'label': CLASS_LABELS[klass], **s})
            if not rows:
                continue
            out.append({
                'key': w.key, 'title': w.title, 'unit': 'nm', 'group': w.group,
                'classes': rows,
                'references': features.reference_positions(self.rules, spectra, waves, w),
                'ramp': self._position_ramp(w),
            })
        return out

    def _position_ramp(self, w: features.Window) -> dict:
        if w.key == 'aloh':
            lo, hi = ALOH_RANGE_NM
            return {'min': lo, 'max': hi, 'unit': 'nm', 'colors': ALOH_COLORS,
                    'low': 'Al-rich (shorter)', 'high': 'Al-poor, Mg-Fe (longer)'}
        refs = features.reference_positions(self.rules, _library_spectra(self.rules),
                                            self.rules.wavelengths * 1000.0, w)
        med = {r['class']: r['median_nm'] for r in refs}
        lo = med.get('hematite', 870.0) - 25.0
        hi = med.get('goethite', 990.0) + 25.0
        return {'min': round(lo, 1), 'max': round(hi, 1), 'unit': 'nm', 'colors': FE3_COLORS,
                'low': 'hematite references', 'high': 'goethite references'}

    def _confidence(self) -> list[dict]:
        out = []
        for g, ent in self.entry.items():
            if g not in self.runner_up:
                continue
            ident = self.inside & (ent >= 0)
            margin = np.where(ident, self.fit[g] - self.runner_up[g], np.nan)
            row: dict[str, Any] = {'group': g, 'margin': render.spread(margin), 'draws': self.draws}
            if self.draws and g in self.stability:
                st = np.where(ident, self.stability[g], np.nan)
                s = render.spread(st)
                row['stability'] = s
                row['stable_cells'] = int((st >= 1.0).sum())
            out.append(row)
        return out

    def _agreement(self) -> list[dict]:
        if not self.l2b_class:
            return []
        granules = [s.l2b_granule for s in self.scenes if s.l2b_granule]
        out = []
        for g in self.entry:
            if g not in self.l2b_class:
                continue
            port = self.mineral_only(self.port_class(g))
            other = self.mineral_only(self.l2b_class[g])
            code = np.where(self.inside, l2b.agreement(port, other), l2b.UNCOMPARED)
            compared = code >= 0
            if not compared.any():
                continue
            counts = {item['key']: int((code == i).sum()) for i, item in enumerate(AGREEMENT_LEGEND)}
            both = counts['agree'] + counts['differ']
            pairs = []
            differ = code == l2b.DIFFER
            if differ.any():
                keys, n = np.unique(np.stack([port[differ], other[differ]], axis=1),
                                    axis=0, return_counts=True)
                for (a, b), k in sorted(zip(keys.tolist(), n.tolist(), strict=True), key=lambda t: -t[1])[:8]:
                    pairs.append({'here': self.rules.classes[a], 'l2b': self.rules.classes[b], 'cells': int(k)})
            out.append({'group': g, 'granules': granules, 'compared_cells': int(compared.sum()),
                        **counts,
                        'agree_fraction_of_both': round(counts['agree'] / both, 4) if both else None,
                        'pairs': pairs})
        return out

    def _acid_sulfate_by_group(self) -> dict[int, np.ndarray]:
        """Per group, the ordinal of the ACID_SULFATE item each cell's answer is, else -1."""
        of_entry = np.full(len(self.rules.entries), -1, dtype=np.int32)
        for e in self.rules.entries:
            for k, item in enumerate(ACID_SULFATE):
                if e.primary_component in item['components']:
                    of_entry[e.index] = k
                    break
        return {g: np.where((ent >= 0) & self.inside, of_entry[np.maximum(ent, 0)], -1)
                for g, ent in self.entry.items()}

    def _acid_sulfate_codes(self) -> np.ndarray:
        """Per cell, the first ACID_SULFATE item either group's answer is, else -1."""
        code = np.full((self.grid.height, self.grid.width), -1, dtype=np.int32)
        for found in self._acid_sulfate_by_group().values():
            take = (found >= 0) & ((code < 0) | (found < code))
            code = np.where(take, found, code)
        return code

    def _acid_sulfate_rows(self, cell_ha: np.ndarray) -> list[dict]:
        """
        Area per mineral, and in which group the match was made: a group 2
        match rests on a vibrational band specific to the mineral (jarosite's
        near 2.26 um), a group 1 match on the broad Fe3+ bands the mineral
        shares with goethite in iron-rich soil.
        """
        code = self._acid_sulfate_codes()
        by_group = self._acid_sulfate_by_group()
        rows = []
        for k, item in enumerate(ACID_SULFATE):
            sel = code == k
            if sel.any():
                rows.append({'key': item['key'], 'label': item['label'], 'setting': item['setting'],
                             'color': item['color'], 'cells': int(sel.sum()),
                             'area_ha': round(float(cell_ha[sel].sum()), 2),
                             'groups': {str(g): int((f == k).sum()) for g, f in by_group.items()}})
        return rows

    # Layers ----------------------------------------------------------------------

    def _layers(self, work_dir: Path, comp) -> list[dict]:
        """Every derived raster that has something to show, written as a PNG."""
        out: list[dict] = []

        def classes(ident, title, codes, legend, about):
            png = work_dir / f'mineral_{ident}.png'
            comp.write_rgba_png(render.classes_rgba(codes, legend), png)
            out.append({'id': ident, 'title': title, 'kind': 'classes', 'png': str(png),
                        'legend': [{k: v for k, v in item.items() if k in ('label', 'color', 'excluded')}
                                   for item in legend],
                        'about': about})

        def ramp(ident, title, values, spec, about):
            png = work_dir / f'mineral_{ident}.png'
            comp.write_rgba_png(render.ramp_rgba(values, spec['min'], spec['max'], spec['colors']), png)
            out.append({'id': ident, 'title': title, 'kind': 'ramp', 'png': str(png),
                        'ramp': spec, 'about': about})

        observed = self._observed()
        if self.pass_index is not None and self.exposed is not None:
            codes = np.where(observed, self.pass_index, -1)
            legend = [{'label': s.acquired or s.date, 'color': PASS_COLORS[i % len(PASS_COLORS)]}
                      for i, s in enumerate(self.scenes)]
            classes('pass', 'Pass used', codes, legend,
                    'The EMIT pass each cell took its answer from.')
            exp = np.full(self.inside.shape, -1, dtype=np.int32)
            exp[observed & self.exposed] = 0
            exp[observed & ~self.exposed] = 1
            exp[self.inside & self.masked & ~observed] = 2
            classes('exposure', 'Exposed ground', exp, EXPOSURE_LEGEND,
                    'Whether the pass used showed the cell free of green vegetation (NDVI) '
                    'and of plant residue (CAI).')

        if self.frcov and all(k in self.frcov for k in ('pv', 'npv', 'bare')):
            rgba = render.rgb_rgba(self.frcov['bare'], self.frcov['pv'], self.frcov['npv'])
            if rgba[..., 3].any():
                png = work_dir / 'mineral_frcov.png'
                comp.write_rgba_png(rgba, png)
                out.append({'id': 'frcov', 'title': 'Fractional cover (EMIT L2B)', 'kind': 'rgb',
                            'png': str(png),
                            'channels': {'r': 'bare soil', 'g': 'green vegetation',
                                         'b': 'dry vegetation'},
                            'about': 'EMIT L2B FRCOV of the pass used: red bare soil, '
                                     'green green vegetation, blue dry vegetation.'})

        acid = self._acid_sulfate_codes()
        if (acid >= 0).any():
            classes('acid_sulfate', 'Acid-sulfate minerals', acid, ACID_SULFATE,
                    'Cells whose answer in either group is a mineral of acid mine drainage.')

        for w in features.WINDOWS:
            m = self.positions.get(w.key)
            if m is None or not np.isfinite(m.position[self.inside]).any():
                continue
            spec = self._position_ramp(w)
            ramp(w.key, f'{w.title} position', np.where(self.inside, m.position, np.nan), spec,
                 f'Fitted wavelength of the {w.title} over cells identified as '
                 + ' or '.join(CLASS_LABELS[c].lower() for c in w.classes) + '.')

        for g, ent in self.entry.items():
            if g not in self.runner_up:
                continue
            ident = self.inside & (ent >= 0)
            margin = np.where(ident, self.fit[g] - self.runner_up[g], np.nan)
            ramp(f'margin{g}', f'Fit margin, group {g}', margin,
                 {'min': 0.0, 'max': MARGIN_DISPLAY_MAX, 'unit': 'fit', 'colors': CONFIDENCE_COLORS,
                  'low': 'another class fits as well', 'high': 'no other class near'},
                 'The answer\'s weighted fit minus the best fit of a reference of another class.')
            if self.draws and g in self.stability:
                ramp(f'stability{g}', f'Class stability, group {g}',
                     np.where(ident, self.stability[g], np.nan),
                     {'min': 0.0, 'max': 1.0, 'unit': 'fraction', 'colors': CONFIDENCE_COLORS,
                      'low': 'class changed in every draw', 'high': 'class held in every draw'},
                     f'Share of {self.draws} draws, perturbed by the reflectance uncertainty, '
                     'in which the class held.')
            if g in self.l2b_class:
                code = np.where(self.inside, l2b.agreement(self.mineral_only(self.port_class(g)),
                                                           self.mineral_only(self.l2b_class[g])),
                                l2b.UNCOMPARED).astype(np.int32)
                if (code >= 0).any():
                    classes(f'agreement{g}', f'Agreement with EMIT L2B, group {g}', code,
                            AGREEMENT_LEGEND,
                            'The mineral class here against the EMIT L2B product\'s, same pixel; '
                            'vegetation and water answers count as no mineral on both sides.')
        return out

    def write_geotiff(self, path: Path) -> None:
        """
        One band per quantity, EPSG:4326, for use outside TERRA. Entry bands
        hold the index into the `entries` tag, -1 where nothing was identified
        and -2 where the cell was not observed; the band description names
        every band.
        """
        import rasterio
        from rasterio.transform import from_origin

        g = self.grid
        bands, names = [], []
        for grp in self.entry:
            bands += [self.entry[grp].astype(np.float32), self.fit[grp], self.depth[grp]]
            names += [f'group{grp}_entry', f'group{grp}_fit', f'group{grp}_depth']
            if grp in self.runner_up:
                bands.append(self.runner_up[grp])
                names.append(f'group{grp}_runner_up_fit')
            if grp in self.l2b_class:
                bands.append(l2b.agreement(self.mineral_only(self.port_class(grp)),
                                           self.mineral_only(self.l2b_class[grp])).astype(np.float32))
                names.append(f'group{grp}_l2b_agreement')
            if self.draws and grp in self.stability:
                bands.append(self.stability[grp])
                names.append(f'group{grp}_stability')
        if self.pass_index is not None and self.exposed is not None:
            observed = self._observed()
            bands += [np.where(observed, self.pass_index, np.nan).astype(np.float32),
                      np.where(observed, self.exposed.astype(np.float32), np.nan).astype(np.float32)]
            names += ['pass_index', 'exposed']
            for name, v in (('ndvi', self.ndvi), ('cai', self.cai)):
                if v is not None:
                    bands.append(v.astype(np.float32))
                    names.append(name)
        for k in ('pv', 'npv', 'bare'):
            if k in self.frcov:
                bands.append(self.frcov[k].astype(np.float32))
                names.append(f'frcov_{k}')
        for key, m in self.positions.items():
            bands += [m.position.astype(np.float32), m.depth.astype(np.float32)]
            names += [f'{key}_position_nm', f'{key}_depth']
        profile = {
            'driver': 'GTiff', 'height': g.height, 'width': g.width,
            'count': len(bands), 'dtype': 'float32', 'crs': 'EPSG:4326',
            'transform': from_origin(g.lon0, g.lat0, g.dlon, g.dlat),
            'compress': 'deflate', 'nodata': np.nan,
        }
        with rasterio.open(path, 'w', **profile) as dst:
            for i, (b, name) in enumerate(zip(bands, names, strict=True), 1):
                out = np.where(self.inside, b, np.nan).astype(np.float32)
                dst.write(out, i)
                dst.set_band_description(i, name)
            dst.update_tags(
                expert_system=self.rules.source['expert_system'],
                entries=json.dumps([[e.index, e.ident, e.klass] for e in self.rules.entries]),
                classes=json.dumps(list(self.rules.classes)),
                passes=json.dumps([s.granule for s in self.scenes]),
            )


def _library_spectra(rules: tetracorder.Rules) -> dict[str, np.ndarray]:
    """The reference spectra, deleted channels as NaN, keyed by library record."""
    data = np.load(tetracorder.DATA_DIR / 'tetracorder_emit_spectra.npz')
    out = {}
    for rec, v in zip(data['records'], data['values'], strict=True):
        s = v.astype(np.float64)
        s[s < -1e30] = np.nan
        s[rules.deleted] = np.nan
        out[str(rec)] = s
    return out


def _coverage(g: emit.Granule, polygon) -> float:
    return float(g.footprint.intersection(polygon).area / polygon.area) if polygon.area > 0 else 0.0


def _nothing_observed(used: list[SceneUse], candidates: list[emit.Granule], cells: int,
                      masked: int, start: str, end: str) -> str:
    """
    Why no cell has an answer, in the counts that say it: how many passes the
    period held, and how many of the area's cells the cloud mask covered.
    """
    dates = ', '.join(sorted({g.start[:10] for g in candidates}))
    n = len(candidates)
    head = f'EMIT passed over the area {n} time{"s" if n != 1 else ""} between {start} and {end} ({dates})'
    if not used:
        return f'{head}, and no pass observed a cell of it'
    if masked >= cells:
        return f'{head}, and the cloud mask covered all {cells} cells of the area on every pass'
    return (f'{head}; the cloud mask covered {masked} of the {cells} cells of the area and '
            'the rest were outside every swath')


def _elsewhere_in_record(polygon, start: str, end: str, max_cloud: float) -> str:
    """
    The passes over the area outside the period, from the whole EMIT record,
    as a sentence to append; empty where there are none or the search fails.

    A period chosen for Sentinel-2, which passes every five days, holds few
    EMIT passes: over one area of the Quadrilatero Ferrifero the default year
    2025-09 to 2026-09 held one, 44% cloudy, while the record held 19.
    """
    from datetime import date

    try:
        record = emit.search(polygon, emit.RECORD_START, date.today().isoformat(), max_cloud=max_cloud)
    except protocol.Unavailable:
        return ''
    others = [g for g in record if not start <= g.start[:10] <= end]
    if not others:
        return ''
    clearest = sorted(others, key=lambda g: g.cloud_cover if g.cloud_cover is not None else 100.0)[:4]
    listed = ', '.join(
        f'{g.start[:10]} ({g.cloud_cover:.0f}% scene cloud)' if g.cloud_cover is not None else g.start[:10]
        for g in clearest)
    return (f'. EMIT has {len(others)} other pass{"es" if len(others) != 1 else ""} over the area '
            f'since {emit.RECORD_START}, the least cloudy {listed}; a period that includes them '
            'may observe it')


def _acquired(g: emit.Granule) -> str:
    a = g.acquisition
    if len(a) == 15 and a[8] == 'T':
        return f'{a[:4]}-{a[4:6]}-{a[6:8]} {a[9:11]}:{a[11:13]} UTC'
    return g.start[:10]


def run(polygon, start: str, end: str, *, max_cloud: float = 100.0,
        max_scenes: int = DEFAULT_PASSES, uncertainty_draws: int = 0,
        rules: tetracorder.Rules | None = None,
        progress: Callable[[int, str], None] = lambda p, m: None) -> MineralMap:
    """
    Map the area from the EMIT passes of the period.

    The passes are ranked by how much of the area they cover, then by scene
    cloud cover, and the first `max_scenes` are read in that order. Each is
    read once: for every cell it observes, its spectrum replaces the one held
    when it shows the ground more openly (cover.better), so at the end each
    cell holds the spectrum of the pass it is least covered in, and those are
    classified together. A cell's answer comes from one pass, never an average
    of several.
    """
    rules = rules or tetracorder.default_rules()
    progress(3, 'searching EMIT L2A granules (NASA CMR)')
    found = emit.search(polygon, start, end, max_cloud=max_cloud)
    if not found:
        raise NoScene(f'no EMIT L2A granule over the area between {start} and {end} '
                      f'with cloud cover at most {max_cloud:g}%'
                      + _elsewhere_in_record(polygon, start, end, max_cloud))
    found.sort(key=lambda g: (-round(_coverage(g, polygon), 2),
                              g.cloud_cover if g.cloud_cover is not None else 100.0))
    candidates = found[:max_scenes]

    grid: emit.OutputGrid | None = None
    inside: np.ndarray | None = None
    notes: list[str] = []
    passes: list[tuple[emit.Granule, SceneUse]] = []
    nb = len(rules.wavelengths)
    # Per cell inside the area, flattened: the spectrum held and where it is from.
    cell_of = np.zeros(0, dtype=np.int64)
    held = np.zeros((0, nb), dtype=np.float32)
    held_pass = held_row = held_col = np.zeros(0, dtype=np.int32)
    held_exposed = np.zeros(0, dtype=bool)
    held_ndvi = held_cai = np.zeros(0)
    ever_masked = np.zeros(0, dtype=bool)

    for n, gran in enumerate(candidates):
        base = 5 + int(75 * n / len(candidates))
        span = max(1, int(75 / len(candidates)))
        progress(base, f'reading pass {n + 1} of {len(candidates)}: {gran.ur} ({gran.start[:10]})')
        st = emit.structure(gran)
        if grid is None:
            grid = emit.output_grid(polygon, [float(v) for v in st.attributes['geotransform']])
            inside = emit.area_mask(grid, polygon)
            cells = int(inside.sum())
            cell_of = np.full(grid.height * grid.width, -1, dtype=np.int64)
            cell_of[np.flatnonzero(inside)] = np.arange(cells)
            held = np.full((cells, nb), np.nan, dtype=np.float32)
            held_pass = np.full(cells, -1, dtype=np.int32)
            held_row = np.full(cells, -1, dtype=np.int32)
            held_col = np.full(cells, -1, dtype=np.int32)
            held_exposed = np.zeros(cells, dtype=bool)
            held_ndvi = np.full(cells, np.nan)
            held_cai = np.full(cells, np.nan)
            ever_masked = np.zeros(cells, dtype=bool)
        assert inside is not None
        placement = emit.place(gran, st, grid, inside)
        if not (placement.row >= 0).any():
            continue
        bands = emit.band_parameters(gran, st)
        if len(bands['wavelengths']) != nb:
            raise protocol.Unavailable(
                f'{gran.ur} has {len(bands["wavelengths"])} channels; the reference '
                f'library is convolved to {nb}'
            )
        offset_nm = float(np.max(np.abs(bands['wavelengths'] / 1000.0 - rules.wavelengths))) * 1000.0
        bad = bands['good_wavelengths'] < 0.5
        channels = cover.band_channels(np.asarray(bands['wavelengths'], dtype=np.float64),
                                       ~bad & ~rules.deleted)
        mask_g = emit.find_mask(gran)
        mask_reader = None
        if mask_g is not None:
            mask_reader = emit.MaskReader(mask_g)
        else:
            notes.append(f'no L2A mask granule found for {gran.ur}; clouds are not excluded')
        use = SceneUse(gran.ur, gran.start[:10], gran.cloud_cover,
                       mask_g.ur if mask_g else None,
                       wavelength_offset_nm=round(offset_nm, 3), acquired=_acquired(gran))
        index = len(passes)
        passes.append((gran, use))
        key_rows = placement.row.astype(np.int64) * 100000 + placement.col

        def on_block(k: int, total: int, _b=base, _s=span, _u=gran.ur) -> None:
            progress(_b + int(_s * k / total), f'reading {_u}: block {k}/{total}')

        for blk in emit.blocks(gran, st, placement, mask_reader, on_block):
            spec = blk.reflectance
            spec[:, bad] = np.nan
            keys = blk.rows.astype(np.int64) * 100000 + blk.cols
            order = np.argsort(keys)
            pos = np.clip(np.searchsorted(keys[order], key_rows), 0, len(keys) - 1)
            hit = (key_rows == keys[order][pos]) & (placement.row >= 0) & inside
            flat = np.flatnonzero(hit)
            if len(flat) == 0:
                continue
            c = cell_of[flat]
            px = order[pos].ravel()[flat]
            masked = blk.masked[px]
            ever_masked[c[masked]] = True
            use.masked_cells += int(masked.sum())
            exp = cover.exposure(cover.band_means(spec[px], channels), masked)
            use.candidate_cells += int(exp.usable.sum())
            use.exposed_cells += int(exp.exposed.sum())
            take = cover.better(exp, held_pass[c] >= 0, held_exposed[c], held_ndvi[c])
            t = c[take]
            held[t] = spec[px[take]]
            held_pass[t] = index
            held_row[t] = blk.rows[px[take]]
            held_col[t] = blk.cols[px[take]]
            held_exposed[t] = exp.exposed[take]
            held_ndvi[t] = exp.ndvi[take]
            held_cai[t] = exp.cai[take]

    if grid is None or inside is None or not passes or not (held_pass >= 0).any():
        raise NoScene(_nothing_observed([u for _, u in passes], candidates,
                                        int(inside.sum()) if inside is not None else 0,
                                        int(ever_masked.sum()), start, end)
                      + _elsewhere_in_record(polygon, start, end, max_cloud))

    shape = (grid.height, grid.width)
    groups = rules.reported_groups
    class_index = {c: i for i, c in enumerate(rules.classes)}
    class_of_entry = np.array([class_index[e.klass] for e in rules.entries], dtype=np.int32)

    def class_of(ent: np.ndarray) -> np.ndarray:
        return np.where(ent >= 0, class_of_entry[np.maximum(ent, 0)], -1)

    def on_grid(values: np.ndarray, fill, dtype) -> np.ndarray:
        out = np.full(grid.height * grid.width, fill, dtype=dtype)
        out[np.flatnonzero(inside)] = values
        return out.reshape(shape)

    # Every held spectrum, classified at once.
    seen = held_pass >= 0
    progress(82, f'classifying {int(seen.sum())} cells')
    spectra = held[seen].astype(np.float64)
    res = tetracorder.classify(spectra, rules)
    entry: dict[int, np.ndarray] = {}
    fit: dict[int, np.ndarray] = {}
    depth: dict[int, np.ndarray] = {}
    runner_up: dict[int, np.ndarray] = {}
    for g in groups:
        e = np.full(len(held_pass), NOT_OBSERVED, dtype=np.int32)
        e[seen] = res[g].entry
        entry[g] = on_grid(e, NOT_OBSERVED, np.int32)
        for store, key in ((fit, 'fit'), (depth, 'depth'), (runner_up, 'runner_up')):
            v = np.zeros(len(held_pass), dtype=np.float32)
            v[seen] = getattr(res[g], key)
            store[g] = on_grid(v, 0.0, np.float32)

    positions = {}
    measured = spectra.copy()
    measured[:, rules.deleted] = np.nan
    waves_nm = rules.wavelengths * 1000.0
    for w in features.WINDOWS:
        wanted = np.isin(class_of(res[w.group].entry), [class_index[c] for c in w.classes])
        pos_c = np.full(len(held_pass), np.nan)
        dep_c = np.full(len(held_pass), np.nan)
        if wanted.any():
            m = features.measure(measured[wanted], waves_nm, w)
            sel = np.flatnonzero(seen)[wanted]
            pos_c[sel], dep_c[sel] = m.position, m.depth
        positions[w.key] = features.Position(on_grid(pos_c, np.nan, np.float64),
                                             on_grid(dep_c, np.nan, np.float64))

    stability: dict[int, np.ndarray] = {}
    if uncertainty_draws:
        progress(86, f'propagating the reflectance uncertainty: {uncertainty_draws} draws')
        sigma = np.full((len(held_pass), nb), np.nan, dtype=np.float32)
        for i, (gran, _) in enumerate(passes):
            mine = np.flatnonzero(held_pass == i)
            if len(mine) == 0:
                continue
            try:
                unc = emit.UncertaintyReader(gran)
            except protocol.Unavailable as e:
                notes.append(f'no reflectance uncertainty for {gran.ur} ({e}); '
                             'its cells have no stability')
                continue
            rows, cols = held_row[mine], held_col[mine]
            r0, r1 = int(rows.min()), int(rows.max()) + 1
            c0, c1 = int(cols.min()), int(cols.max()) + 1
            step = max(1, emit.BLOCK_BYTES // ((c1 - c0) * nb * 4))
            for a in range(r0, r1, step):
                b = min(a + step, r1)
                here = (rows >= a) & (rows < b)
                if here.any():
                    win = unc.window(a, b, c0, c1)
                    sigma[mine[here]] = win[rows[here] - a, cols[here] - c0]
        s_seen = np.nan_to_num(sigma[seen].astype(np.float64), nan=0.0)
        has_sigma = (sigma[seen] > 0).any(axis=1)
        nominal = {g: class_of(res[g].entry) for g in groups}
        kept = {g: np.zeros(len(spectra)) for g in groups}
        rng = np.random.default_rng(0)   # fixed, so a run repeated gives the same stability
        for _ in range(uncertainty_draws):
            drawn = tetracorder.classify(spectra + rng.standard_normal(spectra.shape) * s_seen, rules)
            for g in groups:
                kept[g] += class_of(drawn[g].entry) == nominal[g]
        for g in groups:
            share = np.full(len(held_pass), np.nan, dtype=np.float32)
            ok = (res[g].entry >= 0) & has_sigma
            share[np.flatnonzero(seen)[ok]] = (kept[g][ok] / uncertainty_draws).astype(np.float32)
            stability[g] = on_grid(share, np.nan, np.float32)

    pass_index = on_grid(held_pass, -1, np.int32)
    observed = inside & (pass_index >= 0)
    frcov: dict[str, np.ndarray] = {}
    l2b_class: dict[int, np.ndarray] = {}
    for i, (gran, use) in enumerate(passes):
        mine = observed & (pass_index == i)
        use.cells = int(mine.sum())
        use.chosen_exposed_cells = int((held_exposed[held_pass == i]).sum())
        if not mine.any():
            continue
        progress(90, f'reading EMIT L2B products of {gran.acquisition}')
        try:
            urls = emit.find_frcov(gran)
        except protocol.Unavailable as e:
            urls = None
            notes.append(f'EMIT L2B FRCOV search failed for {gran.ur}: {e}')
        if urls:
            try:
                got = emit.frcov_at(urls, grid, mine)
                for key, vals in got.items():
                    frcov.setdefault(key, np.full(shape, np.nan))[mine] = vals[mine]
                use.frcov_granule = urls['bare'].rsplit('/', 2)[-2]
            except (protocol.Unavailable, OSError) as e:
                notes.append(f'EMIT L2B FRCOV could not be read for {gran.ur}: {e}')
        try:
            min_g = emit.find_l2b_min(gran)
        except protocol.Unavailable as e:
            min_g = None
            notes.append(f'EMIT L2B MIN search failed for {gran.ur}: {e}')
        if min_g is None:
            continue
        try:
            reader = emit.L2BReader(min_g)
            table = l2b.class_table(reader.metadata(), rules)
            lookup = np.full(max(table) + 1, -1, dtype=np.int32)
            for idx, klass in table.items():
                lookup[idx] = class_index[klass]
            chosen = emit.Placement(on_grid(np.where(held_pass == i, held_row, -1), -1, np.int32),
                                    on_grid(np.where(held_pass == i, held_col, -1), -1, np.int32))
            ids = reader.ids(chosen, groups)
            for g in groups:
                v = ids[g]
                cls = np.full(shape, -2, dtype=np.int32)
                cls[v == 0] = -1
                known = (v > 0) & (v < len(lookup))
                cls[known] = lookup[v[known]]
                l2b_class.setdefault(g, np.full(shape, -2, dtype=np.int32))[mine] = cls[mine]
            use.l2b_granule = min_g.ur
        except (protocol.Unavailable, OSError, KeyError) as e:
            notes.append(f'EMIT L2B MIN could not be read for {gran.ur}: {e}')

    masked = inside & ~observed & on_grid(ever_masked, False, bool)
    used = [u for _, u in passes if u.cells > 0]
    if used and max(u.wavelength_offset_nm for u in used) > 1.0:
        notes.append(
            f'scene wavelengths differ from the reference library by up to '
            f'{max(u.wavelength_offset_nm for u in used):.2f} nm; channels are matched '
            'by index, as Tetracorder does'
        )
    with_frcov = sum(1 for u in used if u.frcov_granule)
    if with_frcov < len(used):
        notes.append(f'EMIT L2B FRCOV exists for {with_frcov} of the {len(used)} passes used; '
                     'cells from the others have no fractional cover')
    progress(95, 'writing maps')
    return MineralMap(grid, inside, entry, fit, depth, masked, [u for _, u in passes], rules, notes,
                      runner_up=runner_up, pass_index=pass_index,
                      exposed=on_grid(held_exposed, False, bool) & observed,
                      ndvi=on_grid(held_ndvi, np.nan, np.float64),
                      cai=on_grid(held_cai, np.nan, np.float64),
                      frcov=frcov, positions=positions, l2b_class=l2b_class,
                      stability=stability, draws=uncertainty_draws)
