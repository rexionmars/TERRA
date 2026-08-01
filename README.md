# TERRA

<p align="center">
  <img src="docs/img/terra-opensource-project.png" alt="TERRA Open Source Project" width="280" />
</p>

Desktop application for land-cover classification from Sentinel-2 time series.
Draw or import an area of interest, preview scenes, run a classifier, and inspect
prediction overlays, confidence, phenology, and saved analyses — including
side-by-side comparison of two runs.

Imagery is read on demand from the Sentinel-2 L2A STAC catalog (Microsoft
Planetary Computer) as Cloud-Optimized GeoTIFFs — only the polygon window and the
required bands are fetched, so no full product download is required.

The spectral Random Forest path reproduces the method described in:

> Melo, J. L. S., Magalhães, D. K., Kolodziej, J. E., Kuhn, E. V.
> *Automatic Land Cover Classification with Sentinel-2 and MapBiomas Time
> Series.* XLIV Brazilian Symposium on Telecommunications and Signal Processing
> (SBrT 2026), Salvador, BA, Brazil.

<p align="center">
  <img src="docs/img/KML_ROI.jpeg" alt="TERRA map with a custom AOI over Campo Maior, Piauí" width="900" />
</p>

<p align="center"><em>Map workspace — AOI, period, model, and Classify</em></p>

## Statement of need

Researchers and practitioners who study agricultural land cover often need
**reproducible, AOI-scale classification** from Sentinel-2 without scripting a
full Earth Engine or desktop GIS pipeline for every farm. Common gaps:

- Notebook-only workflows are hard to hand to collaborators who want a map UI.
- Full scene downloads are heavy when only a small polygon matters.
- Comparing models (classical RF vs transformers vs foundation-model embeddings)
  usually means separate scripts and ad-hoc overlays.

**TERRA** targets remote-sensing and agronomy researchers (and students) who
want a local desktop tool that: clips COGs on demand, runs published-style
spectro-temporal Random Forest (and optional deep models), inspects confidence /
phenology / MapBiomas context, and saves or compares runs — without a cloud
account for the app itself.

## Documentation

| Doc | Contents |
|-----|----------|
| [User guide](docs/USER_GUIDE.md) | AOI → classify → Analysis → Compare |
| [Install](docs/INSTALL.md) | LITE vs FULL releases, Python env, from-source |
| [Releasing](docs/RELEASING.md) | SemVer tags, when to bump, when not to release |
| [Roadmap](docs/ROADMAP.md) | Planned packaging and analysis features |
| [Architecture](docs/ARCHITECTURE.md) | Wails shell, sidecar, STAC/COG design |
| [API](docs/API.md) | Go bindings and sidecar JSON contracts |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Python, STAC, models, macOS |
| [Contributing](CONTRIBUTING.md) | Issues, PRs, tests |
| [Design](docs/DESIGN.md) | Visual identity tokens |
| [JOSS paper draft](paper/paper.md) | Manuscript + BibTeX for Journal of Open Source Software |

## Quick start

1. Prefer a **FULL** release zip (embeds Python) — or install Python 3.12 +
   `pip install -r requirements.txt` for **LITE** (see [Install](docs/INSTALL.md)).
2. Download from [releases](https://github.com/rexionmars/TERRA/releases) **or** run `wails dev` from source.
3. Open TERRA (set `GEOSENSE_PYTHON` only if using LITE / a custom interpreter).
4. Select embedded area **A** (or draw an AOI), set a seasonal date range, model **spectral**.
5. Click **Classify** and inspect overlays / class stats in Analysis.

Full walkthrough: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Overview

- Select any area: draw a polygon, search a location, or import a KML/GeoJSON
  file. Three validated study areas from the reference work are included as
  examples.
- Choose an acquisition period and a maximum cloud cover. By default one scene
  per month (lowest cloud cover) is selected; optionally preview the Sentinel-2
  data cube before classifying.
- Run **Random Forest** (spectro-temporal features), **Temporal Transformer**,
  or **Prithvi-EO 2.0** embeddings (NASA/IBM), in map or temporal mode.
- Inspect prediction and confidence overlays, MapBiomas reference layers, class
  statistics, vegetation indices, and phenology.
- Save analyses locally and **compare two runs** side by side (overlays, class
  distribution, phenology / NDVI when available).

## Gallery

| MapBiomas reference | Random Forest | Temporal Transformer |
|:-------------------:|:-------------:|:--------------------:|
| ![MapBiomas for ROI](docs/img/mapbiomas_for_roi.jpeg) | ![RF prediction](docs/img/RF_prediction.jpeg) | ![TT prediction](docs/img/Temporal_transformers_prediction.jpeg) |

<p align="center">
  <img src="docs/img/comparasion_TT_RF.jpeg" alt="Compare analyses: Temporal Transformer vs Random Forest" width="900" />
</p>

<p align="center"><em>Compare mode — prediction and confidence for two saved analyses</em></p>

## Download

Prebuilt desktop bundles for macOS, Windows, and Linux are attached to each
[release](https://github.com/rexionmars/TERRA/releases). Two flavors:

| Flavor | Example assets | Notes |
|--------|----------------|-------|
| **FULL** | `TERRA-macOS-arm64-full.zip`, `TERRA-*-amd64-full.zip` | Embeds Python 3.12 + spectral RF deps — unzip and run |
| **LITE** | `TERRA-macOS-universal-lite.zip`, `TERRA-*-amd64-lite.zip` | Smaller; needs system Python + [`requirements.txt`](requirements.txt) |

FULL covers **spectral** classification out of the box. Temporal Transformer /
Prithvi still need torch (`requirements-prithvi.txt`). Details:
[docs/INSTALL.md](docs/INSTALL.md).

## Architecture

```
TERRA/
├── main.go / app.go     Wails window and frontend bindings
├── backend/             Sidecar runner, geocode, types, SQLite store
├── sidecar/             Inference pipeline (STAC, features, models)
├── model/               Trained classifier artifacts (.joblib / .pt)
├── areas/               Embedded example polygons (GeoJSON)
├── frontend/            React 19 + Vite 7 + Tailwind 4 + Leaflet
└── docs/                User and developer documentation
```

Design rationale and diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Binding and JSON contracts: [docs/API.md](docs/API.md).

### Stack

| Layer     | Technology |
|-----------|------------|
| Shell     | Wails v2 (Go) |
| Frontend  | React 19, Vite 7, TypeScript 5.9, Tailwind CSS 4 |
| Map       | Leaflet, react-leaflet 5, leaflet-draw |
| Charts    | Recharts |
| Inference | Python 3.12, scikit-learn, rasterio, pyproj, shapely, pystac-client, planetary-computer |

## Requirements

- **FULL release:** no system Python required for spectral RF
- **LITE / from source:** Python 3.12 + [`requirements.txt`](requirements.txt)
- **Prithvi (optional):** [`requirements-prithvi.txt`](requirements-prithvi.txt)
- **From source:** Go 1.23+, Node.js 18+, [Wails CLI](https://wails.io)

Interpreter resolution: `GEOSENSE_PYTHON` → bundled `python/` (FULL) → `.venv` → `python3` on `PATH`.

## Development

```bash
pip install -r requirements.txt
cd frontend && npm ci && cd ..
wails dev
```

```bash
wails build    # → build/bin/
```

See [docs/INSTALL.md](docs/INSTALL.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Testing

Automated offline tests (store, paths, VI/phenology/LULC helpers, RF smoke) run
on every push and pull request to `main` via GitHub Actions.

```bash
go test ./backend/...
pip install -r requirements-dev.txt
pytest sidecar/tests -q
```

## Configuration

| Variable             | Purpose |
|----------------------|---------|
| `GEOSENSE_PYTHON`    | Python interpreter for the sidecar |
| `GEOSENSE_APP_DIR`   | Directory containing `sidecar/`, `areas/`, `model/` |
| `GEOSENSE_MODEL_DIR` | Trained model directory (defaults to `model/`) |

## Models

| Model | Role |
|-------|------|
| **Spectral Random Forest** | Default; 80 spectro-temporal features; reproduces the SBrT reference method; temporal soybean retention |
| **Temporal Transformer** | Series model over the Sentinel-2 stack (`tt_mapbiomas.pt`) |
| **Prithvi-EO 2.0** | Frozen [Prithvi-EO 2.0 300M](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M) embeddings + RF heads (`pixel` / `patch`); requires torch/terratorch |

Artifacts live under `model/`. Use a scikit-learn version compatible with
serialization (`requirements.txt` pins 1.8.x). Retrain Prithvi heads with
`sidecar/train_prithvi.py`.

## Data sources

Sentinel-2 L2A from the
[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/) STAC
catalog (anonymous signed URLs). Location search via
[OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/). Basemap tiles
include Esri World Imagery and EOX Sentinel-2 cloudless 2025.

## License and community

MIT. See [LICENSE](LICENSE).

Contributions, bug reports, and support requests: [CONTRIBUTING.md](CONTRIBUTING.md)
and [GitHub Issues](https://github.com/rexionmars/TERRA/issues).
