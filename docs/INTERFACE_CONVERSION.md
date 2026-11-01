# Converting the interface to a map

TERRA's interface was rebuilt: a board subdivided into editors gave way to a
full-screen map with one panel at a time. This file records how the conversion was
done and what it decided, as a record. [SURFACES.md](SURFACES.md) describes the
result and is the one to keep current.

**State: all five phases are done, and the studio is gone.** The conversion ran on
`refactor/map-shell`, whose first phase is commits `8ed00dd` to `71e9814`.

## What changed

| | Studio (before) | Map shell (after) |
| --- | --- | --- |
| Main surface | 3D viewport, with rasters lifted off their coordinates | Full-screen globe, with rasters in place |
| Layout | Board split into areas, arranged by the reader | Fixed: rail, header, tool column and map |
| Other content | 17 editors in 7 workspaces | One floating panel at a time, and two full-screen destinations |
| Starting a run | Run graph | Product list, then a form |
| Comparing runs | Comparison editor in any arrangement | Compare screen with a fixed grid |
| Compositor | One editor among the others | Workflows destination |

The layout follows the Pixxel Aurora reference in `.temp/pixxel_reference`. That
folder is git-ignored and must stay out of the repository. Only the layout was taken
from it, not its brand, images, rainbow ramp or labels such as "High Stress".

## How it was done

**Both interfaces ran side by side until the map reached parity,** behind one
switch in `App.tsx` that went with the studio. The studio stayed reachable throughout
phases 1 to 4, which is what made it safe to ship each phase.

**The contract between `App` and the surface did not change until the last phase.**
`MapShell` took `StudioScreenProps` as it stood, so a run started from either surface
was made of the same inputs. The props no surface read were dropped when the studio
went, and it is now `MapShellProps` in `MapShell.tsx`.

**Parity was measured, not assumed.** Before the removal, a read-only inventory listed
every capability of the studio against the shell, and the props the shell did not read
were the checklist. It found things the plan had not listed: the research pack, the
IBGE boundaries, the land cover reading, the method panel and the start screen had no
destination, and a switch added in phase 2 turned out to do nothing on the map.

**Each phase was tested in the real application,** with an isolated store. See
[Testing a step](#testing-a-step). The real runs found what no unit test had: a
classification of exactly six dates, which is half a year of monthly-best scenes,
stopped in the sidecar's phenology smoothing. That is fixed.

**Commits are split by subject, and each must compile and pass on its own.** The
first attempt at phase 1 had 16 `tsc` errors in three intermediate commits while the
last was clean, which only a per-commit check in a temporary worktree showed.

## Phases

### Phase 1: the shell

Commits `8ed00dd` (palette), `d804208` (icons), `67121b2` (layer routing) and
`71e9814` (the shell): rail and header, project and area crumbs, project creation, and
the Areas, Products, Result, Layers and Activity panels.

### Phase 2: visualization and results

- A **Visualization** panel for compositions.
- **Readings** for the mineral map, field boundaries and the queued products in the
  Result panel, reusing the compositor's cards. Classification gained Spectra,
  Separability, Library and Tables, and the panel widens for them.
- **Areas:** rename, delete (through the application's confirmation, since deleting an
  area deletes its runs and rasters), fields under their area, selection for a queue,
  and states and municipalities from IBGE.
- **Fields:** filter by size and cropland, adopt as areas, save as GeoJSON.
- **Points:** A and B pinned on the map, with the mean spectrum of each point's class.
- **Layers:** every raster of a run, its exports, and the majority filter.
- **Raster rotation fixed.** The sidecar now reports a projected raster's four corners
  (`Bounds.corners`), and the map pins the raster to them. A UTM grid does not run
  along the meridians, so the box alone drew it turned by the meridian convergence,
  about 1 degree at Cascavel. A run saved earlier has no corners and is drawn by its box.

### Phase 3: Compare

A fixed grid of runs of any product, each tile saying how much ground it spans; A and B
marked on the tiles; and Differences, Domain shift, Cohort, Spectra, Separability,
Library and Tables read beside it.

### Phase 4: Workflows

The compositor at full screen. What it read through the board now comes from the
session's runs (`lib/sessionRuns.ts`), which Compare shares: the run on the map, those
it moved on from, and those brought in by name. A Globe node draws on the map, as rows
under Layers. A saved board is a saved workflow.

### Phase 5: removing the studio

`StudioScreen`, `BoardSurface`, `BoardSidebar`, the area tree, the 3D scene and `three`
are gone, with the operators, preferences and settings only they used. What the shell
still needed moved to `components/workspace/`. The store and the `.terra` format keep
the name `studio`, so older files still open.

## Where each editor went

| Studio editor | Destination |
| --- | --- |
| Globe | The map itself |
| Run | Products panel |
| Browser | Analyses destination |
| Reports | Activity panel |
| Outliner | Areas and Layers panels, header crumbs |
| Properties | Result panel |
| Mineral map | Result panel |
| Rover | Points panel |
| Viewport | Compare grid |
| Comparison | Compare, Differences |
| Domain shift | Compare, Domain shift and Cohort |
| Spectral response | Result panel and Compare |
| Class separability | Result panel and Compare |
| Library check | Result panel and Compare |
| Data table | Result panel and Compare |
| Compositor | Workflows destination |
| Console | Dropped: F3 runs every operator by name |

## Decisions

Made by the project owner:

- Comparison survives as a fixed-grid screen. The 3D viewport and panel subdivision go.
- The palette is TERRA's own, not the reference's.
- Icons are Breeze. Hand-drawn rail icons and Phosphor were both rejected.
- The rail is 52 px, as in the reference.
- No green tint in the greys.

Taken during the work, and open to change:

- The compositor became a full-screen Workflows destination.
- The run graph became a product list with a form.
- The Rover became A/B points on the map.
- Domain shift, spectra, separability, library and tables read in Result for one run
  and in Compare for two.
- The Console went, since F3 does its work. Undo and redo went with the board, whose
  edits were all they covered.
- A saved board is a workflow: one with a graph opens on Workflows, one without on
  Compare.

What was given up on purpose is listed in [SURFACES.md](SURFACES.md#what-was-given-up).

## Testing a step

Use an isolated home directory. `store.Open` resolves its path through
`os.UserConfigDir()`, so a plain `wails dev` writes to the real database. On
macOS, overriding `HOME` also means pointing Go at its real caches:

```bash
REAL_HOME=$HOME
HOME=/path/to/scratch/home \
GOPATH=$REAL_HOME/go \
GOCACHE=$REAL_HOME/Library/Caches/go-build \
GOMODCACHE=$REAL_HOME/go/pkg/mod \
TERRA_PYTHON=$PWD/.venv/bin/python \
wails dev -noreload
```

The application is then served at `http://localhost:34115/`. It can be driven from
headless Chrome over the DevTools protocol (`--remote-debugging-port=9333`), with
`--use-angle=swiftshader --enable-unsafe-swiftshader` so that the globe has WebGL.
An exception in `wails/ipc.js` reading `nodes` comes from the Wails browser
runtime, not from this code.

Drive the whole path a user takes, and look at the screenshots. For phase 1 that
meant creating a project, drawing an area, running a real classification, seeing
the result open with its raster on the map, reopening the saved run, and crossing
to the studio and back.

Before reporting a step complete, run these in `frontend/`:

```bash
npx tsc --noEmit
npx vitest run
npm run -s check:contrast
npm run -s check:types
npm run -s check:version
npm run -s check:cursors
npm run -s check:icons
npm run build
```

Then run `wails build` from the repository root. Under `wails dev`, saving a Go file
rebuilds the application and ends a running job, and a frontend edit can reload the
page and drop the connection a direct run reports through, so leave the code alone
while a run is under test. If Go changed, these must pass
as well:

```bash
gofmt -l .            # must print nothing
go vet ./...
golangci-lint run ./...
go test -race ./...
```

## Verified, and not

Exercised end to end in the application, on an isolated store and real data:

- **Runs:** classification, composition, surface water, vegetation health, register
  overlap, radar and management zones, and each saved run opened from Analyses.
- **Reading:** the Result panel of each, Layers with the majority filter, A/B points,
  Compare with two classifications, including differences, domain shift and a cohort.
- **Areas:** renaming, deleting through the confirmation, and taking a municipality
  from IBGE.
- **Workflows:** a changed graph saved under a name and reopened with the change, from
  the start screen.
- **Project files:** a `.terra` saved and opened through the bindings, with its
  workflows. The native dialogs were not driven.

Not exercised:

- the native window: the screenshots come from headless Chrome, so the position of the
  traffic lights was only simulated;
- Windows and Linux;
- the mineral map, which needs an Earthdata token;
- field delineation, and so adopting fields, reading them and their nodes in a graph:
  the test environment has no PyTorch, and the panel reported that correctly;
- the land cover reading: MapBiomas answered HTTP 403 when it was tried, and the error
  was reported correctly;
- the research pack, PNG, GeoTIFF and GeoJSON exports, and a PDF report, which end in
  a native save dialog;
- a board saved by the studio, opened through the interface. Its format did not change
  and the store's tests read it.

## Known defects

- **A stray progress message.** `dataset = writer(` reaches the progress strip because
  `runner.go` passes the sidecar's stderr through.
- **MapBiomas answered HTTP 403** during these tests. A classification skips the
  agreement when it cannot read the reference, so a run then shows no Against MapBiomas
  section. Whether this is the service or the client was not determined.
- **Comments.** Code kept from the studio still explains itself in the studio's terms
  in places, as this repository's comments record why a thing is as it is.
