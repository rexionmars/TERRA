# Why the interface is a map

TERRA's interface is a full-screen map with one panel held up in front of it. It
used to be a board split into editors, and this file used to argue for that. What
changed, and what was kept from the argument, is recorded here.

The implementation is the source of truth. This file describes it; where the two
disagree, the code is right and this file is stale.

| What | Where |
| --- | --- |
| The surface and everything it holds | [`frontend/src/pages/MapShell.tsx`](../frontend/src/pages/MapShell.tsx) |
| Navigation rail and the path at the top right | [`frontend/src/components/shell/ShellChrome.tsx`](../frontend/src/components/shell/ShellChrome.tsx) |
| The frame around the map, and its corner pieces | [`frontend/src/components/shell/ShellCorners.tsx`](../frontend/src/components/shell/ShellCorners.tsx), the geometry in [`frontend/src/lib/frameCorners.ts`](../frontend/src/lib/frameCorners.ts) |
| The panels | [`frontend/src/components/shell/`](../frontend/src/components/shell/) |
| Compare | [`frontend/src/components/shell/CompareScreen.tsx`](../frontend/src/components/shell/CompareScreen.tsx) |
| Workflows | [`frontend/src/components/shell/WorkflowsScreen.tsx`](../frontend/src/components/shell/WorkflowsScreen.tsx) |
| Models | [`frontend/src/components/shell/ModelsScreen.tsx`](../frontend/src/components/shell/ModelsScreen.tsx); the catalogue and its downloads in [`frontend/src/lib/modelCatalog.ts`](../frontend/src/lib/modelCatalog.ts), the installed packages in [`frontend/src/lib/installedModels.ts`](../frontend/src/lib/installedModels.ts) |
| Readings the destinations share | [`frontend/src/components/workspace/`](../frontend/src/components/workspace/) |

## The shape

| Place | What it is for |
| --- | --- |
| **Explore** | The map. Products, Compositions, Result, Points and Layers are tools on its right edge, and each opens a panel over it. The Areas panel, the areas of the project and their fields, with drawing, import and the IBGE catalogue, opens from **Manage areas…** in the area's menu at the top right |
| **Analyses** | Every saved run, filed under its project |
| **Compare** | Runs as nodes on a board, and readings linked to any of them, as many as wanted |
| **Workflows** | The compositor, full screen |
| **Models** | The trained land-cover models, as cards, with a page for each: what it reads, how it works, how it was evaluated, and a button that runs it through Classification |
| **Activity** | What the application has said, kept after each notification leaves |

**One panel at a time.** The shell holds a single value saying which is open, so
opening one closes the last rather than stacking or dividing the window. The map
stays the ground, and the camera keeps what it frames clear of the panel.

## Why the board went

The board's argument was that a screen is a fixed answer to "what do you want to
see", and that a splittable tree of editors never has to enumerate the answers.
The argument was sound about the arrangements and silent about what they cost:

- A capability that is an editor you have not opened is one you do not know
  exists, and seventeen editors in seven workspaces is a lot to not know about.
- Most of the time the work is on the map: an area, a period, a run, a result on
  the ground. The board covered the map to do that.
- A reader arranged the screen before reading anything on it.

The map answers those. What it cannot answer is the next section.

## What a map still cannot do

A map puts things where they are. Two runs over fields hundreds of kilometres apart
cannot be set side by side on a surface whose whole job is to keep them where they
are. That part of the old argument stands, and it is why **Compare is a screen and
not a panel**.

The old board answered it by lifting rasters off their coordinates into a 3D scene,
with a camera and planes to drag. Compare keeps what the comparison used and drops
the rest: each run is a node on a flat board, drawn to its own scale, so **each run
states how much ground it spans**: two squares of one size are not two fields of one
size.

The analyses that are about the distance between runs are nodes on that board too:
agreement and class transitions, domain shift between two runs and across a cohort,
spectra, separability, a spectral library and the runs' tables. Each is added from
**Add** and fed by links from the runs, as a node of the Workflows compositor is,
so one board holds as many comparisons as the reader adds. A fixed grid with one
pair marked A and B stood here first, and it made a second comparison cost the
first. The node selected is read in full in the panel beside the board, where the
readings have the width they were drawn for.

## What was given up

These went with the board, on purpose:

- The 3D viewport, and dragging planes and areas in it.
- Splitting, joining and retyping areas, and the seven workspaces.
- Reordering, renaming and hiding planes in an outliner. Layers has one row per
  raster with its switch, opacity and exports, in a fixed stack.
- Undo and redo, which only ever covered the board's edits and never the graph.
- The Console. F3 finds and runs every operator by name.
- The rover's live sweep. **Points** places A and B on the map and reads the class
  under each.
- Several runs' rasters over their ground at once, except through a Globe node in
  a workflow.

## Saved work

A saved board is stored as a `studio`, in the database and in a `.terra` file, and
that did not change: files written before this interface still open. In the
interface it is a **workflow**: a name, a graph and the runs it reads. Opening one
with a graph lands on Workflows; one saved with no graph was arranging rasters, so
it lands on Compare with its runs on the board. What a board recorded about its
arrangement is carried through a save and not otherwise used.

## Related docs

- [INTERFACE_CONVERSION.md](INTERFACE_CONVERSION.md) — how the conversion was done
- [ARCHITECTURE.md](ARCHITECTURE.md) — the technical layout this sits on
- [DESIGN.md](DESIGN.md) — the visual system
- [USER_GUIDE.md](USER_GUIDE.md) — the workflow as an operator meets it
