# Why the interface is panels

TERRA is not a map application that grew analyses. It is an analysis
application that stopped trying to be a map, and the interface is where that
decision is visible.

The implementation is the source of truth. This file describes it; where the
two disagree, the code is right and this file is stale.

| What | Where |
| --- | --- |
| The panels a board can hold | [`frontend/src/lib/studioEditors.ts`](../frontend/src/lib/studioEditors.ts) |
| The arrangements that ship | [`frontend/src/lib/studioWorkspaces.ts`](../frontend/src/lib/studioWorkspaces.ts) |
| How a board is split and rearranged | [`frontend/src/components/studio/StudioAreaTree.tsx`](../frontend/src/components/studio/StudioAreaTree.tsx) |
| Which surface a session opens on | [`frontend/src/lib/preferenceExtras.ts`](../frontend/src/lib/preferenceExtras.ts) |

## The problem this shape solves

The products worth building here are the ones nobody else offers: a canopy
grown from what the satellite measured, and a diagnosis of the distance between
two runs. Drawing a polygon on a basemap and reading a class share is not one of
them — QGIS and Earth Engine do that, they do it well, and they are free.

The audience is a scientific one, and what it will pay attention to is the
analysis it cannot get elsewhere. That is the whole of the product thesis, and
every interface decision below follows from it.

## What was tried first, and where it stopped

Earlier versions worked the map. Each product that arrived brought a screen with
it, and each screen brought navigation, its own state, its own chrome and its own
way of failing. Six exist today — Studio, Energy, Flood, Analysis, Profile and
the sign-in — and Energy, Flood and Analysis are from that period. The sixth was
the map, and the section below says where it went: it did not leave the count,
it became the studio.

The cost was not the screens. It was that a screen is a fixed answer to "what do
you want to see", and the questions this application exists to ask do not have
fixed answers. Comparing two runs, reading a spectral response against a
classification, watching a stand grow beside the NDVI series it was grown from:
each wants a different set of things on screen at once, and a screen per
combination does not converge.

## Where the shape came from

Software that puts dense, heterogeneous data on one screen solved this decades
ago, and did not solve it with screens. Blender, Unreal and the engines beside
them organise by **panel**: the window is divided into regions, each region
shows one editor, and the reader puts on screen what the question needs right
now. Adding a capability adds an editor, not a mode.

That is what the studio is, and the resemblance is structural rather than
inspirational: the board subdivides, panels do not float, and an arrangement is
a saved tree of splits. Fourteen editors exist —

> Viewport · Outliner · Properties · Comparison · Domain shift ·
> Spectral response · Class separability · Library check · Rover ·
> Data table · Run · Canopy · Canopy run · Globe

— and five arrangements ship ready: Layout, Compare, Diagnose, Data and
Simulation. The arrangement is the reader's; the arrangements that ship are
starting points, not modes.

## What this does and does not buy

It does not buy less code. `components/studio` is about 22,000 lines against
about 4,600 for the map screen and its components. What it buys is a different
curve: the marginal cost of the fifteenth analysis is an editor, where under the
previous shape it was a screen with everything a screen carries.

And it buys arrangements the author never has to enumerate. Fourteen editors in
a splittable tree is not fourteen answers; a screen per combination is.

## Why the differentiator cannot live on a map

A map puts things where they are. That is what a map is for, and it is why the
map is the right surface for drawing an area, placing it, and checking it
against the ground.

It is also why the analyses this application exists for cannot be read on one.
Domain shift is the distance between two runs, and two runs over fields hundreds
of kilometres apart cannot be set beside each other on a surface whose whole job
is to keep them where they are. The viewport lifts rasters off their
coordinates, which is exactly what a map must never do.

The answer to "but where on the ground is this" is the globe editor beside the
viewport: a plane can be sent to it and drawn over the ground it measures. Two
panels, two questions, side by side — rather than one surface asked to answer
both and failing at one of them.

## The map screen is gone

It was the earlier stage, kept alive underneath, and the survey that was meant
to decide its fate found no capability it held alone.

The run band carries the acquisition window, the cloud limit, the model and the
composition and water indices. The globe draws areas through the same
`useAreaDrawing`, reaches a place by name and lifts the terrain. Comparison is
arrangement over any number of rasters rather than a swipe between two. The
map's dock panels governed what the band already governed.

Two things had marked the transition rather than the destination, and both are
answered by removing it: opening on the studio used to mean mounting the map
and immediately covering it, and the run band told the reader to go "to the map"
for two things the band itself offers.

WHAT STAYED. `MapSurface` is mounted by the Energy and Flood screens, so this
removed a screen and not the map component. The DEM panel inside it is ungated
and is still on both of those. `scalarTiles` — a raster served as terrain tiles
so its palette is a paint expression, recoloured without re-running the analysis
— is passed only from `MapSurface`, and the globe does not ask for it. That
capability is reachable, since the globe calls the same `syncOverlays`, and has
not been carried over.

WHAT IT COST AND BOUGHT. Two decisions were not deletions. `onClose` is called
when a WebGL context cannot be created; it used to close onto the map, and now
takes a destination that needs no GL. Escape stopped closing the studio, because
dismissing an overlay is not the same gesture as leaving the screen you work in.

Measured on one base commit, the entry chunk fell from 1,801 kB to 609 kB. The
reason is not the deleted lines: nothing the shell imports statically reaches
MapLibre any more, so it arrives with the globe editor instead of with the
application.

## How this is practised elsewhere

The shape was not invented here, and the tools that use it have written down why.

### Blender: subdivision, and three rules

Blender states three paradigms for its interface, and the studio follows all
three without having set out to.

**Non-overlapping.** Editors sit side by side rather than in floating windows,
so one never covers another and the reader does not spend time moving things out
of the way. **Non-blocking.** Tools do not stop the rest of the application while
they are open. **Non-modal.** You say what you are working on, then what to do
with it, rather than entering a tool mode first.

An **area** is the container, an **editor** is what fills it, and a **workspace**
is a saved arrangement of both, aimed at one task. Eleven ship: Layout,
Modeling, Sculpting, UV Editing, Texture Paint, Shading, Animation, Rendering,
Compositing, Geometry Nodes and Scripting. Blender opens on Layout.

The mapping to this repository is close enough to be worth naming: `splitArea`,
`joinArea`, `retypeArea` and `moveSplit` in `lib/boardAreas.ts` are the
subdivision; `studioEditors.ts` is the editor registry; `studioWorkspaces.ts`
holds five arrangements where Blender holds eleven, named the same way, after
the task rather than after the panels.

Blender's guidelines also carry a warning this repository has to heed: editors
behave almost like separate applications, so they must share one set of patterns
or the reader pays a learning cost at every boundary. That is the argument for
the outliner and the plane menu speaking one vocabulary rather than each
inventing its own.

### Unreal: docking, and layout as state

Unreal takes the same decomposition and a different arrangement model. Panels
are **dockable**: dragged, floated, tabbed together, snapped with a drop
preview. `TabManager` owns the layout, which persists between sessions, and
`Window → Load Layout → Default Editor Layout` returns everything home.

TERRA is Blender's model, not this one — the board subdivides and nothing
floats. Two things carry over anyway: the arrangement is state that survives a
restart, and there is a way back to what ships. The second matters more than it
sounds. An interface the reader can take apart needs a way to undo that without
undoing their work.

### It is already the pattern in scientific software

This is not only a game-engine habit. napari, the multidimensional image viewer
used across bioimaging, is built from dockable Qt widgets: the layer list, the
layer controls and the console are all dock widgets, and a plugin adds analysis
by adding one. QGIS — the application TERRA deliberately does not try to replace
— carries its own panels the same way.

So the audience TERRA is written for already works in interfaces of this shape.
That is worth knowing: the shape is not being introduced to them.

### What it costs

The cost is documented as clearly as the benefit, and it is real. A dense
panelled interface has a steeper first climb: Unreal's is regularly described as
overwhelming on first launch, and its Details panel is where new users report
getting lost. The problem is discoverability — a capability that is a panel you
have not opened is a capability you do not know exists.

Two things reduce it here and neither removes it. The audience is a research one
already working in napari, QGIS and their like. And the five arrangements are the
answer Blender gives to the same problem: a reader who does not yet know what to
put on screen is handed a board that already answers a named question.

### Sources

- [Blender — Design Paradigms](https://developer.blender.org/docs/features/interface/human_interface_guidelines/paradigms/)
- [Blender — Human Interface Guidelines](https://developer.blender.org/docs/features/interface/human_interface_guidelines/)
- [Blender — Workspaces (manual)](https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html)
- [Blender — Anatomy of an Editor](https://wiki.blender.org/wiki/Human_Interface_Guidelines/Anatomy_of_an_Editor)
- [Blender 2.8 design document](https://code.blender.org/2017/10/blender-2-8-design-document/)
- [Unreal Engine — Layout Customization](https://dev.epicgames.com/documentation/en-us/unreal-engine/layout-customization)
- [napari](https://napari.org/) · [napari on ImageJ.net](https://imagej.net/software/napari)

The Blender pages above are paraphrased rather than quoted: they answered a
search but refused a direct fetch, so the wording here is a summary and the
links are where the exact phrasing lives.

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — the technical layout this sits on
- [DESIGN.md](DESIGN.md) — the visual system the panels are painted in
- [USER_GUIDE.md](USER_GUIDE.md) — the workflow as an operator meets it
