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
way of failing. Six of them exist today — Map, Energy, Flood, Analysis, Profile,
Auth — and four are from that period.

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

That is what the studio is. Fourteen editors exist —

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

## Where the map stands now

It is the earlier stage, still underneath.

The studio's run panel carries the acquisition window, the cloud limit, the
model, and the index for compositions and for water — the parameters that used
to be the map's. Its globe draws areas through the same `useAreaDrawing` the
map uses. Which surface a session opens on is a stored preference with two
values, `explorer` and `studio`.

Two things record the transition rather than the destination:

- Opening on the studio is implemented as mounting the map and immediately
  covering it — `setOpenBoardNonce` in `App.tsx`. The map is built for a reader
  who asked for the studio.
- The run band's `blockedBy` still says *"Draw an area on the map first"* and
  *"Choose a scene under Compositions on the map"*, for two things the run panel
  itself now offers.

Neither is an argument for keeping the map, and neither is an argument for
removing it tomorrow. What decides that is a list — every control the map
offers, checked against whether the studio offers it — and that list has not
been made. It is worth making before the question is settled by opinion, which
is how it has been discussed so far.

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — the technical layout this sits on
- [DESIGN.md](DESIGN.md) — the visual system the panels are painted in
- [USER_GUIDE.md](USER_GUIDE.md) — the workflow as an operator meets it
