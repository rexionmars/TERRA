# API reference

TERRA exposes a **Wails binding API** from Go to the React frontend, and a
**sidecar JSON protocol** between Go and Python. End users of the desktop app do
not call these directly; they matter for contributors and for reviewers who
want to understand the core surface.

Source of truth: [`app.go`](../app.go), [`internal/analysis/types.go`](../internal/analysis/types.go),
[`internal/analysis/runner.go`](../internal/analysis/runner.go), [`sidecar/infer.py`](../sidecar/infer.py).

## Wails methods (`App`)

### Inference and inventory

| Method | Input | Output | Description |
|--------|--------|--------|-------------|
| `ListEmbeddedAreas` | — | `[]Area` | Study areas A/B/C from `areas/*.geojson` |
| `Predict` | `PredictRequest` | `PredictResult` | Run classification; streams `predict:progress` |
| `ListDataCube` | `DataCubeRequest` | `DataCubeResult` | List STAC scenes for the AOI/filters |
| `AnalyzeLULC` | `LULCRequest` | `LULCAnalysis` | MapBiomas descriptive analysis only |
| `ExportClassification` | raster path | saved path | Native save dialog for the GeoTIFF |
| `GeocodeSearch` | query string | `[]GeocodeResult` | OSM Nominatim search |

### Saved analyses

| Method | Description |
|--------|-------------|
| `ListRuns(limit)` | Recent inference runs (guest or signed-in user) |
| `LoadAnalysis(runID)` | Reload a saved `PredictResult` (overlays as data URIs) |

### Auth and preferences (local SQLite)

| Method | Description |
|--------|-------------|
| `Register` / `Login` / `Logout` | Local account session |
| `CurrentUser` | Active user or `null` |
| `UpdateProfile` / `SetAvatar` / `ClearAvatar` | Profile |
| `GetPreferences` / `SavePreferences` | Default model, theme, overlay opacity |

### Boot / window

| Method | Description |
|--------|-------------|
| `GetBootLogs` | Messages collected during splash/boot |
| `RevealMainWindow` | Show the main frameless window after splash |
| `OpenExternal` | Open a URL in the system browser |

## Key request types

### `PredictRequest`

```json
{
  "area_id": "A",
  "polygon_geojson": null,
  "start": "2023-01-01",
  "end": "2023-12-31",
  "max_cloud": 30,
  "monthly_best": true,
  "tiles": [],
  "mode": "single",
  "model_kind": "spectral",
  "prithvi_mode": "pixel"
}
```

- `area_id` and `polygon_geojson` are mutually exclusive (area id preferred when set).
- `mode`: `"single"` or `"temporal"` (temporal soybean retention requires spectral RF).
- `model_kind`: `"spectral"` | `"temporal_transformer"` | `"prithvi"`.
- `prithvi_mode`: `"pixel"` or `"patch"` when using Prithvi.

### `PredictResult` (frontend-facing)

Important fields:

| Field | Meaning |
|-------|---------|
| `extent` | `lon_min`, `lat_min`, `lon_max`, `lat_max` |
| `overlay_uri` / `confidence_uri` / … | PNG data URIs for Leaflet |
| `raster_tif` | Path to classification GeoTIFF |
| `class_stats` | Per-class pixels, %, hectares |
| `vi_series` / `phenology` / `phenology_states` | Temporal vegetation summary |
| `lulc` | Optional MapBiomas composition block |
| `temporal` | Cumulative steps when `mode` is temporal |

Progress events (`predict:progress`): `{ "progress": 0–100, "msg": "…" }`.

## Sidecar protocol

Go writes one JSON object to the sidecar **stdin** and reads one JSON result
from **stdout**. Progress and errors are JSON lines on **stderr**.

### Actions

| `action` | Behavior |
|----------|----------|
| omitted / predict | Full classification pipeline |
| `list_datacube` | Scene inventory only |
| `lulc` | MapBiomas descriptive analysis |
| `ping` | Lightweight health check (Python side) |

### Example predict request (stdin)

```json
{
  "model_dir": "/path/to/model",
  "source": "stac",
  "start": "2023-01-01",
  "end": "2023-12-31",
  "max_cloud": 30,
  "monthly_best": true,
  "tiles": ["T22JBT"],
  "polygon_geojson": { "type": "Polygon", "coordinates": [ /* … */ ] },
  "mapbiomas_path": "",
  "mode": "single",
  "model_kind": "spectral",
  "prithvi_mode": "pixel",
  "work_dir": "/tmp/geosense-run-…"
}
```

### Example progress / error (stderr)

```json
{"progress": 40, "msg": "building features"}
{"error": "no Sentinel-2 scenes matched the filters"}
```

### Example result (stdout)

Paths are absolute files under `work_dir` (`overlay_png`, `raster_tif`,
`confidence_png`, …) plus `class_stats`, `vi_series`, `phenology`, optional
`lulc`. Go converts PNG paths to data URIs before returning `PredictResult` to
the UI.

## TypeScript mirror

Frontend types live in [`frontend/src/lib/types.ts`](../frontend/src/lib/types.ts)
and should stay aligned with the types in `internal/analysis/`, which
`frontend/scripts/check-types.ts` verifies.
