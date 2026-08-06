# Tier 1 handoff — research methods ready to ship

Implementation brief for three capabilities whose research prototypes are
validated and whose target code paths already exist in TERRA. Written to be
self-contained: a contributor with no prior context should be able to work from
this document plus the linked source.

Scope of this document: **what to build and where**. It does not commit to a
schedule, and it does not cover the Tier 2 / Tier 3 items listed at the end.

Source of truth for the surfaces described here: [`app.go`](../app.go),
[`backend/types.go`](../backend/types.go), [`backend/sidecar.go`](../backend/sidecar.go),
[`sidecar/infer.py`](../sidecar/infer.py). See also [ARCHITECTURE.md](ARCHITECTURE.md)
and [API.md](API.md).

---

## 1. Repository layout

Both directories live in the same parent repository.

| Role | Path |
|------|------|
| Research prototypes (reference implementations) | `mestrado/` |
| TERRA desktop product (target) | `geosense-infer/` |

Research code is not a dependency of TERRA. The prototypes are read and ported;
they are not imported at runtime.

## 2. Extension contract

Follow the pattern used by the existing `lulc` action end to end.

### 2.1 Python sidecar

[`sidecar/infer.py`](../sidecar/infer.py), function `main()` (line ~854),
dispatches on `action`:

```python
if action == 'ping':             # line 865
if action == 'lulc':             # line 875   -> delegates to lulc.py
if action == 'list_datacube':    # line 888
if action == 'render_composite': # line 938   -> delegates to composite.py
# default: predict
```

New capabilities get their own module and a thin dispatch branch. Existing
delegated modules to use as structural models: [`sidecar/lulc.py`](../sidecar/lulc.py),
[`sidecar/composite.py`](../sidecar/composite.py), [`sidecar/phenology.py`](../sidecar/phenology.py).

### 2.2 Go bridge

[`backend/sidecar.go`](../backend/sidecar.go) — one `Runner` method per action.
Use `AnalyzeLULC` (line 509) as the reference: it resolves the AOI (embedded
area or custom polygon), creates a temp work dir, marshals `sidecarRequest`,
runs the subprocess and unmarshals the response.

### 2.3 Request struct

[`backend/types.go`](../backend/types.go) line 60. New fields are added here
with `json:"...,omitempty"` tags:

```go
type sidecarRequest struct {
    Action         string           `json:"action,omitempty"`
    ModelDir       string           `json:"model_dir"`
    Source         string           `json:"source"`
    Start          string           `json:"start,omitempty"`
    End            string           `json:"end,omitempty"`
    MaxCloud       float64          `json:"max_cloud"`
    MonthlyBest    bool             `json:"monthly_best"`
    Tiles          []string         `json:"tiles"`
    PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
    MapBiomasPath  string           `json:"mapbiomas_path,omitempty"`
    Mode           string           `json:"mode"`
    ModelKind      string           `json:"model_kind"`
    PrithviMode    string           `json:"prithvi_mode"`
    WorkDir        string           `json:"work_dir"`
    // Composite / index render (action=render_composite)
    SceneID    string    `json:"scene_id,omitempty"`
    Kind       string    `json:"kind,omitempty"`
    Bands      []string  `json:"bands,omitempty"`
    Index      string    `json:"index,omitempty"`
    StretchPct []float64 `json:"stretch_pct,omitempty"`
}
```

### 2.4 Wails binding

[`app.go`](../app.go) — public method delegating to the `Runner`, following
`AnalyzeLULC` (line 212). Wails regenerates the TypeScript bindings under
`frontend/wailsjs/`. Update [API.md](API.md) in the same change.

### 2.5 Frontend

`frontend/src/components/`. Existing panels for reference: `LulcSection.tsx`,
`ResultsPanel.tsx`, `ControlPanel.tsx`, `OverlayToolsPanel.tsx`, `MapView.tsx`.
Raster results reach the map as base64 PNG data URIs positioned by
`ImageOverlay` with bounds from `get_map_extent`.

### 2.6 Tests

`sidecar/tests/` — every new module needs a matching test file, following
`test_lulc.py`, `test_composite.py`, `test_phenology.py` and the fixtures in
`conftest.py`.

## 3. Existing helpers to reuse

In [`sidecar/infer.py`](../sidecar/infer.py):

| Function | Line | Purpose |
|----------|-----:|---------|
| `list_stac_products()` | 149 | STAC query, cloud filter, best-scene-per-month selection |
| `load_band_to_reference_grid()` | 344 | Read a band and resample onto a reference grid (already mixes 10 m and 20 m) |
| `polygon_from_geojson()` | 84 | Polygon from the UI GeoJSON |
| `get_map_extent()` | 710 | Bounds for the Leaflet `ImageOverlay` |
| `write_overlay_png()` | 729 | RGBA PNG delivered as a data URI |
| `configure_gdal_for_cog()` | 844 | GDAL configuration for COG reads |
| `emit_progress()` | 69 | Incremental progress to the UI |

**SWIR is already plumbed.** `extra_bands = ['B8A', 'B11', 'B12']` (line 217)
and the Temporal Transformer path already reads them at 20 m (lines 646-651).
Items 1 and 2 need no new band infrastructure.

---

## 4. Item 1 — Surface water and flood mapping

**Reference implementation:** `mestrado/flood_mapping_analysis.ipynb`
(functions `compute_water_indices`, `otsu_threshold`, `water_masks`).

**Target:** new `sidecar/water.py` plus an `action: 'water'` branch in `infer.py`.

### Indices

| Index | Formula | Reference |
|-------|---------|-----------|
| NDWI | `(green - nir) / (green + nir)` | McFeeters (1996) |
| MNDWI | `(green - swir1) / (green + swir1)` | Xu (2006) |
| AWEI | `4(green - swir1) - (0.25 nir + 2.75 swir2)` | Feyisa et al. (2014) |

Bands: B03 (green), B08 (nir), B11 (swir1), B12 (swir2).

Thresholding uses Otsu with a fixed fallback, both already implemented in the
notebook. Port them directly — the computation is deterministic and adds no
dependency.

### Proposed contract

```jsonc
// request
{
  "action": "water",
  "polygon_geojson": { },
  "start": "2025-01-01",
  "end": "2025-12-31",
  "max_cloud": 30,
  "monthly_best": true,
  "index": "MNDWI",
  "work_dir": "/tmp/geosense-water-xxxx"
}

// response
{
  "water": {
    "index": "MNDWI",
    "threshold_method": "otsu",
    "series": [
      {"date": "2025-01-09", "threshold": 0.12, "water_fraction_pct": 3.4, "area_ha": 4.2}
    ],
    "peak_scene": {"date": "2025-03-05", "overlay_uri": "data:image/png;base64,..."},
    "extent": [[-25.1, -53.6], [-25.0, -53.5]]
  }
}
```

### Notes

No model, no training, no trained legend — therefore no exposure to the
fixed-legend domain-shift limitation documented in the README. This is the
lowest-risk of the three items.

### Acceptance

Run over study area A and compare the water fraction series against
`mestrado/output/flood_mapping_water_fraction_series.csv` and
`flood_mapping_summary_abc.csv`. Exact equality is not expected: TERRA selects
scenes monthly from STAC while the notebook used 22 curated dates. Check
magnitude and signal shape, not identity.

---

## 5. Item 2 — Change detection

**Reference implementation:** `mestrado/change_detection_analysis.ipynb`
(functions `compute_indices`, `cloud_shadow_mask`, `aoi_mask_from_stack`).

**Target:** new `sidecar/change.py` plus an `action: 'change'` branch.

### Indices

```python
ndvi = (nir - red)   / (nir + red)
nbr  = (nir - swir2) / (nir + swir2)
ndmi = (nir - swir1) / (nir + swir1)
```

### Outputs

| Output | Definition |
|--------|------------|
| NDVI difference | `NDVI_t2 - NDVI_t1` (vegetation gain / loss) |
| CVA magnitude | `sqrt(dNDVI^2 + dNBR^2)` (change intensity) |
| CVA direction | `arctan2(dNBR, dNDVI)`; the quadrant gives the change type |
| Consecutive series | `dNDVI` between adjacent dates |

### Prerequisite: SCL asset

The notebook's `cloud_shadow_mask()` prefers the L2A Scene Classification Layer,
removing classes 3 (cloud shadow), 8 and 9 (cloud medium / high probability) and
10 (thin cirrus), and falls back to a spectral screen when SCL is absent.

The sidecar does not currently fetch SCL: `required_bands = ['B02','B03','B04','B08']`
and `extra_bands = ['B8A','B11','B12']` (lines 216-217). The Planetary Computer
`sentinel-2-l2a` item exposes an `SCL` asset. **Adding SCL to the resolvable
assets is part of this item** — change detected between two dates is sensitive to
residual cloud, and the spectral fallback is weaker than the SCL mask.

### Proposed contract

```jsonc
{
  "action": "change",
  "polygon_geojson": { },
  "date_a": "2024-05-04",
  "date_b": "2025-01-09",
  "method": "cva",
  "work_dir": "/tmp/geosense-change-xxxx"
}
```

Response carries the overlay PNG as a data URI, a magnitude histogram, the
composition by direction quadrant, and the consecutive `dNDVI` series.

### Acceptance

Compare against `mestrado/output/output_change_detection/`.

---

## 6. Item 3 — MapBiomas reference-cell accounting

**Reference implementation:** `mestrado/experiments/class41_decomposition/build_wide_aoi.py`,
function `native_cell_ids()`.

**Target:** [`sidecar/lulc.py`](../sidecar/lulc.py) and the `class_stats` block of
the `predict` path in [`sidecar/infer.py`](../sidecar/infer.py) (line 763).

### The issue

MapBiomas Collection rasters are native at **30 m**. `lulc.py` reprojects them
onto the 10 m classification grid and counts with `px_ha_override` of 0.01 ha
(see the docstring at line 324). Area figures are correct — area is area.

Sample sizes are not. Each native reference cell becomes about nine 10 m pixels,
so any `n` or agreement statistic in the pred-vs-ref comparison treats nine
replicates of one label observation as nine independent observations. A 100 ha
AOI reports on the order of 10 000 reference observations where it has
approximately 1 100.

### The fix

For each pixel of the 10 m grid, compute the index of the 30 m cell it was
resampled from, and report the number of distinct cells alongside the pixel
count:

```python
# adapted from build_wide_aoi.py:native_cell_ids
xs, ys = rasterio.transform.xy(ref_transform, rows, cols, offset="center")
lon, lat = Transformer.from_crs(ref_crs, mb_crs, always_xy=True).transform(xs, ys)
mb_rows, mb_cols = rasterio.transform.rowcol(mb_transform, lon, lat)
cell_ids = np.asarray(mb_rows) * mb_width + np.asarray(mb_cols)
n_reference_cells = int(len(np.unique(cell_ids)))
```

### Surfaces to update

- `ClassStat` in [`backend/types.go`](../backend/types.go) line 84: add
  `n_reference_cells` next to `pixels`.
- `class_stats.csv` in the research export package.
- `manifest.json` in the same package.
- The pred-vs-ref view in the UI, so the reported sample size is the cell count.

### Notes

This item adds no feature. It corrects a number the app already displays, and it
is the smallest of the three — a reasonable first change for validating the edit
and review cycle.

---

## 7. Suggested order

1. **Item 3** — smallest, isolated, no new UI.
2. **Item 1** — no new dependency, no model risk.
3. **Item 2** — largest, because it carries the SCL work.

Items 1 and 2 already appear in [ROADMAP.md](ROADMAP.md) under
*Product analysis (desktop)*.

## 8. Project constraints

- [CONTRIBUTING.md](../CONTRIBUTING.md) and [RELEASING.md](RELEASING.md):
  SemVer, small reviewable pull requests.
- No emoji in code, comments, logs, plots or UI strings.
- Descriptive, non-promotional naming.
- The repository-level `.claude/CLAUDE.md` style rules apply to TERRA as well.

## 9. Out of scope for this handoff

Assessed and deliberately excluded, with the reason:

| Item | Reason |
|------|--------|
| Class-41 unsupervised decomposition | The supported number of subgroups varies by site (2, 6 and 2 across three nearby farms); it requires training a self-supervised encoder on the local agricultural pixels; and the partition is only interpretable with its stability measurements attached. See `mestrado/experiments/class41_decomposition/report.md`. |
| Out-of-distribution warning | Ready in substance but needs a UI decision on how to surface it; see the Piauí case in `mestrado/exports/analysis_report.md`. Tier 2. |
| Crop stress diagnostics | Mature as indicators, not as diagnosis — the stress thresholds have no field validation. Ship as labelled proxies only. Tier 2. |
| Topography | Needs a new data source (Copernicus DEM GLO-30, available in the same STAC catalog). Not blocked by science. Tier 3. |
| Domain adaptation / LEM+ | Incomplete: no source-trained baseline, and the offset estimator compares field-occupancy fraction against mean NDVI, which are quantities of different nature. Tier 3. |
