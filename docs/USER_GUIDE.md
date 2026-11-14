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

## 1. The map

On launch, TERRA shows a short boot screen while it probes the Python sidecar, then
the map, with the start screen over it. After a version bump you may see **What's
New** once.

- **Left rail:** Explore, Analyses, Compare, Workflows, Models, Activity, and
  your account at the foot. The button above the account shows the labels.
- **Top right corner:** where you are, as one path: **TERRA EO**, the open project
  and the area, each a menu. **TERRA EO** opens the application's menu: project
  files, settings, the Python environment and storage. The area's menu ends with
  **Manage areas…**, which opens the Areas panel.
- **Right edge of the map:** Products, Compositions, Result, Points and Layers,
  then the map's own tools: search, basemap, imagery date, relief, draw, edit,
  import, delete.

One panel is open at a time. Opening another closes it.

## 2. Projects, areas, and runs

The hierarchy is **project › area › run**. A **project** is a workspace: a farm, a
study, a season. An **area** is one ground inside it. A **run** is one measurement
over one area.

- Every run is filed under the area it was measured on.
- Deleting an area takes the runs measured on it and their rasters, and its fields
  and theirs. Deleting a project takes its areas and theirs. Both ask first, and
  neither can be undone.
- Rename an area without renaming the runs made over it.

**A project is required before drawing.** An area belongs to one, so with no project
open the map refuses the shape. Create one from the project menu at the top right.

## 3. Make an area

- **Draw:** the pencil on the map's right edge.
- **Import:** a `.kml` or GeoJSON file, from the Areas panel or the map's tools.
- **Catalogue:** a Brazilian state or municipality from IBGE, in the Areas panel.

The Areas panel, under **Manage areas…** in the area's menu at the top right, lists them with their hectares and runs. Pressing one goes to it; its rename
and delete buttons appear on hover. Fields delineated in an area are listed under it.

**Shift-press** several areas or fields, on the map or in the list, to select them.
A product started over a selection is queued once per area.

## 4. Run a product

Open **Products**, choose one, and fill in its form. The button says why it cannot
run, where it cannot. Each product states the limit on reading it beside its form
and its result; read that first. **Method** says what the run will do and, during a
run, what it has said so far.

| Product | Reads | Runs |
|---------|-------|------|
| Classification | Sentinel-2 series, in five MapBiomas classes | Directly |
| Surface water | Spectral index, Otsu per date | Directly |
| Mineral map | EMIT reflectance. Needs an Earthdata token | Directly |
| Field boundaries | Two Sentinel-2 scenes | Directly |
| Vegetation health | NDVI and NDRE against earlier seasons | Queued |
| Socio-environmental overlap | Public registers, on the day it runs | Queued |
| Sentinel-1 radar | VV and VH through the period | Queued |
| Management zones | Per-season NDVI | Queued |

**Land cover**, beside Classification's Method, reads MapBiomas over the area without
running a model.

TERRA ships without models. **Models**, in the rail, lists the catalogue of
published models, each with a page that says what it reads, how it works, how it
was evaluated and its limits, before anything is downloaded. **Download and
install** fetches the model's package from GitHub, or from Zenodo when GitHub
fails, and installs it only if it matches the SHA-256 the catalogue lists.
**Run on the map** opens Classification on an installed model, and **Remove**
uninstalls it. Runs made with a model keep their results after it is removed, and
name the version and files that made them.

A model of your own comes in through **Import a package**, which takes its zip and
checks every file against the SHA-256 in its manifest. A package loads with
Python's pickle, which can run code, so import only what you trained or got from
someone you trust.

A queued product runs over a saved area, one job after another, and the queue is
listed in its form. A running product keeps a progress strip over the map when its
panel is closed. When a run finishes, its result opens.

Runs are saved locally, so you can reopen them from **Analyses**. There, choose a
project in the column at the left, or **All analyses**. Runs are listed by day, newest
first, and the runs of one request over several areas are grouped as a batch. Select
a run to see what it found and to move or delete it, and double-click it, or press
**Open on the map**, to open it. The **+** beside Projects makes a new project.

## 5. Read a result

**Result** holds what is on the map. With more than one product on it, choose which
at the top.

- **Classification:** Summary (figures, classes, agreement with MapBiomas), Spectra,
  Separability, Library and Tables. The panel widens for those that need it.
  **Research pack** exports the run's tables and figures.
- **Field boundaries:** filter by size and cropland, make the fields areas of the
  saved area, or save them as GeoJSON.
- **Management zones:** choose the number of zones; the map follows.

**Take off the map** removes a result from the session; a saved run stays saved.

## 6. Layers and Points

**Layers** lists every raster of the result, top of the stack first, with its switch
and opacity, and saves it as PNG or GeoTIFF where one exists. The classification also
has a majority filter here. Right-click a raster on the map to frame it or hide it.

**Points** places A and B on the map and reads the class under each, in one pixel or
a neighbourhood. Its graph is the mean spectrum of each point's **class**: a run keeps
no spectrum per pixel, so it is not what the point itself reflects.

## 7. Compositions

One Sentinel-2 scene as a band composite or a spectral index. List the scenes of the
period, choose one, pick RGB or an index, set the stretch, and **Apply**. It is a way
of looking at one acquisition and measures nothing over the period. Compositions of
the area are listed under the form, each with its exports.

## 8. Compare

Runs of any area and any product, as nodes on a board. **Add a run** brings in a
saved one. Each run is drawn to its own scale and says how much ground it spans.

Readings are nodes too. Add one from **Add**, then pull a link from a run's
**Classes** onto its inputs; a run can feed any number of readings, so several
comparisons stand on the board at once. Select a reading to read it in full in the
panel at the right. **View › Arrange** sets each reading beside the runs it reads,
and **X** removes the reading selected.

- **Differences:** what differs between runs A and B, agreement, class transitions
  and share deltas. **Copy deltas** puts them on the clipboard as CSV.
- **Domain shift:** how far apart A and B sit in what the model saw. **Cohort:**
  every target measured from one source.
- **Spectra**, **Separability**, **Library** and **Tables**, in every run linked.

Two classifications on an empty board get a Differences node linked to both.

## 9. Workflows

The compositor, full screen. Each run in hand offers its outputs as sockets; nodes
filter, mask, mix and tabulate them. A Viewer shows a result beside the graph, a Globe
node draws it on the map, under Layers, and a PDF report node writes up what reaches
it. Use **Add** or Shift+A for nodes.

A right-click opens a ring of what can be done where it lands. On empty ground it adds
a node there: pick a category, then the node. On a node it adds one after it (already
linked), duplicates it (Shift+D), links it to the Viewer, disconnects its inputs, folds
it or removes it. On a wire it removes the link or sets a node on it. Click an option,
or hold the right button, move toward an option and let go. Escape steps back a ring.

**Save** stores the graph and its runs under a name, and the menu by that name opens
another. A saved workflow is kept in the project and in its `.terra` file. Closing
with unsaved changes asks first.

## 10. Project files

Under **TERRA EO**, the mark at the top right: open, save, save as and reveal a
`.terra` file. **Save** in Workflows, or Cmd/Ctrl+S, also writes the project's file
when it has one.

## 11. Finding a command

**F3** or **Cmd/Ctrl+K** finds every command by name. **Settings › Keymap** lists them
with their keys.

## 12. Settings and accounts

Your account at the foot of the rail opens **Settings**, beside the map like the other
places in the rail:

- **Profile:** your photo, name and email, under a cover you can change, with the year's
  activity, the latest analyses and **Sign out**.
- **Appearance:** the theme, and when **What's New** is shown.
- **Data:** the space your data takes, a backup to one ZIP file, and restoring one.
- **System:** the Python environment and the Earthdata token.
- **Keymap:** every command with its keys.

Preferences save as they change.

Local accounts store preferences and tie saved runs to a profile. Everything stays on
disk under the application's config directory; there is no cloud sync.

## Suggested first run

1. Create a **project** from the project menu at the top right.
2. Draw an **area** with the pencil. It is saved under the project.
3. Open **Products › Classification**. Use a period of a few months with the clearest
   scene per month and a moderate cloud limit.
4. **Classify**. The result opens when it finishes.
5. Adjust the rasters under **Layers**, and read the limit in **Result**.
6. Run it again over another period or model, then open **Compare** and link the
   two runs into a **Differences** node, as A and B.
