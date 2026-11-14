# Architecture

TERRA is a **local desktop** research application: a Wails (Go) shell hosts a
React map UI and drives a Python sidecar for geospatial inference. There is no
hosted API server.

## High-level layout

```text
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + MapLibre GL) in native WebView       │
│  AOI, period, models, Analysis, Compare, auth UI        │
└──────────────────────────┬──────────────────────────────┘
                           │ Wails bindings (Go ↔ JS)
┌──────────────────────────▼──────────────────────────────┐
│  Go shell — main.go / app.go / internal/                │
│  Window lifecycle, Predict / DataCube / LULC / Geocode  │
│  SQLite store (users, preferences, saved runs)          │
└──────────────────────────┬──────────────────────────────┘
                           │ subprocess · JSON stdin/stdout
                           │ progress JSON lines on stderr
┌──────────────────────────▼──────────────────────────────┐
│  Python sidecar — sidecar/infer.py (+ lulc, phenology…) │
│  STAC → COG /vsicurl → features → model → PNG / GeoTIFF │
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Planetary Computer STAC         installed model packages
  MapBiomas (local or COG)        (Prithvi HF cache ~1.2 GB)
```

## Why this design

| Choice | Rationale |
|--------|-----------|
| **Desktop (Wails)** | Researchers keep AOIs and results on their machine; native save dialogs; no account server required |
| **Python sidecar** | Reuses the notebook/sklearn/rasterio stack that matches the published spectral method without rewriting ML in Go |
| **JSON over stdio** | Small, language-agnostic contract; progress as line-delimited JSON on stderr |
| **STAC + COG windows** | Avoid full Sentinel-2 product downloads; only the AOI window and needed bands are read |
| **SQLite locally** | Optional accounts and analysis history without cloud sync |

Trade-offs: distribution still depends on a local Python environment; offline
use is incomplete (STAC, Nominatim, optional Hugging Face); large AOIs or
Prithvi pixel mode can be slow.

## Repository map

| Path | Role |
|------|------|
| `main.go`, `app.go` | Window, boot, methods exposed to the frontend |
| `internal/analysis/` | The sidecar boundary: spawn Python, and the request/result types |
| `internal/pyenv/` | Find, inspect and build the Python interpreter |
| `internal/research/` | The research pack export |
| `internal/geocode/` | Place-name lookup through Nominatim |
| `internal/store/` | SQLite persistence |
| `internal/models/` | Install, list and remove model packages |
| `sidecar/` | Inference, LULC, phenology, Prithvi, Temporal Transformer |
| `model/` | Sources of the model packages: the weights, and `packages/<id>/model.json`; and `catalog.json`, the catalogue the Models screen lists. `scripts/package_models.py` builds the packages and the catalogue from it, and the application reads only the catalogue |
| `frontend/` | React 19 + Vite + Tailwind + MapLibre GL |

## Inference pipeline (predict)

1. Take the AOI polygon from the request. It is the only way a request
   names a ground: the embedded areas A/B/C, which a request could select
   by id instead, are gone.
2. Query Planetary Computer STAC for Sentinel-2 L2A scenes (cloud filter,
   optional monthly-best, optional tiles).
3. Clip bands to the polygon on a reference grid (typically B04).
4. Check the installed model package (every file against the SHA-256 in its
   manifest), then build features or embeddings by the package's family.
5. Classify; write overlay / confidence / optional reference PNGs and a
   GeoTIFF; attach VI series, phenology, and LULC when available.
6. Go embeds PNGs as data URIs, emits `predict:progress`, and persists the run,
   with the id, version and digest of the model package that made it.

## Model packages

The application ships no model. A model is a package the reader installs from
the Models screen: a zip holding its files and a `model.json` that names each by
role, with its SHA-256 and size, and states what the model is.

| Field | Meaning |
|-------|---------|
| `format` | The manifest's version, `1` |
| `id`, `version` | `id` is what a run records as `model_kind`; lower case, digits, `.`, `_`, `-` |
| `family` | How the sidecar runs it: `feature_rf`, `sequence_transformer` or `embedding_rf` |
| `task` | What it does: `land_cover`, `time_series` or `observation_quality`; each family does one task, and the three above do `land_cover` |
| `files` | Role to `{name, sha256, size}`; the task and the roles of each family are `FAMILIES` in `sidecar/terra/models.py` |
| `classes` | MapBiomas codes it emits; required for `land_cover`, absent or empty for every other task |
| `modes`, `requires`, `variants` | The classify modes it supports, optional Python packages, embedding heads |
| `summary`, `reads`, `method`, `evaluation`, `limits`, `license`, `doi`, `picture` | What the Models screen and the method brief say about it |
| `packaged_by` | Who made the package, as `[{"name": ...}]`; who developed the model is named by the evaluation's `source` |

Installed packages live under the data directory at `models/<id>/<version>/`
(`internal/models`). A package of an unknown family or task, of a family that
does another task, with a file named outside its folder, or whose files do not
hash to the manifest is refused at import, and the sidecar checks the digests
again before every run, because loading a pickle runs code. Only a `land_cover`
package may hold pickles; a package of any other task holds JSON and NPZ, and
the sidecar reads an NPZ with `allow_pickle=False`. A package brings weights
only: a new architecture is a new family in `terra/models.py` and the code that
runs it, and a new model of a known family is a manifest and its files.

The Models screen lists the **catalogue**, `catalog.json` in the models
repository, [rexionmars/TERRA-models](https://github.com/rexionmars/TERRA-models),
read when the screen opens; without a connection it shows the copy the build
embeds, `model/catalog.json` (`internal/models/catalog.go`). Each entry is a
package's manifest, its picture, the SHA-256 and size of its zip, and the
places the zip is published: a release of the models repository tagged
`<id>-<version>`, and Zenodo once the manifest's `doi` is the Zenodo DOI
reserved for it. A
download is checked against the zip's SHA-256 before anything is unpacked, and
the package in it against the entry's digest before it appears installed.
`TERRA_MODEL_CATALOG` points the application at another catalogue, for a mirror
or a test.

`python3 scripts/package_models.py` builds the packages of the models in
`model/` into `dist/models/` and writes the catalogue. The zips are
reproducible, so a package built again has the SHA-256 the catalogue gives for
it. Publishing is by hand: a release of the models repository with the zip, a
Zenodo record, and then the catalogue at that repository's root.

## Related docs

- [API.md](API.md) — bindings and JSON contracts
- [USER_GUIDE.md](USER_GUIDE.md) — operator workflow
- [DESIGN.md](DESIGN.md) — visual identity tokens
- [SURFACES.md](SURFACES.md) — why the interface is panels rather than screens
