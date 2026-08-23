# Architecture

TERRA is a **local desktop** research application: a Wails (Go) shell hosts a
React map UI and drives a Python sidecar for geospatial inference. There is no
hosted API server.

## High-level layout

```text
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Leaflet) in native WebView           │
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
  Planetary Computer STAC         model/*.joblib | *.pt
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
| `sidecar/` | Inference, LULC, phenology, Prithvi, Temporal Transformer |
| `model/` | Trained artifacts |
| `areas/` | Embedded GeoJSON study areas A/B/C |
| `frontend/` | React 19 + Vite + Tailwind + Leaflet |

## Inference pipeline (predict)

1. Resolve AOI (embedded area or GeoJSON polygon).
2. Query Planetary Computer STAC for Sentinel-2 L2A scenes (cloud filter,
   optional monthly-best, optional tiles).
3. Clip bands to the polygon on a reference grid (typically B04).
4. Build features or embeddings depending on `model_kind`.
5. Classify; write overlay / confidence / optional reference PNGs and a
   GeoTIFF; attach VI series, phenology, and LULC when available.
6. Go embeds PNGs as data URIs, emits `predict:progress`, and persists the run.

## Related docs

- [API.md](API.md) — bindings and JSON contracts
- [USER_GUIDE.md](USER_GUIDE.md) — operator workflow
- [DESIGN.md](DESIGN.md) — visual identity tokens
