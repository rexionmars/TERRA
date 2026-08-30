"""
The flood envelope on terrain whose answer is known before the code runs.

Every case here is analytic: a V-shaped valley where HAND equals the distance
to the thalweg in metres, so the extent at a threshold is a set of columns that
can be written down. That is what makes a disagreement between two of them
locatable -- the test does not ask whether the products disagree by some
amount, it asks whether the contested cells are the exact columns the geometry
puts there. A statistical check would pass on an envelope computed the wrong
way round.

The drainage threshold is 0.02 km2 in most cases rather than the 0.5 km2 the
payload defaults to. On a 40 by 41 window of 30 m cells, 0.5 km2 is 556 cells
of contributing area and nothing in the window reaches it, so the default would
leave no drainage network and HAND would be measured against the outlet.
"""

import json

import numpy as np
import pytest

from terra.flood import envelope as flood
from terra.terrain import hand

DX = DY = 30.0
DRAINAGE_KM2 = 0.02


def valley(height, width, centre, cross_slope, along_slope=0.01):
    """
    A V-shaped valley: HAND is `cross_slope` metres per column off the centre.

    The along-valley tilt exists only to give the thalweg a direction to drain
    in; at 1 cm per row it is two orders below the cross slope and does not
    move the extent.
    """
    across = np.abs(np.arange(width) - centre).astype(float) * cross_slope
    along = np.arange(height, 0, -1, dtype=float) * along_slope
    return 100.0 + across[None, :] + along[:, None]


def grid_for(z, lon_min=-47.0, lat_min=-15.0):
    """The payload `grid` block for a synthetic window of DX by DY cells."""
    height, width = z.shape
    return {
        "width": width,
        "height": height,
        "bounds": {
            "lon_min": lon_min,
            "lat_min": lat_min,
            "lon_max": lon_min + width * DX / 111_320.0,
            "lat_max": lat_min + height * DY / 110_540.0,
        },
    }


def run(dems, **kwargs):
    """
    measure() with the small-window drainage threshold and a real grid.

    aoi_mask defaults to the whole window here, which says these synthetic
    cases have no buffer: the array IS the AOI. On the production path it is
    the polygon rasterised onto the grid and covers a fraction of the array,
    and the cases below that pass their own mask are the ones that check what
    that changes.
    """
    first = next(iter(dems.values()))
    z = getattr(first, "array", first)
    kwargs.setdefault("drainage_km2", DRAINAGE_KM2)
    kwargs.setdefault("inset_margin_cells", 4)
    kwargs.setdefault("grid", grid_for(z))
    kwargs.setdefault("buffer_m", 2000.0)
    kwargs.setdefault("aoi_mask", np.ones(z.shape, dtype=bool))
    return flood.measure(dems, DX, DY, **kwargs)


class Read:
    """A stand-in for dem.ProductRead: what the production caller passes."""

    def __init__(self, array, id, collection, native_resolution_m, resampled):
        self.array = array
        self._row = {
            "id": id,
            "collection": collection,
            "native_resolution_m": native_resolution_m,
            "resampled": resampled,
        }

    def describe(self):
        return dict(self._row)


def test_identical_dems_agree_on_every_cell():
    """
    Two copies of one terrain: IoU 1.0, and no cell is contested.

    The floor case. An envelope that reports disagreement between a DEM and
    itself is measuring its own code path, and every other number here would
    inherit that.
    """
    z = valley(40, 41, 20, 1.0)

    result = run({"a": z, "b": z.copy()})
    payload = result.payload

    assert [row["iou"] for row in payload["pairs"]] == [1.0] * len(payload["thresholds_m"])
    assert payload["agreement"]["contested_km2"] == 0.0
    assert payload["agreement"]["contested_frac_of_wet"] == 0.0
    # The raster carries the claim the summary only counts: every cell is
    # called flooded by both products or by neither.
    assert set(np.unique(result.agreement)) <= {0, 2}


def test_a_constant_vertical_offset_does_not_move_the_extent():
    """
    HAND is a height above a reference inside the same DEM, so a datum shift
    cancels.

    This is the property that lets four products acquired against different
    vertical datums be compared at all, and the payload states it under
    assumptions. A HAND implementation that referenced sea level instead of the
    drainage cell would still produce a plausible map and would fail here.
    """
    z = valley(40, 41, 20, 1.0)

    result = run({"native": z, "offset": z + 137.0})

    assert [row["iou"] for row in result.payload["pairs"]] == [1.0] * 5
    assert set(np.unique(result.agreement)) <= {0, 2}


def test_two_terrains_disagree_in_the_band_the_geometry_puts_there():
    """
    A 1 m/column valley against a 0.5 m/column valley, both centred on 20.

    At HAND <= 1 m the first is wet on columns 19 to 21 and the second on 18 to
    22, so the terrain decides three columns and the choice of DEM decides two.
    The test locates them rather than counting them: a contested area of the
    right size in the wrong place would be a different failure with the same
    total.
    """
    steep = valley(40, 41, 20, 1.0)
    shallow = valley(40, 41, 20, 0.5)

    result = run({"steep": steep, "shallow": shallow})

    contested_columns = np.unique(np.nonzero(result.agreement == 1)[1])
    unanimous_columns = np.unique(np.nonzero(result.agreement == 2)[1])
    assert list(contested_columns) == [18, 22]
    assert list(unanimous_columns) == [19, 20, 21]

    # 120 unanimous cells against 200 in the wider mask: IoU 0.6, and two of
    # every five wet cells are the DEM's choice rather than the terrain's.
    assert result.payload["envelope"][0]["iou_min"] == 0.6
    assert result.payload["agreement"]["contested_frac_of_wet"] == 0.4


def test_the_agreement_counts_account_for_every_cell():
    """
    counts has one entry per possible level and sums to the window.

    Indexing is the contract: counts[k] is the number of cells that exactly k
    products call flooded. A summary that drops the zero level, or that counts
    a cell at two levels, breaks the reading of the raster the payload asks the
    reader to make.
    """
    z = valley(40, 41, 20, 1.0)
    dems = {"a": z, "b": valley(40, 41, 20, 0.5), "c": valley(40, 41, 21, 1.0)}

    payload = run(dems).payload
    counts = payload["agreement"]["counts"]

    assert len(counts) == len(dems) + 1
    # Every reported cell at exactly one level, and here the whole window is
    # reported because this case gives measure() a mask of the whole window.
    assert sum(counts) == z.size
    assert counts[len(dems)] * (DX * DY / 1e6) == payload["agreement"]["unanimous_wet_km2"]


def test_the_envelope_brackets_every_pair_at_its_threshold():
    """
    iou_min and iou_max are the range the products span, not a mean.

    With three products there are three pairs per threshold, and the envelope
    row has to contain all of them or the range understates the disagreement it
    exists to report.
    """
    dems = {
        "steep": valley(40, 41, 20, 1.0),
        "shallow": valley(40, 41, 20, 0.5),
        "shifted": valley(40, 41, 22, 1.0),
    }

    payload = run(dems).payload

    for row in payload["envelope"]:
        at_t = [p["iou"] for p in payload["pairs"] if p["threshold_m"] == row["threshold_m"]]
        assert len(at_t) == 3
        assert row["iou_min"] == min(at_t)
        assert row["iou_max"] == max(at_t)


def test_the_terrain_chain_runs_once_per_product_and_not_once_per_threshold():
    """
    The sweep is free; recomputing the chain for it would cost five times more.

    hand.compute is the whole cost of this analysis at 4.3 microseconds per
    cell. Thresholding the cached HAND field is an array comparison. This is
    the one performance property worth a test, because the wrong version
    returns identical numbers and only the runtime changes.
    """
    calls = []
    real = hand.compute

    def counted(z, dx, dy, **kwargs):
        calls.append(dx)
        return real(z, dx, dy, **kwargs)

    dems = {"a": valley(40, 41, 20, 1.0), "b": valley(40, 41, 20, 0.5)}

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(hand, "compute", counted)
        payload = run(dems, thresholds_m=(1.0, 2.0, 5.0, 10.0, 20.0)).payload

    assert len(payload["thresholds_m"]) == 5
    assert len(calls) == 2


def test_the_payload_survives_a_strict_json_encoder():
    """
    No NaN and no numpy scalar anywhere in the payload.

    The payload crosses a pipe to Go and then to a browser. NaN is not valid
    JSON and neither Go's decoder nor JSON.parse accepts it, so an undefined
    IoU that reached the payload as NaN would fail the run at the decoder, with
    an error naming the parser instead of the empty mask that caused it.
    """
    dems = {"a": valley(40, 41, 20, 1.0), "b": valley(40, 41, 20, 0.5)}

    payload = run(dems).payload

    text = json.dumps(payload, allow_nan=False)
    assert json.loads(text)["reference_threshold_m"] == 1.0


def test_an_undefined_iou_is_null_rather_than_one():
    """
    Two empty masks have an empty union: the index does not exist there.

    Returning 1.0 for the empty case would be defensible set theory and a
    misreport here -- it would say two products agree perfectly about a flood
    neither of them found.
    """
    empty = np.zeros((4, 4), dtype=bool)

    assert flood.iou(empty, empty) is None
    assert flood.iou(empty, np.ones((4, 4), dtype=bool)) == 0.0


def test_a_threshold_no_cell_reaches_reports_null_and_not_a_ratio():
    """
    A threshold below zero selects cells sitting under their own drainage.

    hand() returns a negative height inside a filled depression, so the
    threshold is meaningful; this terrain has no depression, so both masks come
    back empty. The pair row's area_ratio_b_over_a divides by the first
    product's cell count, and the study guards that with max(count, 1), which
    turns an empty mask into a ratio against one cell. Here it is null, because
    a ratio against nothing is not a number a reader can act on.
    """
    z = valley(40, 41, 20, 1.0)
    dems = {"a": z, "b": z + 137.0}

    payload = run(dems, thresholds_m=(-1.0,), reference_threshold_m=-1.0).payload

    row = payload["pairs"][0]
    assert row["iou"] is None
    assert row["area_ratio_b_over_a"] is None
    assert payload["envelope"][0]["iou_min"] is None
    assert payload["agreement"]["contested_frac_of_wet"] is None


def test_the_reference_threshold_joins_the_sweep_when_the_caller_omits_it():
    """
    The agreement raster must have an envelope row at its own threshold.

    Otherwise the payload shows a map built at 1 m beside a table that starts
    at 2 m, and the reader has no measure of the spread of the thing they are
    looking at.
    """
    dems = {"a": valley(40, 41, 20, 1.0), "b": valley(40, 41, 20, 0.5)}

    payload = run(dems, thresholds_m=(2.0, 5.0), reference_threshold_m=1.0).payload

    assert payload["thresholds_m"] == [1.0, 2.0, 5.0]
    assert [row["threshold_m"] for row in payload["envelope"]] == [1.0, 2.0, 5.0]


def test_the_inset_statistic_discards_the_ring_the_payload_names():
    """
    iou_inset is computed on the inset, and the margin reported is the one used.

    Checked by construction: the two products are made to differ only inside
    the discarded ring, so the IoU over the whole reported area is below 1 and
    the inset IoU is exactly 1. A margin reported but not applied, or applied
    but not reported, fails one of the two.
    """
    z = valley(40, 41, 20, 1.0)
    edge_only = z.copy()
    edge_only[:3, :] -= 3.0
    edge_only[-3:, :] -= 3.0

    payload = run({"a": z, "b": edge_only}, inset_margin_cells=4).payload

    row = payload["pairs"][0]
    assert payload["inset_margin_cells"] == 4
    assert row["iou"] < 1.0
    assert row["iou_inset"] == 1.0


def test_the_inset_ring_is_cut_from_the_aoi_and_not_from_the_array():
    """
    The ring follows the polygon, which is the whole point of the rename.

    The AOI here is an interior rectangle of the array, and the two products
    are made to differ in a band just inside its boundary. A ring cut from the
    array border -- what the field used to mean -- leaves that band in the
    inset and reports a disagreement there; a ring cut from the AOI removes it.
    """
    z = valley(40, 41, 20, 1.0)
    disturbed = z.copy()
    disturbed[12:14, :] -= 3.0

    aoi = np.zeros(z.shape, dtype=bool)
    aoi[10:30, 5:36] = True

    payload = run({"a": z, "b": disturbed}, aoi_mask=aoi,
                  inset_margin_cells=4).payload

    row = payload["pairs"][0]
    assert row["iou"] < 1.0
    assert row["iou_inset"] == 1.0
    # 20 by 31 of AOI eroded by 4 on each side is 12 by 23.
    assert payload["aoi"]["cells"] == 20 * 31
    assert payload["aoi"]["inset_cells"] == 12 * 23


def test_the_inset_margin_is_capped_before_it_swallows_the_aoi():
    """
    A 1 km ring on a 40 by 41 AOI would leave nothing to measure.

    At 30 m cells the default margin is 33 cells, which exceeds half the AOI.
    The cap holds the inset at half the shorter side, and the payload reports
    the reduced value rather than the one that was asked for.
    """
    dems = {"a": valley(40, 41, 20, 1.0), "b": valley(40, 41, 20, 0.5)}

    payload = run(dems, inset_margin_cells=None).payload

    assert flood.resolve_inset_margin((40, 41), DX) == 10
    assert payload["inset_margin_cells"] == 10
    assert payload["envelope"][0]["iou_min_inset"] is not None


def test_the_qualifier_names_the_products_and_refuses_a_hydrodynamic_reading():
    """
    The sentence that has to travel with any figure from this module.

    Two claims the output invites and cannot support: that this range is the
    study's published one, and that a threshold in metres is a flood depth. The
    test pins both, and pins that the qualifier names the products actually
    used rather than a hard-coded four.
    """
    dems = {"cop30": valley(40, 41, 20, 1.0), "cop90": valley(40, 41, 20, 0.5)}

    payload = run(dems).payload
    text = payload["qualifier"]

    assert "cop30" in text and "cop90" in text
    assert "OpenTopography" in text and "E-hand-flood-baseline" in text
    assert "not a hydrodynamic model" in text
    for unmodelled in ("rainfall", "discharge", "routing", "channel geometry"):
        assert unmodelled in text
    assert "are not modelled" in text
    # A threshold in metres is not a depth, and the qualifier says so.
    assert "not a flood depth" in text


def test_the_catalogue_facts_come_from_the_read_and_are_null_when_unrecorded():
    """
    A product row reports what the caller knew, and null for what it did not.

    resampled decides whether a pair's disagreement includes a nearest
    neighbour alignment. A bare array carries no such record, and defaulting it
    to false would tell the reader the comparison was clean when nobody
    checked.
    """
    z = valley(40, 41, 20, 1.0)
    dems = {
        "cop30": Read(z, "cop30", "cop-dem-glo-30", 30.0, False),
        "cop90": Read(valley(40, 41, 20, 0.5), "cop90", "cop-dem-glo-90", 90.0, True),
    }

    payload = run(dems).payload

    assert payload["products"][0]["collection"] == "cop-dem-glo-30"
    assert payload["products"][1]["native_resolution_m"] == 90.0
    assert all(row["resampled"] is True for row in payload["pairs"])

    bare = run({"a": z, "b": valley(40, 41, 20, 0.5)}).payload
    assert bare["products"][0]["collection"] is None
    assert all(row["resampled"] is None for row in bare["pairs"])


def test_the_product_rows_are_the_reference_threshold_masks():
    """
    cells, area_km2 and area_frac describe the mask the agreement raster used.

    The rows are written inside the threshold loop, so a row built at the last
    threshold of the sweep instead of the reference one would still look
    well-formed. Recomputing the mask here is what separates the two.
    """
    z = valley(40, 41, 20, 1.0)
    result = run({"a": z, "b": valley(40, 41, 20, 0.5)})
    payload = result.payload

    for row in payload["products"]:
        mask = result.masks[row["id"]] & result.aoi
        assert row["cells"] == int(mask.sum())
        assert row["area_km2"] == pytest.approx(row["cells"] * DX * DY / 1e6, abs=5e-5)
        assert row["area_frac"] == pytest.approx(
            row["cells"] / int(result.aoi.sum()), abs=5e-7
        )


def test_the_reporting_mask_moves_the_figures_and_not_the_terrain():
    """
    The mask narrows what is counted. It must not narrow what was computed.

    This is the whole shape of the fix. HAND needs the contributing area from
    outside the AOI, so the chain has to keep the buffered window; the figures
    have to leave it out. The check is that the reference-threshold extents are
    identical between a run reporting over the whole array and one reporting
    over half of it -- same terrain, same HAND, same masks -- while every count
    in the payload is the part of those masks inside the AOI.
    """
    z = valley(40, 41, 20, 1.0)
    dems = {"a": z, "b": valley(40, 41, 20, 0.5)}

    whole = run(dems)
    aoi = np.zeros(z.shape, dtype=bool)
    aoi[:, :21] = True
    part = run(dems, aoi_mask=aoi)

    for pid in dems:
        assert np.array_equal(whole.masks[pid], part.masks[pid])
    assert np.array_equal(whole.agreement, part.agreement)

    assert part.payload["aoi"]["cells"] == int(aoi.sum())
    assert part.payload["aoi"]["window_cells"] == z.size
    assert part.payload["aoi"]["frac_of_window"] == pytest.approx(
        int(aoi.sum()) / z.size, abs=5e-7
    )
    assert sum(part.payload["agreement"]["counts"]) == int(aoi.sum())

    for whole_row, part_row in zip(whole.payload["products"],
                                   part.payload["products"], strict=True):
        assert part_row["cells"] == int((part.masks[part_row["id"]] & aoi).sum())
        assert part_row["cells"] < whole_row["cells"]


def test_a_missing_reporting_mask_is_refused_rather_than_defaulted():
    """
    Without the mask every area would be the area of the buffered window.

    Defaulting to the whole array is the failure this module shipped with: the
    arrays reaching measure() are the AOI plus 2 to 5 km on every side, and on
    one observed run that put 76.2 km2 of class areas on screen for an AOI of
    about 20 km2. A caller that does mean the whole array says so with a mask
    of all True.
    """
    z = valley(40, 41, 20, 1.0)

    with pytest.raises(ValueError, match="aoi_mask"):
        flood.measure({"a": z, "b": z.copy()}, DX, DY, drainage_km2=DRAINAGE_KM2,
                      grid=grid_for(z), buffer_m=2000.0)


def test_a_mask_that_selects_no_cell_is_refused_rather_than_reported_as_dry():
    """
    An AOI smaller than a cell is not a place where nothing floods.

    Every count would come back zero and every area 0.0 km2, which reads as a
    measurement of dry terrain rather than as the absence of one.
    """
    z = valley(40, 41, 20, 1.0)

    with pytest.raises(ValueError, match="no cell"):
        run({"a": z, "b": z.copy()}, aoi_mask=np.zeros(z.shape, dtype=bool))


def test_a_mask_rasterised_onto_another_grid_is_refused():
    """A mask of the wrong shape selects ground the arrays do not describe."""
    z = valley(40, 41, 20, 1.0)

    with pytest.raises(ValueError, match="different grid"):
        run({"a": z, "b": z.copy()}, aoi_mask=np.ones((40, 40), dtype=bool))


def test_one_product_is_refused_rather_than_reported_without_an_envelope():
    """A single DEM has no disagreement to measure, which is the whole output."""
    with pytest.raises(ValueError, match="at least two"):
        run({"a": valley(40, 41, 20, 1.0)})


def test_two_products_under_one_id_are_refused():
    """
    The id keys the HAND field, so a repeat would compare a product to itself.

    Reachable because a dem.ProductRead carries its own id: the mapping key can
    be unique while two reads report the same product, and the collision would
    surface as an IoU of 1.0 rather than as an error.
    """
    z = valley(40, 41, 20, 1.0)
    dems = {
        "first": Read(z, "cop30", "cop-dem-glo-30", 30.0, False),
        "second": Read(valley(40, 41, 20, 0.5), "cop30", "cop-dem-glo-30", 30.0, False),
    }

    with pytest.raises(ValueError, match="same id"):
        run(dems)


def test_a_void_in_the_elevation_is_refused():
    """
    NaN reaching the depression fill leaves the priority order undefined.

    The chain does not raise on it: heapq compares NaN without complaining, the
    fill returns an array, and HAND comes back wrong over a region rather than
    absent over it. dem.py marks void fills as NaN precisely so they arrive
    here as NaN, and here is where the run has to stop.
    """
    z = valley(40, 41, 20, 1.0)
    holed = z.copy()
    holed[10, 10] = np.nan

    with pytest.raises(ValueError, match="not finite"):
        run({"a": z, "b": holed})


def test_products_on_different_grids_are_refused():
    """The agreement raster counts cell by cell; two shapes cannot be counted."""
    with pytest.raises(ValueError, match="does not match"):
        run({"a": valley(40, 41, 20, 1.0), "b": valley(40, 40, 20, 1.0)})


def test_missing_bounds_are_refused_rather_than_filled_in():
    """
    The payload's grid block places the raster on the Earth.

    flood.py cannot derive the bounds from an array, and a placeholder would
    put a real-looking extent at invented coordinates.
    """
    dems = {"a": valley(40, 41, 20, 1.0), "b": valley(40, 41, 20, 0.5)}

    with pytest.raises(ValueError, match="geographic bounds"):
        flood.measure(dems, DX, DY, drainage_km2=DRAINAGE_KM2, buffer_m=2000.0)


def test_a_grid_of_the_wrong_size_is_refused():
    """
    Bounds for a different window would misplace every cell of the raster.

    The failure this catches is passing the AOI grid where the buffered grid
    was measured -- the same code path, the same units, an extent shifted by
    the buffer.
    """
    z = valley(40, 41, 20, 1.0)
    wrong = grid_for(z)
    wrong["width"] = 39

    with pytest.raises(ValueError, match="different window"):
        run({"a": z, "b": z.copy()}, grid=wrong)


def test_a_transform_where_the_payload_block_belongs_is_refused():
    """
    dem exposes both Grid and payload_grid, and only the second carries bounds.

    Passing the first is the mistake the message names, because a Grid holds an
    affine transform and the payload holds degrees, and nothing downstream
    would notice the difference until a map drew in the wrong place.
    """
    z = valley(40, 41, 20, 1.0)

    with pytest.raises(ValueError, match="payload_grid"):
        run({"a": z, "b": z.copy()}, grid=object())


def test_the_buffer_is_required_because_the_interior_reading_depends_on_it():
    """How far the DEM was read beyond the AOI bounds the drainage that is missing."""
    z = valley(40, 41, 20, 1.0)

    with pytest.raises(ValueError, match="buffer_m"):
        flood.measure({"a": z, "b": z.copy()}, DX, DY, drainage_km2=DRAINAGE_KM2,
                      grid=grid_for(z))
