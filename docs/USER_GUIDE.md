# User guide

End-to-end workflow for classifying land cover with TERRA. For install details,
see [INSTALL.md](INSTALL.md). For common failures, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Longer manuals (general audience + academic/researcher) are in preparation; this
page is the short path through the current desktop app.

## Prerequisites

- A TERRA desktop build ([releases](https://github.com/rexionmars/TERRA/releases))
  — prefer **FULL** (`*-full.zip`) for spectral RF without installing Python —
  **or** a from-source install (`wails dev` / `wails build`).
- For **LITE** builds: Python 3.12 with [`requirements.txt`](../requirements.txt),
  and `GEOSENSE_PYTHON` if the interpreter is not on `PATH`.
- Network access to the Microsoft Planetary Computer STAC catalog (and Hugging
  Face if you use Prithvi).

## 1. Open the map workspace

On launch, TERRA shows a short boot/splash screen while it probes the Python
sidecar, then reveals the map. After a version bump you may see a **What’s New**
modal once; dismiss it to continue.

Main chrome:

- **Project switcher** (title bar) — create / open projects
- Left dock — **New classification** or **Compositions**
- **Overlay Tools** (top-right) — overlays, swipe, opacity, export
- Map, search, basemap controls

## 2. Projects, AOI names, and runs

A **Project** groups an AOI, band compositions, and inference runs.

- Rename the **AOI** (map chip / Analysis header) without renaming every run.
- Each classification is saved as a **run** with a `run-…` label (unique per
  execution). Lists and Compare show run names; the Cover map title shows the
  **project** name with a separate **AOI** row.
- In the project hub, open a project to land on **Analyses** (classification
  runs). Switch to the **Band compositions** tab for RGB / indices from the map —
  click a card for a preview modal (export / View on map).

Create a project from the hub or when you have an AOI on the map, then keep that
project active while you classify.

## 3. Choose an area of interest (AOI)

Pick one of:

| Method | When to use |
|--------|-------------|
| Areas **A / B / C** | Validated polygons from the SBrT 2026 reference work (fastest first run) |
| **Draw** | Digitize a polygon on the map |
| **Search** | Nominatim place search, then draw or refine |
| **Import** | Load a KML or GeoJSON polygon |

Keep AOIs modest for the first run (farm / field scale). Very large polygons
increase STAC I/O and classification time, especially with Prithvi in pixel mode.

Right-click inside the AOI for rename, contour colors, fit, or clear (also
reachable from Overlay Tools for contours).

## 4. Set the acquisition window

1. Choose **start** and **end** dates (`YYYY-MM-DD`).
2. Set **max cloud cover** (percent).
3. Leave **monthly best** enabled unless you need every qualifying scene
   (monthly best keeps the lowest-cloud scene per month).

## 5. Preview the data cube (optional)

Open the data-cube inventory to list Sentinel-2 L2A scenes that match the AOI
and filters (date, cloud, optional MGRS tiles). Use this to confirm that enough
scenes exist before Classify. Zero scenes usually means a tighter cloud filter
or a period with no coverage — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 6. Select a model and mode

| Model | Notes |
|-------|--------|
| **Spectral Random Forest** (default) | 80 spectro-temporal features; matches the reference method; supports **temporal** soybean-retention mode |
| **Temporal Transformer** | Series model over the Sentinel-2 stack (`tt_mapbiomas.pt`) |
| **Prithvi-EO 2.0** | Foundation-model embeddings + RF head; needs `requirements-prithvi.txt`; first run downloads ~1.2 GB from Hugging Face |

Mode:

- **Single / map** — one classification over the full selected stack
- **Temporal** — cumulative stacks with soybean retention (spectral RF only)

## 7. Classify

Click **Classify**. Progress messages stream from the sidecar. When finished,
the Result strip shows class shares; the map shows the prediction overlay.

Runs are saved locally (guest user if you are not signed in) so you can reopen
them later from Analysis / Projects.

## 8. Overlay Tools

Open **Overlay Tools** (button under the basemap control) to:

- Show / hide prediction, confidence, and composition overlays
- **Swipe** imagery ↔ overlay
- Smooth prediction / opacity for prediction and composition
- AOI contour schemes
- Export PNG / GeoTIFF when available
- Preview overlay thumbnails

Visibility and opacity are **not** controlled from the Result strip or the
Classify / Compositions panels — use Overlay Tools only.

## 9. Band compositions (optional)

Switch the left dock to **Compositions**, list scenes for the period, pick RGB
or an index, set percentile stretch, then **Apply**. Applying a composition
hides the prediction overlay so the composite is visible; toggle both again in
Overlay Tools.

## 10. Analysis and Compare

Open **Analysis** for:

- Cover map tiles (satellite, NDVI mean, MapBiomas, prediction, confidence)
- Class statistics, VI series, phenology
- Project hub (Analyses tab by default; Band compositions tab for map composites)
- Open a band composition card for a preview modal (export / View on map)
- **Export tables** — ZIP with CSVs (class stats, VI series, phenology, MapBiomas compare), AOI GeoJSON, and classification GeoTIFF when available — for notebooks / training workspaces
- Export GeoTIFF from the analysis header when available

From saved runs, select two and **Compare** for side-by-side prediction /
confidence, class distribution, and phenology / NDVI when both runs provide them.

## 11. Settings

**Settings** (sidebar) covers account, default model / opacity preferences,
appearance (theme, dock tabs), and recent runs. Preferences auto-save for the
local or signed-in user.

## 12. Accounts (optional)

Local accounts (email/password) store preferences and tie saved runs to a
profile. Avatars and display names are optional. Everything stays on disk under
the app config directory (e.g. `~/Library/Application Support/geosense-infer/`
on macOS); there is no cloud sync.

## Suggested first run

1. Create or open a **Project**.
2. Select embedded area **A**.
3. Use a one-year agricultural window with monthly best and a moderate cloud
   threshold (e.g. 30%).
4. Model: **spectral**, mode: single.
5. Classify, then adjust overlays in **Overlay Tools**.
6. Open **Analysis**, then optionally run Temporal Transformer on the same AOI
   and **Compare**.
