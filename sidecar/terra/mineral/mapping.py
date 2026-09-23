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
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from terra import protocol
from terra.mineral import emit, tetracorder

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
    'other': 'Other reference',
}

# Colours for the class maps and their legend, sent in the payload so the
# frontend draws the legend from the same values the PNG was drawn with.
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
    'other': '#8c8c8c',
}
NO_ANSWER_RGBA = (200, 200, 200, 90)
MASKED_RGBA = (90, 90, 90, 140)

NOT_OBSERVED = -2   # cell inside the area that no scene observed usably
NO_ANSWER = -1      # observed, and no reference passed its constraints

# A pass is added until this fraction of the area is observed or the scene
# budget is spent. Mineralogy does not change between passes, so a second
# pass only fills cloud and swath gaps left by the first.
TARGET_COVERAGE = 0.98


class NoScene(RuntimeError):
    """No EMIT granule observed the area in the period."""


@dataclass
class SceneUse:
    granule: str
    date: str
    cloud_cover: float | None
    mask_granule: str | None
    cells: int = 0
    masked_cells: int = 0
    wavelength_offset_nm: float = 0.0


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

    def to_payload(self, work_dir) -> dict:
        from terra.imagery import composite as comp

        work_dir = Path(work_dir)
        cell_ha = self.grid.cell_area_ha()[:, None] * np.ones((1, self.grid.width))
        first = next(iter(self.entry.values()))
        observed = self.inside & (first != NOT_OBSERVED)
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

    def write_geotiff(self, path: Path) -> None:
        """
        One band per group and quantity, EPSG:4326, for use outside TERRA.
        Entry bands hold the index into the `entries` tag, -1 where nothing was
        identified and -2 where the cell was not observed.
        """
        import rasterio
        from rasterio.transform import from_origin

        g = self.grid
        bands, names = [], []
        for grp in self.entry:
            bands += [self.entry[grp].astype(np.float32), self.fit[grp], self.depth[grp]]
            names += [f'group{grp}_entry', f'group{grp}_fit', f'group{grp}_depth']
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
            )


def _coverage(g: emit.Granule, polygon) -> float:
    return float(g.footprint.intersection(polygon).area / polygon.area) if polygon.area > 0 else 0.0


def run(polygon, start: str, end: str, *, max_cloud: float = 100.0, max_scenes: int = 3,
        rules: tetracorder.Rules | None = None,
        progress: Callable[[int, str], None] = lambda p, m: None) -> MineralMap:
    """
    Map the area from the EMIT passes of the period, best first.

    Passes are ranked by how much of the area they cover, then by scene cloud
    cover. Each pass fills only the cells earlier passes left unobserved or
    masked; a cell's answer comes from one pass, never an average of several.
    """
    rules = rules or tetracorder.default_rules()
    progress(5, 'searching EMIT L2A granules (NASA CMR)')
    found = emit.search(polygon, start, end, max_cloud=max_cloud)
    if not found:
        raise NoScene(f'no EMIT L2A granule over the area between {start} and {end} '
                      f'with cloud cover at most {max_cloud:g}%')
    found.sort(key=lambda g: (-round(_coverage(g, polygon), 2),
                              g.cloud_cover if g.cloud_cover is not None else 100.0))

    grid: emit.OutputGrid | None = None
    inside = entry = fit = depth = masked = None
    scenes: list[SceneUse] = []
    notes: list[str] = []
    groups = rules.reported_groups

    for n, gran in enumerate(found[:max_scenes]):
        base = 10 + int(80 * n / max_scenes)
        span = int(80 / max_scenes)
        progress(base, f'reading {gran.ur} ({gran.start[:10]})')
        st = emit.structure(gran)
        if grid is None:
            grid = emit.output_grid(polygon, [float(v) for v in st.attributes['geotransform']])
            inside = emit.area_mask(grid, polygon)
            shape = (grid.height, grid.width)
            entry = {g: np.full(shape, NOT_OBSERVED, dtype=np.int32) for g in groups}
            fit = {g: np.zeros(shape, np.float32) for g in groups}
            depth = {g: np.zeros(shape, np.float32) for g in groups}
            masked = np.zeros(shape, dtype=bool)
        assert inside is not None and entry is not None and fit is not None
        assert depth is not None and masked is not None

        todo = inside & (entry[groups[0]] == NOT_OBSERVED)
        if not todo.any():
            break
        placement = emit.place(gran, st, grid, todo)
        if not (placement.row >= 0).any():
            continue

        bands = emit.band_parameters(gran, st)
        offset_nm = float(np.max(np.abs(bands['wavelengths'] / 1000.0 - rules.wavelengths))) * 1000.0 \
            if len(bands['wavelengths']) == len(rules.wavelengths) else float('nan')
        if not np.isfinite(offset_nm):
            raise protocol.Unavailable(
                f'{gran.ur} has {len(bands["wavelengths"])} channels; the reference '
                f'library is convolved to {len(rules.wavelengths)}'
            )
        bad = bands['good_wavelengths'] < 0.5

        mask_g = emit.find_mask(gran)
        mask_reader = None
        if mask_g is not None:
            mask_reader = emit.MaskReader(mask_g)
        else:
            notes.append(f'no L2A mask granule found for {gran.ur}; clouds are not excluded')

        use = SceneUse(gran.ur, gran.start[:10], gran.cloud_cover,
                       mask_g.ur if mask_g else None, wavelength_offset_nm=round(offset_nm, 3))
        key_rows = placement.row.astype(np.int64) * 100000 + placement.col

        def on_block(i: int, total: int, _b=base, _s=span, _u=gran.ur) -> None:
            progress(_b + int(_s * i / total), f'classifying {_u}: block {i}/{total}')

        for blk in emit.blocks(gran, st, placement, mask_reader, on_block):
            spec = blk.reflectance
            spec[:, bad] = np.nan
            usable = ~blk.masked & np.isfinite(spec).any(axis=1)
            res = tetracorder.classify(spec[usable], rules) if usable.any() else None
            keys = blk.rows.astype(np.int64) * 100000 + blk.cols
            order = np.argsort(keys)
            pos = np.searchsorted(keys[order], key_rows)
            pos = np.clip(pos, 0, len(keys) - 1)
            hit = (key_rows == keys[order][pos]) & (placement.row >= 0)
            src = order[pos]
            m_cells = hit & blk.masked[src]
            masked |= m_cells
            use.masked_cells += int(m_cells.sum())
            u_cells = hit & usable[src]
            if res is None or not u_cells.any():
                continue
            # Index of each usable pixel within the classified subset.
            sub = np.cumsum(usable) - 1
            k = sub[src[u_cells]]
            for g in groups:
                entry[g][u_cells] = res[g].entry[k]
                fit[g][u_cells] = res[g].fit[k]
                depth[g][u_cells] = res[g].depth[k]
            masked[u_cells] = False
            use.cells += int(u_cells.sum())
        scenes.append(use)
        observed = inside & (entry[groups[0]] != NOT_OBSERVED)
        if observed.sum() >= TARGET_COVERAGE * inside.sum():
            break

    if grid is None or not scenes or all(s.cells == 0 for s in scenes):
        raise NoScene('EMIT granules were found, but none observed the area without '
                      'cloud or outside its swath')
    assert inside is not None and entry is not None and fit is not None
    assert depth is not None and masked is not None
    offsets = [s.wavelength_offset_nm for s in scenes]
    if max(offsets) > 1.0:
        notes.append(
            f'scene wavelengths differ from the reference library by up to '
            f'{max(offsets):.2f} nm; channels are matched by index, as Tetracorder does'
        )
    progress(95, 'writing maps')
    return MineralMap(grid, inside, entry, fit, depth, masked, scenes, rules, notes)
