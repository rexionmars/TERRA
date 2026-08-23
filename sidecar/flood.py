"""
The flood envelope: how much of a HAND extent is terrain, and how much is the DEM.

The study this ports (E-hand-flood-baseline) measured its own reproducibility
and found the extent is not reproducible across DEM products: at the 1 m
threshold, IoU between its 30 m products ran 0.425 to 0.694, two DEMs
disagreeing about roughly a fifth of all cells. A HAND extent from a single
product moves with the choice of product. This module returns the extent
together with the envelope around it.

The central object is the agreement raster. For every cell it holds how many
products call that cell flooded at the reference threshold, 0 to N. Where the
count is 0 or N the terrain decided; anywhere between, the DEM decided. A
single mask with an accuracy figure beside it does not show where the products
disagree. Everything in the payload below summarises that raster, and `measure`
returns the raster itself.

The figures cover less ground than the chain ran over. HAND needs the
contributing area upstream of a cell, so dem.py reads 2 to 5 km beyond the AOI
and every stage of the terrain chain runs on that buffered window: the fill,
the flow directions, the accumulation and the HAND field. The report does not.
Every count, area, fraction and IoU below is taken over the cells inside the
AOI polygon, which the caller rasterises onto the shared grid and passes as
`aoi_mask`. Summarising the buffered window instead inflates every figure: on
one observed run a 277 by 291 window of 30.8 m cells put class areas summing to
76.2 km2 against an AOI of about 20 km2, about fourfold. The window stays in
the payload as provenance, under `grid`, `cell_size_m`, `buffer_m` and the
`aoi.window_*` pair.

This module does not fetch: sidecar/dem.py reads the products, buffers the
window and puts them on one grid. It does not compute the terrain chain:
sidecar/hand.py owns that, and is called once per product. The fill and the D8
dominate the cost at 4.3 microseconds per cell and the thresholds after them
are array comparisons, so sweeping five thresholds costs what one costs;
recomputing the chain per threshold would cost five times as much for identical
numbers.

Provenance. The study drew its four products from OpenTopography with an API
key. TERRA reads Planetary Computer without one, and that catalogue has no
SRTMGL1, so alos-dem takes its place. The envelope reported here is TERRA's own
measurement over TERRA's own DEM set, and the study's published range is not a
prediction of it. The payload `qualifier` carries that.
"""

import itertools
from dataclasses import dataclass

import numpy as np

import hand

# The study's sweep, unchanged, so a TERRA table can be laid beside the study's.
THRESHOLDS_M = (1.0, 2.0, 5.0, 10.0, 20.0)

# The threshold the agreement raster is built at. 1 m is where the study
# reports its widest disagreement between products; an envelope drawn at a
# higher threshold reports a narrower one.
REFERENCE_THRESHOLD_M = 1.0

# Contributing area above which a cell is drainage. The study's reference
# value, and the parameter it points out that flood work rarely reports. This
# payload holds it fixed and states it; it is not swept.
DRAINAGE_REF_KM2 = 0.5

# The ring cut from the INSIDE OF THE AOI for the inset statistics, in metres.
#
# This ring was once cut from the computed window, to discard the border of
# the rectangle the DEM was read over: there the contributing area of a cell is
# truncated by the window itself, fewer cells clear the drainage threshold,
# HAND comes out high and the extent small, so two products can disagree over a
# property of the rectangle. Since the report is taken over the AOI polygon,
# that rectangle border already falls outside every figure.
#
# The ring is now the AOI shrunk by this distance from its own boundary. The
# truncation it tests for has moved rather than disappeared: the buffer is 2 to
# 5 km, the contributing area of a lowland cell is unbounded in principle, and
# what drains in from beyond the buffer is missing first for the cells nearest
# the AOI boundary. `iou` over the AOI and `iou_inset` over the AOI minus this
# ring therefore answer the same question in the same direction, and a large
# gap between them puts the disagreement at the edge of the reported area. The
# study set the ring at 1 km and measured that it moved IoU by about 0.02,
# which is how it established that the disagreement it reports is not an edge
# artefact. The same 1 km is kept, but the two rings are cut from different
# shapes and the numbers are not the same statistic.
INSET_MARGIN_M = 1000.0

# The inset may not fall below this share of the shorter side of the AOI. On a
# small AOI a 1 km ring can consume the whole polygon, leaving a statistic
# computed over a handful of cells. When the cap binds, the payload reports the
# margin actually used.
INSET_MIN_FRACTION_OF_SIDE = 0.5


def iou(a, b):
    """
    Jaccard index between two binary masks, or None when both are empty.

    For binary masks this is numerically the Critical Success Index of the
    flood literature, TP / (TP + FP + FN), so the same column reads as CSI
    without conversion.

    The empty case returns None and not NaN: this payload crosses a pipe as
    JSON into Go and then into a browser, and NaN is not valid JSON. A NaN here
    would fail the run at the decoder, with an error naming the parser and not
    the empty mask.
    """
    inter = int(np.count_nonzero(a & b))
    union = int(np.count_nonzero(a | b))
    return float(inter / union) if union else None


def _erode_rows(mask, margin_cells):
    """True where the `margin_cells` cells above and below are also True."""
    height, width = mask.shape
    span = 2 * margin_cells + 1
    out = np.zeros_like(mask)
    if span > height:
        return out
    # A running count rather than a shift per cell of the margin. The default
    # margin is 33 cells at 30 m, and eroding a 4e6-cell window by comparing
    # 67 by 67 neighbourhoods cell by cell is 1.8e10 reads; two cumulative sums
    # are two passes over the array whatever the margin is.
    running = np.zeros((height + 1, width), dtype=np.int32)
    np.cumsum(mask, axis=0, dtype=np.int32, out=running[1:])
    covered = running[span:] - running[:height - span + 1]
    out[margin_cells:height - margin_cells] = covered == span
    return out


def inset_mask(mask, margin_cells):
    """
    `mask` shrunk by `margin_cells` on every side, and away from every hole.

    Square structuring element, so a cell survives when everything within
    `margin_cells` in either axis is inside the mask. Cells near the array
    border are dropped too: the polygon can run to the edge of the computed
    window, and a cell whose ring falls off the array has not been shown to be
    that far inside anything.
    """
    if margin_cells <= 0:
        return mask.copy()
    return _erode_rows(_erode_rows(mask, margin_cells).T, margin_cells).T


def bbox_shape(mask):
    """The height and width of the smallest rectangle holding every True cell."""
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return (0, 0)
    return (int(rows[-1] - rows[0]) + 1, int(cols[-1] - cols[0]) + 1)


def resolve_inset_margin(shape, dx, inset_margin_cells=None):
    """
    The inset ring in cells: INSET_MARGIN_M by default, capped for a small AOI.

    `shape` is the AOI's own bounding box, not the computed window: the ring is
    cut from the polygon, so a 1 km ring is measured against how much polygon
    there is to cut it from. Returns the value actually used, which is the
    value the payload reports beside `iou_inset`.
    """
    if inset_margin_cells is None:
        inset_margin_cells = int(round(INSET_MARGIN_M / dx))
    inset_margin_cells = max(0, int(inset_margin_cells))
    cap = int(min(shape) * (1.0 - INSET_MIN_FRACTION_OF_SIDE) / 2)
    return min(inset_margin_cells, cap)


def agreement_raster(masks):
    """
    How many products call each cell flooded. The product, in one array.

    Over the whole computed window, not the AOI: this is the raster the caller
    georeferences and writes, and clipping belongs where the file is written.
    The payload summarises it inside the AOI.

    uint8: the count cannot exceed the number of DEM products, and at 1e7 cells
    the difference against the int64 a plain sum would return is 10 MB against
    80 MB, on a path that already holds one HAND field per product.
    """
    masks = list(masks)
    if not masks:
        raise ValueError("the agreement raster needs at least one mask")
    total = np.zeros(masks[0].shape, dtype=np.uint8)
    for m in masks:
        total += m.astype(np.uint8)
    return total


# ------------------------------------------------------------------- the input


@dataclass
class Source:
    """One DEM product as `assess` needs it: an array plus what it came from."""

    id: str
    z: np.ndarray
    # None means the caller did not record the fact, not that the fact is
    # false. dem.ProductRead.describe() fills all three on the production path;
    # a bare array passed by a test or a script fills none of them, and a null
    # in the payload says exactly that.
    collection: object = None
    native_resolution_m: object = None
    resampled: object = None

    def describe(self):
        return {
            "id": self.id,
            "collection": self.collection,
            "native_resolution_m": self.native_resolution_m,
            "resampled": self.resampled,
        }


def _source(pid, value):
    """
    Accept either a bare elevation array or a dem.ProductRead.

    Duck-typed rather than imported. flood.py stays independent of dem.py on
    purpose: the two modules are edited together, and a module that imports its
    sibling to read four constants cannot be tested while the sibling is being
    written.
    """
    if isinstance(value, Source):
        return value
    describe = getattr(value, "describe", None)
    array = getattr(value, "array", None)
    if callable(describe) and array is not None:
        row = dict(describe())
        return Source(
            id=str(row.get("id", pid)),
            z=array,
            collection=row.get("collection"),
            native_resolution_m=row.get("native_resolution_m"),
            resampled=row.get("resampled"),
        )
    return Source(id=str(pid), z=value)


def _check(sources, dx, dy, thresholds, drainage_km2, grid, buffer_m, aoi_mask):
    """Refuse an input that would produce a plausible wrong envelope."""
    if len(sources) < 2:
        names = ", ".join(s.id for s in sources) or "none"
        raise ValueError(
            f"an envelope is a disagreement between DEM products and needs at "
            f"least two; got {len(sources)} ({names}). One product yields an "
            "extent with no measure of how much of it follows from the choice "
            "of product."
        )
    if dx <= 0 or dy <= 0:
        raise ValueError(f"cell size must be positive, got dx={dx} dy={dy}")
    if drainage_km2 <= 0:
        raise ValueError(f"drainage_km2 must be positive, got {drainage_km2}")
    if not thresholds:
        raise ValueError("no HAND threshold was given")
    ids = [s.id for s in sources]
    if len(set(ids)) != len(ids):
        # The id keys the HAND field, the mask and every pair row. A repeat
        # would silently drop one product's field and compare another against
        # itself, which reads as perfect agreement.
        raise ValueError(f"two DEM products carry the same id: {sorted(ids)}")

    shape = sources[0].z.shape
    for s in sources:
        if s.z.ndim != 2:
            raise ValueError(f"{s.id}: expected a 2-D elevation array, got {s.z.ndim}-D")
        if s.z.shape != shape:
            raise ValueError(
                f"{s.id}: shape {s.z.shape} does not match {sources[0].id} {shape}. "
                "The agreement raster counts products cell by cell, so every "
                "product must already be on one grid. dem.fetch_set reports "
                "each product on its own grid with a resampled flag; the "
                "caller is what moves them, with dem.resample_onto. "
                "dem.align_mask is for the other order -- chain first, align "
                "the finished mask -- and has no call site yet."
            )
        if not np.isfinite(s.z).all():
            n = int((~np.isfinite(s.z)).sum())
            raise ValueError(
                f"{s.id}: {n} cells are not finite. A void reaching the "
                "depression fill leaves the priority order undefined. The "
                "chain still returns a HAND field, and nothing in the output "
                "marks the region it is wrong over."
            )

    if grid is None:
        raise ValueError(
            "assess needs the geographic bounds of the shared grid: pass "
            "grid=dem.payload_grid(reference). They cannot be derived from the "
            "arrays, and a placeholder would put invented coordinates on a map."
        )
    if not hasattr(grid, "get"):
        raise ValueError(
            f"grid must be the payload block from dem.payload_grid(reference), "
            f"got a {type(grid).__name__}. The payload carries bounds in "
            "degrees; an affine transform does not."
        )
    if (int(grid.get("height", -1)), int(grid.get("width", -1))) != shape:
        raise ValueError(
            f"grid is {grid.get('width')}x{grid.get('height')} but the arrays "
            f"are {shape[1]}x{shape[0]}; the bounds describe a different window "
            "than the one measured."
        )
    if buffer_m is None:
        raise ValueError(
            "assess needs buffer_m, how far beyond the AOI the DEM was read. "
            "It bounds the drainage missing at the border and is required to "
            "read the inset statistic."
        )

    if aoi_mask is None:
        raise ValueError(
            "assess needs aoi_mask, the AOI polygon rasterised onto the shared "
            "grid. The arrays cover the AOI plus buffer_m on every side, and "
            "without the mask every area here would be the area of that "
            "buffered window: on one observed run 76.2 km2 of class areas for "
            "an AOI of about 20 km2. There is no default. A caller reporting "
            "over the whole computed window passes a mask of all True."
        )
    if aoi_mask.shape != shape:
        raise ValueError(
            f"aoi_mask is {aoi_mask.shape[1]}x{aoi_mask.shape[0]} but the "
            f"arrays are {shape[1]}x{shape[0]}; the mask was rasterised onto a "
            "different grid than the one measured, so it would select the "
            "wrong ground."
        )
    if not aoi_mask.any():
        raise ValueError(
            "aoi_mask selects no cell: the AOI polygon covers no cell centre "
            "of this grid, so there is nothing to report over. The AOI is "
            "smaller than one cell of the coarsest product. Zeros reported for "
            "it would read as dry terrain where no measurement was made."
        )


# ------------------------------------------------------------------ the result


@dataclass
class Result:
    """The payload, and the arrays it summarises."""

    payload: dict
    # The agreement raster at the reference threshold, 0..N per cell, over the
    # whole computed window. The payload cannot carry it: a 1e7-cell array as
    # JSON numbers is hundreds of megabytes through a pipe. A caller that
    # renders the map takes it from here and writes it as a file, the route the
    # meshes already take, and clips it to `aoi` for anything it draws, since
    # the payload figures are over `aoi`.
    agreement: np.ndarray
    # The reference-threshold extents over the computed window, before the AOI
    # mask. The payload counts them inside it.
    masks: dict
    hand: dict
    # The reporting mask, and the reporting mask minus the inset ring.
    aoi: np.ndarray
    inset: np.ndarray


def qualifier_text(ids):
    """
    The text that travels with any figure this module produces.

    It states two things a number from here cannot support on its own: that the
    envelope is the study's published range, and that a HAND threshold in
    metres is a flood depth.
    """
    listed = ", ".join(ids)
    return (
        f"These figures are TERRA's measurement over the products {listed} "
        "(Microsoft Planetary Computer). The published range for the study "
        "E-hand-flood-baseline used COP30, NASADEM, SRTMGL1 and COP90 from "
        "OpenTopography over a single area and does not apply to these "
        "figures. HAND is the height of a cell above the drainage cell "
        "it flows to. It is not a hydrodynamic model: rainfall, discharge, "
        "routing and channel geometry are not modelled. A threshold in metres "
        "ranks relative susceptibility; it is not a flood depth, extent or "
        "probability. Disagreement between products indicates cells where the "
        "result depends on the choice of DEM."
    )


def _assumptions(drainage_km2, min_cells, reference_threshold_m, thresholds,
                 margin, dx, dy, buffer_m, aoi_cells, inset_cells, window_cells,
                 cell_km2, inset_margin_cells=None):
    """Every default in the payload, where it came from, and what is left out."""
    # Each sentence states where its number came from, and says so differently
    # when the caller overrode the default, so that no value is credited to the
    # study that the study did not choose.
    drainage_source = (
        "the study's reference value"
        if drainage_km2 == DRAINAGE_REF_KM2
        else f"the caller's choice; the default is {DRAINAGE_REF_KM2} km2, "
             "the study's reference value"
    )
    reference_source = (
        "The study reports its widest disagreement between products at 1 m."
        if reference_threshold_m == REFERENCE_THRESHOLD_M
        else f"The caller set this value; the default is "
             f"{REFERENCE_THRESHOLD_M} m, where the study reports its widest "
             "disagreement between products."
    )
    # WHOSE RING WAS CAPPED. This read the module's own INSET_MARGIN_M whether
    # or not the caller had chosen a width, so a caller-supplied ring that hit
    # the cap was reported as "the default 1000 m ring" being capped -- a
    # provenance that did not happen, and the exact thing the comment above says
    # this function exists to avoid. It now branches the same way drainage and
    # the reference threshold do.
    if inset_margin_cells is None:
        requested_margin = int(round(INSET_MARGIN_M / dx))
        requested_source = f"The default {INSET_MARGIN_M:.0f} m ring is "
    else:
        requested_margin = max(0, int(inset_margin_cells))
        requested_source = "The ring the caller asked for is "
    margin_note = (
        ""
        if margin >= requested_margin
        else (f" {requested_source}"
              f"{requested_margin} cells on this grid and was capped at "
              f"{margin}, which leaves at least half the shorter side of the "
              "AOI bounding box inside the inset.")
    )
    return {
        "drainage_threshold": (
            f"A cell is drainage when at least {drainage_km2} km2 drains "
            f"through it, which is {min_cells} cells at this cell size. This is "
            f"{drainage_source}. The extent moves with this value, which is "
            "held fixed here; its contribution to the reported "
            "disagreement is unmeasured."
        ),
        "reference_threshold": (
            f"The agreement raster is built at HAND <= {reference_threshold_m} m. "
            + reference_source
        ),
        "thresholds": (
            f"Thresholds swept: {list(thresholds)} m. These are the values "
            "the study reports."
        ),
        "reporting_extent": (
            f"Every count, area, fraction and IoU here is taken over the "
            f"{aoi_cells} cells inside the AOI polygon, "
            f"{aoi_cells * cell_km2:.4g} km2. The terrain chain ran over "
            f"{window_cells} cells, {window_cells * cell_km2:.4g} km2, since "
            "HAND requires the contributing area upstream of the AOI. That "
            "window is reported under grid and buffer_m as provenance; no "
            "figure here is measured over it. A cell is counted when its "
            "centre falls inside the polygon, so the reported area differs "
            "from the polygon's own area by at most half a cell along the "
            "boundary."
        ),
        "inset_margin": (
            f"The inset statistics repeat every comparison over the AOI shrunk "
            f"by {margin} cells, about {margin * dx:.0f} m, measured from the "
            f"AOI boundary and covering {inset_cells} cells. The ring is cut "
            "from the AOI polygon. Near the AOI boundary the contributing area "
            "does not include drainage from beyond the buffer, so HAND reads "
            "high and the extent small. A large gap between iou "
            "and iou_inset indicates that the disagreement is concentrated "
            "near that boundary." + margin_note
        ),
        "cell_size": (
            f"Cells are {dx:.1f} by {dy:.1f} m, evaluated at the centre latitude "
            "of the window (hand.pixel_size_m). Areas in this payload are cell "
            "counts multiplied by that cell area; no projected-area "
            "calculation is applied."
        ),
        "alignment": (
            "All products are on one grid. A product whose native grid "
            "differs was aligned by nearest neighbour and is marked resampled "
            "in its row. Its disagreement with the others carries an alignment "
            "component in addition to the terrain difference. A null in that "
            "column means the caller did not report whether the product was "
            "resampled."
        ),
        "buffer": (
            f"The DEM was read {buffer_m:.0f} m beyond the AOI, so the drainage "
            "entering the AOI is measured terrain. Drainage arriving from "
            "beyond that buffer is absent, which biases HAND high and the "
            "extent low near the AOI edge. The chain ran over the buffered "
            "window; the figures are taken over the AOI."
        ),
        "excluded": [
            "No rainfall, discharge, routing or hydrodynamic simulation.",
            "No observed flood: nothing here is compared against a satellite "
            "or gauge record of an event.",
            "No channel bathymetry, levees, dams or drainage infrastructure. "
            "The measured surface is the DEM surface, which over open water is "
            "the water surface at acquisition and, for products that are not "
            "bare earth, includes buildings and canopy.",
            "No vertical datum harmonisation between products. HAND is a height "
            "difference within one product, so a constant offset between "
            "products cancels. A spatially varying offset does not cancel and "
            "appears here as terrain disagreement.",
            "No uncertainty from the drainage threshold, which is held fixed.",
            "No temporal dimension: the products were acquired years apart and "
            "the terrain is treated as unchanged between them.",
        ],
    }


# ---------------------------------------------------------------- the envelope


def measure(dems, dx, dy, thresholds_m=THRESHOLDS_M, drainage_km2=DRAINAGE_REF_KM2,
            reference_threshold_m=REFERENCE_THRESHOLD_M, inset_margin_cells=None,
            grid=None, buffer_m=None, aoi_mask=None, eps=1e-3, progress=None):
    """
    The envelope over several DEM products. Returns a Result: payload + arrays.

    `dems` is an ordered mapping of product id to either an elevation array
    already on the shared grid or a dem.ProductRead. The order is kept: the
    `products` rows follow it and the pair rows are generated in it, so the
    same run reproduces the same table row for row.

    `aoi_mask` is the AOI polygon rasterised onto that same grid and is
    required: the arrays cover the AOI plus its buffer, and it is the mask that
    decides which of those cells the figures are about.
    """
    sources = [_source(pid, value) for pid, value in dems.items()]

    # The reference threshold joins the sweep even if the caller left it out.
    # Without it the payload would show an agreement raster built at a
    # threshold with no row in `envelope`, and no measure of its spread.
    thresholds = sorted({float(t) for t in thresholds_m} | {float(reference_threshold_m)})
    reference_threshold_m = float(reference_threshold_m)

    _check(sources, dx, dy, thresholds, drainage_km2, grid, buffer_m, aoi_mask)

    shape = sources[0].z.shape
    aoi = np.asarray(aoi_mask, dtype=bool)
    aoi_cells = int(aoi.sum())
    margin = resolve_inset_margin(bbox_shape(aoi), dx, inset_margin_cells)
    inset = inset_mask(aoi, margin)
    inset_cells = int(inset.sum())

    # The HAND field once per product, then thresholded five times. Held as
    # float32: the comparison is against a threshold in whole metres and the
    # float32 spacing at 1000 m of relief is 6e-5 m. It is not safe inside the
    # chain, where hand.fill_depressions separates a plateau by 1e-3 m and
    # float32 rounds that away at such an elevation. hand.compute allocates its
    # own float64 arrays, so the narrowing happens strictly after it.
    #
    # The chain runs on the full window, buffer included. Narrowing it to the
    # AOI here would be the same defect as reporting over the window, in the
    # other direction: the drainage entering the AOI would stop at its border
    # and every cell fed from outside would get a wrong height.
    fields, cell_km2, min_cells = {}, None, None
    for n, s in enumerate(sources, start=1):
        if progress:
            progress(f"{s.id}: HAND chain ({n} of {len(sources)})")
        chain = hand.compute(s.z, dx, dy, drainage_km2=drainage_km2, eps=eps)
        fields[s.id] = chain["hand"].astype(np.float32)
        cell_km2, min_cells = chain["cell_km2"], chain["min_cells"]

    pairs, envelope, products = [], [], []
    reference_masks = {}

    for t in thresholds:
        if progress:
            progress(f"comparing {len(sources)} products at HAND <= {t:g} m")
        masks = {s.id: (fields[s.id] <= t) for s in sources}
        # Every comparison below is between the reported extents, never the
        # window ones: a product that floods half the buffer and none of the
        # AOI has no extent to disagree about here.
        reported = {s.id: masks[s.id] & aoi for s in sources}

        at_threshold = []
        for a, b in itertools.combinations(sources, 2):
            ma, mb = reported[a.id], reported[b.id]
            n_a = int(ma.sum())
            row = {
                "dem_a": a.id,
                "dem_b": b.id,
                "threshold_m": t,
                "iou": _round(iou(ma, mb), 4),
                "iou_inset": _round(iou(masks[a.id] & inset, masks[b.id] & inset), 4),
                # None rather than a ratio against an empty denominator: a
                # product with no wet cell at this threshold is a fact about the
                # threshold, and dividing by one cell would report it as 1.0.
                "area_ratio_b_over_a": (
                    _round(float(mb.sum()) / n_a, 4) if n_a else None
                ),
                "resampled": _either_resampled(a, b),
            }
            pairs.append(row)
            at_threshold.append(row)

        envelope.append({
            "threshold_m": t,
            "iou_min": _extreme(at_threshold, "iou", min),
            "iou_max": _extreme(at_threshold, "iou", max),
            "iou_min_inset": _extreme(at_threshold, "iou_inset", min),
            "iou_max_inset": _extreme(at_threshold, "iou_inset", max),
        })

        if t == reference_threshold_m:
            reference_masks = masks
            for s in sources:
                cells = int(reported[s.id].sum())
                row = s.describe()
                row.update({
                    "cells": cells,
                    "area_km2": _round(cells * cell_km2, 4),
                    # Of the AOI, which is what the reader drew. Of the window
                    # this would be the same extent divided by up to four times
                    # the ground, and would read as a much drier place.
                    "area_frac": _round(cells / aoi_cells, 6),
                })
                products.append(row)

    counts_raster = agreement_raster([reference_masks[s.id] for s in sources])
    n_products = len(sources)
    counts = np.bincount(counts_raster[aoi], minlength=n_products + 1)
    unanimous_wet = int(counts[n_products])
    unanimous_dry = int(counts[0])
    contested = int(counts[1:n_products].sum())
    wet_total = contested + unanimous_wet

    payload = {
        "reference_threshold_m": reference_threshold_m,
        "thresholds_m": list(thresholds),
        "drainage_km2": float(drainage_km2),
        "cell_size_m": {"x": float(dx), "y": float(dy)},
        "grid": grid,
        "buffer_m": float(buffer_m),
        # What the figures are over, beside what the chain ran over. Both are
        # here because either one alone misleads: the AOI area alone hides that
        # the terrain was solved on more ground, and the window alone is the
        # defect this block was added to fix.
        "aoi": {
            "cells": aoi_cells,
            "area_km2": _round(aoi_cells * cell_km2, 4),
            "inset_cells": inset_cells,
            "window_cells": int(counts_raster.size),
            "window_area_km2": _round(counts_raster.size * cell_km2, 4),
            "frac_of_window": _round(aoi_cells / counts_raster.size, 6),
        },
        "products": products,
        "agreement": {
            # counts[k] is the number of AOI cells exactly k products call
            # flooded. counts[0] closes the accounting and is not a level of
            # agreement: a cell no product calls flooded carries no measure of
            # agreement between the products. It is reported as the dry
            # remainder of the AOI, in unanimous_dry_km2.
            "counts": [int(c) for c in counts],
            "unanimous_wet_km2": _round(unanimous_wet * cell_km2, 4),
            "contested_km2": _round(contested * cell_km2, 4),
            "unanimous_dry_km2": _round(unanimous_dry * cell_km2, 4),
            # The share of the wet extent the DEM decides, the rest being the
            # share the terrain decides. None when no product calls anything
            # wet: there is no extent to take a share of, and 0.0 would read as
            # agreement.
            "contested_frac_of_wet": (
                _round(contested / wet_total, 4) if wet_total else None
            ),
        },
        "pairs": pairs,
        "envelope": envelope,
        "inset_margin_cells": int(margin),
        "qualifier": qualifier_text([s.id for s in sources]),
        "assumptions": _assumptions(drainage_km2, min_cells, reference_threshold_m,
                                    thresholds, margin, dx, dy, buffer_m,
                                    aoi_cells, inset_cells, counts_raster.size,
                                    cell_km2, inset_margin_cells),
    }

    return Result(payload=payload, agreement=counts_raster, masks=reference_masks,
                  hand=fields, aoi=aoi, inset=inset)


def assess(dems, dx, dy, thresholds_m=THRESHOLDS_M, drainage_km2=DRAINAGE_REF_KM2,
           reference_threshold_m=REFERENCE_THRESHOLD_M, inset_margin_cells=None,
           grid=None, buffer_m=None, aoi_mask=None, eps=1e-3, progress=None):
    """The payload alone. `measure` returns the same run with its arrays."""
    return measure(dems, dx, dy, thresholds_m=thresholds_m,
                   drainage_km2=drainage_km2,
                   reference_threshold_m=reference_threshold_m,
                   inset_margin_cells=inset_margin_cells, grid=grid,
                   buffer_m=buffer_m, aoi_mask=aoi_mask, eps=eps,
                   progress=progress).payload


def _round(value, places):
    return None if value is None else round(float(value), places)


def _either_resampled(a, b):
    """
    Whether the pair crossed a resampling. None when either side is unrecorded.

    A pair is free of alignment error only if both products are known to be
    native on the shared grid, so an unknown on either side leaves the pair
    unknown.
    """
    if a.resampled is None or b.resampled is None:
        return None
    return bool(a.resampled) or bool(b.resampled)


def _extreme(rows, key, pick):
    """min or max over the pair rows at one threshold, skipping the undefined."""
    values = [r[key] for r in rows if r[key] is not None]
    return pick(values) if values else None
