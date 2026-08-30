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
  and `TERRA_PYTHON` if the interpreter is not on `PATH`.
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

## 2. Projects, areas, and runs

The hierarchy is **project › area › run**. A **project** is a workspace — a
farm, a study, a season. An **area** is one ground inside it. A **run** is one
measurement over one area.

- A project can hold as many areas as you work. It has no single AOI of its own.
- Every run is filed under the area it was measured on and the project that
  area is in, so a project holding a dozen fields lists a dozen grounds rather
  than a hundred runs in one grid.
- Deleting an area takes the runs measured on it. Deleting a project takes its
  areas and theirs. Both ask first.
- Rename an area without renaming the runs made over it.
- Each run carries a `run-…` label, unique per execution. Lists and Compare
  show run names.
- In the hub, open a project to land on **Areas**; open one to see its runs.
  The **Compositions** tab holds the RGB / index compositions applied from the
  map — click a card for a preview modal (export / View on map).

**A project is required before drawing.** An area belongs to one, so with no
project open the map refuses the shape rather than keeping it somewhere it does
not belong. Create or open a project first, then keep it active while you work.

## 3. Draw an area

| Method | When to use |
|--------|-------------|
| **Draw** | Digitize a polygon on the map or on the studio globe |
| **Search** | Nominatim place search, then draw or refine |
| **Import** | Load a KML or GeoJSON polygon |

A new area is named `drawn`, `drawn 2` and so on, numbered against what the
project already holds. Rename it from the areas list.

Keep areas modest for the first run (farm / field scale). Very large polygons
increase STAC I/O and classification time, especially with Prithvi in pixel mode.

Right-click inside the area for rename, contour colors, fit, or clear (also
reachable from Overlay Tools for contours).

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
- Project hub (Areas tab by default, runs one level in; Compositions tab for map composites)
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

1. Create or open a **Project**. Drawing needs one: an area belongs to a
   project, and a run belongs to an area.
2. Draw an **area** on the map. It is saved under the open project and named
   `drawn`, `drawn 2` and so on; rename it from the areas list.
3. Use a one-year agricultural window with monthly best and a moderate cloud
   threshold (e.g. 30%).
4. Model: **spectral**, mode: single.
5. Classify, then adjust overlays in **Overlay Tools**.
6. Open **Analysis**, then optionally run Temporal Transformer on the same AOI
   and **Compare**.
