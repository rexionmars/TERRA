/**
 * The legend table, against the payloads it is written to survive.
 *
 * Every expected value here is worked out from the specification and from the
 * arithmetic of the modules legendFor calls -- the generated stops in
 * lib/palettes.ts, the three lines per channel in lib/rampFormulas.ts, the
 * rounding rule in ECMA-262 for Number.prototype.toFixed, which resolves a tie
 * to the larger n. None of it was read off the function's output. A test
 * carrying what the code printed cannot fail when the code is wrong; it fails
 * only when the code changes, which is a different and much weaker thing, and
 * on this module it would be actively harmful: the failure it guards against is
 * a legend that confidently describes the wrong raster.
 *
 * Most cases are ABSENT FIELDS, because that is what the module is about. Its
 * header says a legend that is wrong is worse than a plane with none, and
 * nearly every branch exists because something did not arrive: Go marshals a
 * missing struct as null, an older sidecar predates a field, a water or solar
 * run carries no class statistics at all. Those are the inputs built below.
 */
import { describe, expect, it } from "vitest"
import { legendFor, type LayerLegend } from "./layerLegend"
import { MAPBIOMAS_CLASS_LEGEND } from "./classPalette"
import type {
  ClassStat,
  CompositionOverlay,
  LULCAnalysis,
  LULCClassRow,
  LULCMetrics,
  PredictResult,
  SolarSitingAnalysis,
  SolarSitingClass,
  SolarTerrainAnalysis,
  VISeriesPoint,
  WaterAnalysis,
} from "./types"

/**
 * A payload carrying only the fields a case turns on.
 *
 * The interfaces in types.ts describe a complete response, and legendFor is
 * written not to trust that -- it reads `r?.mean_confidence !== undefined` on a
 * field the type declares required, because the branch where it is missing is
 * real and one like it took the application down once. A literal satisfying the
 * type cannot express that payload, so the cast stands in for the wire, and
 * each case names the fields it is about and nothing else.
 */
const payload = <T>(fields: Partial<T>): T => fields as T

const classStat = (
  name: string,
  color: string,
  pct: number,
  area_ha: number
): ClassStat => payload<ClassStat>({ name, color, pct, area_ha })

const viPoint = (date: string, ndvi_mean: number): VISeriesPoint =>
  payload<VISeriesPoint>({ date, ndvi_mean })

/*
  Narrow the union and assert its variant in one step. Written as a bare
  `expect(l?.kind).toBe("classes")` the reads that follow would not type-check,
  and written as a cast they would report "cannot read entries of null" instead
  of naming the variant that actually came back.
*/
const asClasses = (l: LayerLegend) => {
  if (l?.kind !== "classes") throw new Error(`expected classes, got ${l?.kind ?? "null"}`)
  return l
}
const asRamp = (l: LayerLegend) => {
  if (l?.kind !== "ramp") throw new Error(`expected ramp, got ${l?.kind ?? "null"}`)
  return l
}
const asStats = (l: LayerLegend) => {
  if (l?.kind !== "stats") throw new Error(`expected stats, got ${l?.kind ?? "null"}`)
  return l
}
const asNote = (l: LayerLegend) => {
  if (l?.kind !== "note") throw new Error(`expected note, got ${l?.kind ?? "null"}`)
  return l
}

/*
  The generated ramps, transcribed from lib/palettes.ts PALETTE_STOPS with the
  positions the module computes: stop i of n sits at i/(n-1) * 100, to two
  decimals. Regenerating a palette from the sidecar will fail these, and that is
  the intent -- a legend swatch is meant to be the same byte as the pixel it
  describes, so a ramp that moved is worth a second look rather than a silent
  pass.
*/
const BLUES_GRADIENT =
  "linear-gradient(to right, #f7f9ff 0.00%, #c6dbef 25.00%, #6badd6 50.00%, " +
  "#3072af 75.00%, #07306b 100.00%)"
const RDYLGN_GRADIENT =
  "linear-gradient(to right, #a50026 0.00%, #f46d42 16.67%, #fcbf63 33.33%, " +
  "#ffffbf 50.00%, #aadd89 66.67%, #66bc63 83.33%, #197738 100.00%)"

describe("legendFor, prediction", () => {
  it("returns null when the run carries none of the three maps", () => {
    // Arrange: a result that classified nothing -- a water or solar run.
    const result = payload<PredictResult>({ n_dates: 0 })

    // Act / Assert
    expect(legendFor("prediction", { result })).toBeNull()
    expect(legendFor("prediction", { result: null })).toBeNull()
    expect(legendFor("prediction", {})).toBeNull()
  })

  it("describes the classification when the run carries one, even beside a MapBiomas map", () => {
    /*
      The regression the module's header names: preferring MapBiomas wherever it
      existed drew the run's own classification under a legend for a different
      raster, and the plane's purple was soybean while the legend called it
      sugar cane. The layer prefers the classification, so the legend must.
    */
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      class_stats: [classStat("Soybean", "#f5b3c8", 61.2, 100)],
      lulc: payload<LULCAnalysis>({
        year: 2022,
        map_uri: "data:image/png;base64,mapbiomas",
        composition: [
          payload<LULCClassRow>({
            name: "Sugar cane",
            color: "#db7093",
            pct: 71,
            area_ha: 400,
          }),
        ],
      }),
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.subject).toBe("Land cover")
    expect(legend.entries.map((e) => e.name)).toEqual(["Soybean"])
  })

  it("falls through to the MapBiomas map when the classification uri is an empty string", () => {
    // Go emits the field either way, so an absent classification arrives as ""
    // rather than as a missing key.
    const result = payload<PredictResult>({
      overlay_uri: "",
      lulc: payload<LULCAnalysis>({
        year: 2022,
        map_uri: "data:image/png;base64,mapbiomas",
        composition: [
          payload<LULCClassRow>({
            name: "Forest Formation",
            color: "#006400",
            pct: 38.75,
            area_ha: 780.4,
          }),
        ],
      }),
    })

    expect(asClasses(legendFor("prediction", { result })).subject).toBe(
      "MapBiomas 2022"
    )
  })

  it("carries the MapBiomas composition in payload order, with its shares and areas", () => {
    // Arrange: the larger class second, so a legend that sorted by share would
    // reverse these two.
    const result = payload<PredictResult>({
      lulc: payload<LULCAnalysis>({
        year: 2022,
        map_uri: "data:image/png;base64,mapbiomas",
        composition: [
          payload<LULCClassRow>({
            name: "Forest Formation",
            color: "#006400",
            pct: 38.75,
            area_ha: 780.4,
          }),
          payload<LULCClassRow>({
            name: "Soybean",
            color: "#f5b3c8",
            pct: 61.25,
            area_ha: 1234.5,
          }),
        ],
        metrics: payload<LULCMetrics>({ area_ha: 2014.5, n_classes: 2 }),
      }),
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.entries).toEqual([
      { name: "Forest Formation", color: "#006400", pct: 38.75, areaHa: 780.4 },
      { name: "Soybean", color: "#f5b3c8", pct: 61.25, areaHa: 1234.5 },
    ])
    // 2014.5 is a tie at zero decimals and resolves upward, and the count is
    // the metric's own rather than the number of rows above it.
    expect(legend.rows).toEqual([
      { label: "Mapped", value: "2015 ha" },
      { label: "Classes", value: "2" },
    ])
  })

  it("omits the MapBiomas figures when the run carries no metrics struct", () => {
    // metrics is declared non-optional and is not: Go marshals a missing struct
    // as null, and reading into it is what this guard is for.
    const result = payload<PredictResult>({
      lulc: payload<LULCAnalysis>({
        year: 2020,
        map_uri: "data:image/png;base64,mapbiomas",
        composition: [
          payload<LULCClassRow>({
            name: "Pasture",
            color: "#ffd966",
            pct: 100,
            area_ha: 50,
          }),
        ],
        metrics: null as unknown as LULCMetrics,
      }),
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.subject).toBe("MapBiomas 2020")
    expect(legend.rows).toBeUndefined()
  })

  it("returns null when the MapBiomas map resolved no classes", () => {
    const result = payload<PredictResult>({
      lulc: payload<LULCAnalysis>({
        year: 2022,
        map_uri: "data:image/png;base64,mapbiomas",
        composition: [],
      }),
    })

    expect(legendFor("prediction", { result })).toBeNull()
  })

  it("gives the reference map the shared class table and no shares", () => {
    /*
      The reference is ground truth the run was scored against, not something
      the run measured, so it has no per-run statistics. Expected entries are
      derived from the table rather than transcribed: what is under test is the
      mapping, and a table that legitimately grows a class should not need this
      file edited.
    */
    const result = payload<PredictResult>({
      reference_uri: "data:image/png;base64,reference",
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.subject).toBe("Reference map")
    expect(legend.entries).toEqual(
      MAPBIOMAS_CLASS_LEGEND.map((e) => ({ name: e.name, color: e.color }))
    )
    expect(legend.entries.every((e) => e.pct === undefined)).toBe(true)
    expect(legend.entries.every((e) => e.areaHa === undefined)).toBe(true)
    expect(legend.rows).toBeUndefined()
  })

  it("returns null for a classification whose class statistics did not arrive", () => {
    const nulled = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      class_stats: null,
    })
    const empty = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      class_stats: [],
    })

    expect(legendFor("prediction", { result: nulled })).toBeNull()
    expect(legendFor("prediction", { result: empty })).toBeNull()
  })

  it("reports confidence with its floor, the scene count and the mapped area, in that order", () => {
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      mean_confidence: 0.3712,
      confidence_floor: 0.25,
      n_dates: 7,
      class_stats: [
        classStat("Soybean", "#f5b3c8", 61.2, 1234.5),
        classStat("Pasture", "#ffd966", 38.8, 780.4),
      ],
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.subject).toBe("Land cover")
    expect(legend.entries).toEqual([
      { name: "Soybean", color: "#f5b3c8", pct: 61.2, areaHa: 1234.5 },
      { name: "Pasture", color: "#ffd966", pct: 38.8, areaHa: 780.4 },
    ])
    // 37.12% to one decimal, 25% to one decimal, and 1234.5 + 780.4 = 2014.9
    // hectares to none.
    expect(legend.rows).toEqual([
      { label: "Confidence", value: "37.1% · floor 25.0%" },
      { label: "Scenes", value: "7" },
      { label: "Mapped", value: "2015 ha" },
    ])
  })

  it("reports confidence alone when the run predates the floor", () => {
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      mean_confidence: 0.3712,
      class_stats: [classStat("Soybean", "#f5b3c8", 100, 10)],
    })

    expect(asClasses(legendFor("prediction", { result })).rows).toEqual([
      { label: "Confidence", value: "37.1%" },
      { label: "Mapped", value: "10 ha" },
    ])
  })

  it("reports a mean confidence of zero rather than treating it as absent", () => {
    // Zero is a measurement and undefined is not. A truthiness check here would
    // drop the row on the one run whose confidence is worth reading.
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      mean_confidence: 0,
      n_dates: 3,
      class_stats: [classStat("Soybean", "#f5b3c8", 100, 10)],
    })

    expect(asClasses(legendFor("prediction", { result })).rows?.[0]).toEqual({
      label: "Confidence",
      value: "0.0%",
    })
  })

  it("omits every figure, and the block with them, when the run measured none", () => {
    /*
      Neither confidence nor a scene count on the wire, and classes whose areas
      were never computed: rows collapses to undefined rather than to an empty
      block. Both fields are left off the payload rather than sent as zero,
      since whether a zero belongs on screen is a separate question from
      whether an empty block does.
    */
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      class_stats: [classStat("Soybean", "#f5b3c8", 0, 0)],
    })

    const legend = asClasses(legendFor("prediction", { result }))

    expect(legend.entries).toHaveLength(1)
    expect(legend.rows).toBeUndefined()
  })
})

describe("legendFor, solar siting", () => {
  const suitable = payload<SolarSitingClass>({
    name: "Suitable",
    color: "#2b8a3e",
    pct: 51.2,
    area_ha: 512.4,
  })
  const cropland = payload<SolarSitingClass>({
    name: "Suitable on cropland",
    color: "#fab005",
    pct: 30.1,
    area_ha: 300.6,
  })

  it("returns null without a siting analysis or without its classes", () => {
    expect(legendFor("solar:siting", {})).toBeNull()
    expect(legendFor("solar:siting", { solarSiting: null })).toBeNull()
    expect(
      legendFor("solar:siting", {
        solarSiting: payload<SolarSitingAnalysis>({ classes: [] }),
      })
    ).toBeNull()
  })

  it("keeps the two suitable areas as separate figures and never as their sum", () => {
    /*
      types.ts says it beside the field: the trade-off between siting on free
      land and siting on cropland is the finding, so 512 and 301 hectares must
      not appear as 813. The row list is compared whole, which is what makes a
      summed row a failure rather than an extra nobody notices.
    */
    const solarSiting = payload<SolarSitingAnalysis>({
      classes: [suitable, cropland],
      suitable_no_conflict_ha: 512.4,
      suitable_cropland_ha: 300.6,
      thresholds: payload<SolarSitingAnalysis["thresholds"]>({
        slope_acceptable_deg: 10,
        slope_restrictive_deg: 15,
      }),
    })

    const legend = asClasses(legendFor("solar:siting", { solarSiting }))

    expect(legend.subject).toBe("Siting suitability")
    expect(legend.entries).toEqual([
      { name: "Suitable", color: "#2b8a3e", pct: 51.2, areaHa: 512.4 },
      { name: "Suitable on cropland", color: "#fab005", pct: 30.1, areaHa: 300.6 },
    ])
    expect(legend.rows).toEqual([
      { label: "Suitable", value: "512 ha" },
      { label: "On cropland", value: "301 ha" },
      { label: "Slope", value: "10-15 deg" },
    ])
  })

  it("reports zero suitable hectares as a figure, not as a missing field", () => {
    // An AOI with nothing sitable is a result. The guard is on the type rather
    // than on truthiness precisely so this row survives.
    const solarSiting = payload<SolarSitingAnalysis>({
      classes: [cropland],
      suitable_no_conflict_ha: 0,
      suitable_cropland_ha: 300.6,
    })

    expect(asClasses(legendFor("solar:siting", { solarSiting })).rows).toEqual([
      { label: "Suitable", value: "0 ha" },
      { label: "On cropland", value: "301 ha" },
    ])
  })

  it("drops the figures an older payload does not carry and keeps the classes", () => {
    const solarSiting = payload<SolarSitingAnalysis>({ classes: [suitable] })

    const legend = asClasses(legendFor("solar:siting", { solarSiting }))

    expect(legend.entries).toHaveLength(1)
    expect(legend.rows).toEqual([])
  })
})

describe("legendFor, solar terrain", () => {
  it("returns null without a terrain analysis", () => {
    expect(legendFor("solar:terrain", {})).toBeNull()
    expect(legendFor("solar:terrain", { solarTerrain: null })).toBeNull()
  })

  it("labels the ends from the render scale, not from this layer's own range", () => {
    /*
      A seasonal layer is drawn against a domain spanning both seasons, so its
      own poa_min/poa_max are narrower. Labelling with those would put values on
      the ends that no pixel on this plane carries -- here 4.2 and 5.1 against a
      bar that runs 3.8 to 6.3.
    */
    const solarTerrain = payload<SolarTerrainAnalysis>({
      unit: "kWh/m2/day",
      poa_min: 4.2,
      poa_max: 5.1,
      season: "winter",
      scale: {
        palette: "blues",
        min: 3.8,
        max: 6.25,
        reference: null,
        basis: "shared",
        shared_with: "summer",
        decimals: 1,
      },
    })

    const legend = asRamp(legendFor("solar:terrain", { solarTerrain }))

    expect(legend.subject).toBe("Irradiation · kWh/m2/day")
    expect(legend.gradient).toBe(BLUES_GRADIENT)
    // 6.25 is a tie at one decimal and resolves upward.
    expect(legend.low).toBe("3.8")
    expect(legend.high).toBe("6.3")
  })

  it("rounds the ends to the decimals the scale asks for", () => {
    const solarTerrain = payload<SolarTerrainAnalysis>({
      unit: "kWh/m2",
      scale: {
        palette: "inferno",
        min: 3.8,
        max: 6.25,
        reference: null,
        basis: "own",
        shared_with: null,
        decimals: 0,
      },
    })

    const legend = asRamp(legendFor("solar:terrain", { solarTerrain }))

    expect(legend.low).toBe("4")
    expect(legend.high).toBe("6")
  })

  it("draws the ramp the scale names rather than one fixed ramp", () => {
    const solarTerrain = payload<SolarTerrainAnalysis>({
      unit: "%",
      scale: {
        palette: "rdylgn",
        min: 0,
        max: 100,
        reference: null,
        basis: "fixed",
        shared_with: null,
        decimals: 0,
      },
    })

    expect(asRamp(legendFor("solar:terrain", { solarTerrain })).gradient).toBe(
      RDYLGN_GRADIENT
    )
  })
})

describe("legendFor, composition", () => {
  it("returns null without a composition", () => {
    expect(legendFor("composition", {})).toBeNull()
    expect(legendFor("composition", { composition: null })).toBeNull()
  })

  it("draws an index on the catalogue's own ramp and end labels", () => {
    // Ramp and labels both come from compositeCatalog's NDVI entry, which names
    // rdylgn and the two ends "Sparse / bare" and "Dense vegetation".
    const composition = payload<CompositionOverlay>({
      kind: "index",
      index: "ndvi",
    })

    const legend = asRamp(legendFor("composition", { composition }))

    expect(legend.subject).toBe("NDVI")
    expect(legend.gradient).toBe(RDYLGN_GRADIENT)
    expect(legend.low).toBe("Sparse / bare")
    expect(legend.high).toBe("Dense vegetation")
  })

  it("takes each index's own ends rather than one pair for all of them", () => {
    const composition = payload<CompositionOverlay>({
      kind: "index",
      index: "ndwi",
    })

    const legend = asRamp(legendFor("composition", { composition }))

    expect(legend.subject).toBe("NDWI")
    expect(legend.gradient).toBe(BLUES_GRADIENT)
    expect(legend.low).toBe("Dry / land")
    expect(legend.high).toBe("Water")
  })

  it("returns null for an index the catalogue does not list", () => {
    // A wire value outside the union: a composition made by a sidecar carrying
    // an index this build has no entry for. Drawing it under some other index's
    // ramp is the failure the whole module exists to avoid.
    const composition = {
      kind: "index",
      index: "savi",
    } as unknown as CompositionOverlay

    expect(legendFor("composition", { composition })).toBeNull()
  })

  it("names the three bands of an RGB composite instead of a scale", () => {
    // Three bands painted into three channels have no scale: what a colour
    // means is which band is bright.
    const composition = payload<CompositionOverlay>({
      kind: "rgb",
      bands: ["B11", "B08", "B02"],
    })

    const legend = asNote(legendFor("composition", { composition }))

    expect(legend.subject).toBe("RGB composite")
    expect(legend.note).toBe("R B11 · G B08 · B B02")
  })

  it("returns null for an RGB composite whose bands did not arrive", () => {
    const composition = payload<CompositionOverlay>({ kind: "rgb" })

    expect(legendFor("composition", { composition })).toBeNull()
  })
})

describe("legendFor, confidence", () => {
  it("returns null when the run reported no mean confidence", () => {
    expect(legendFor("confidence", {})).toBeNull()
    expect(
      legendFor("confidence", { result: payload<PredictResult>({ n_dates: 4 }) })
    ).toBeNull()
  })

  it("reports the mean, the floor and the distance between them", () => {
    // 62.0% against a floor of 25.0% is 37.0 percentage points above it. The
    // floor is 1/K and the value the mean cannot go below, so the distance is
    // the only part of the mean that carries information.
    const result = payload<PredictResult>({
      mean_confidence: 0.62,
      confidence_floor: 0.25,
      class_stats: [
        classStat("Soybean", "#f5b3c8", 50, 10),
        classStat("Pasture", "#ffd966", 30, 6),
        classStat("Forest Formation", "#006400", 20, 4),
      ],
    })

    const legend = asStats(legendFor("confidence", { result }))

    expect(legend.subject).toBe("Confidence")
    expect(legend.rows).toEqual([
      { label: "Mean", value: "62.0%" },
      { label: "Floor", value: "25.0%" },
      { label: "Above floor", value: "37.0 pp" },
      { label: "Classes", value: "3" },
    ])
  })

  it("reports zero points above the floor when the mean sits exactly on it", () => {
    // A four-class model whose mean vote share is 1/4: the classification
    // carries no information at all, and the legend has to say so rather than
    // round it away.
    const result = payload<PredictResult>({
      mean_confidence: 0.25,
      confidence_floor: 0.25,
    })

    expect(asStats(legendFor("confidence", { result })).rows).toEqual([
      { label: "Mean", value: "25.0%" },
      { label: "Floor", value: "25.0%" },
      { label: "Above floor", value: "0.0 pp" },
    ])
  })

  it("omits the floor rows and the instruction to read against it together", () => {
    /*
      The caveat names the floor only where the floor is on screen. Telling a
      reader to compare against a figure the run did not report is an
      instruction that cannot be followed, and the count of classes present in
      the output is not a substitute: a model can carry classes this AOI has
      none of.
    */
    const result = payload<PredictResult>({
      mean_confidence: 0.62,
      class_stats: null,
    })

    const legend = asStats(legendFor("confidence", { result }))

    expect(legend.rows).toEqual([{ label: "Mean", value: "62.0%" }])
    expect(legend.note).toBe(
      "Ensemble vote share over classified pixels, not a calibrated probability." +
        " Under domain shift it can run opposite to accuracy." +
        " Lower values are drawn cooler and more transparent."
    )
  })

  it("names the floor in the caveat when the floor is on screen", () => {
    const result = payload<PredictResult>({
      mean_confidence: 0.62,
      confidence_floor: 0.2,
    })

    expect(asStats(legendFor("confidence", { result })).note).toBe(
      "Ensemble vote share over classified pixels, not a calibrated probability." +
        " Under domain shift it can run opposite to accuracy." +
        " Read against the floor." +
        " Lower values are drawn cooler and more transparent."
    )
  })

  it("counts no classes when the classification produced none", () => {
    const result = payload<PredictResult>({
      mean_confidence: 0.62,
      class_stats: [],
    })

    expect(
      asStats(legendFor("confidence", { result })).rows.map((r) => r.label)
    ).toEqual(["Mean"])
  })

  it("draws the confidence formula's ramp over the full 0 to 100% domain", () => {
    /*
      Ends worked out from rampFormulas.confidenceRGB, which is the sidecar's
      own expression. At 0: r = clip((0 - 0.5) * 2) = 0, g = 0, b = 1 - 0 = 1,
      so rgb(0 0 255). At 1: r = 1, g = clip(1.2) = 1, b = 1 - 0.5 = 0.5, and
      the byte is floor(0.5 * 255) = 127, so rgb(255 255 127). Blue to yellow,
      which is what separates this ramp from the NDVI one.
    */
    const result = payload<PredictResult>({ mean_confidence: 0.62 })

    const legend = asStats(legendFor("confidence", { result }))

    expect(legend.ramp?.low).toBe("0%")
    expect(legend.ramp?.high).toBe("100%")
    expect(legend.ramp?.gradient.startsWith(
      "linear-gradient(to right, rgb(0 0 255) 0.00%,"
    )).toBe(true)
    expect(legend.ramp?.gradient.endsWith("rgb(255 255 127) 100.00%)")).toBe(true)
  })
})

describe("legendFor, water", () => {
  const water = payload<WaterAnalysis>({
    index: "MNDWI",
    n_dates: 9,
    persistent_area_ha: 12.25,
    ephemeral_area_ha: 41.06,
    aoi_area_ha: 980.5,
    peak_water_fraction_pct: 7.849,
    peak_date: "2023-03-14",
  })

  it("returns null without a water analysis", () => {
    expect(legendFor("water", {})).toBeNull()
    expect(legendFor("water", { water: null })).toBeNull()
  })

  it("keeps persistent and ephemeral water apart, since the split is the finding", () => {
    // A pond that is always there and a floodway that is water on a few dates
    // are the same hectares and not the same thing, so 12.3 and 41.1 must never
    // arrive as 53.4. Areas to one decimal; 12.25 is a tie and resolves upward.
    const legend = asStats(legendFor("water", { water }))

    expect(legend.subject).toBe("Water occurrence · MNDWI")
    expect(legend.rows).toEqual([
      { label: "Dates", value: "9" },
      { label: "Persistent", value: "12.3 ha" },
      { label: "Ephemeral", value: "41.1 ha" },
      { label: "AOI", value: "980.5 ha" },
      { label: "Peak", value: "7.8% · 2023-03-14" },
    ])
    expect(legend.note).toBe(
      "Share of dates a pixel was classified water, on a fixed 0 to 1 scale."
    )
  })

  it("states a run that found no water rather than dropping its rows", () => {
    // Unlike the classification block, none of these figures is conditional: a
    // dry AOI over one date is a measurement and the legend reports it.
    const dry = payload<WaterAnalysis>({
      index: "NDWI",
      n_dates: 1,
      persistent_area_ha: 0,
      ephemeral_area_ha: 0,
      aoi_area_ha: 980.5,
      peak_water_fraction_pct: 0,
      peak_date: "2023-03-14",
    })

    expect(asStats(legendFor("water", { water: dry })).rows).toEqual([
      { label: "Dates", value: "1" },
      { label: "Persistent", value: "0.0 ha" },
      { label: "Ephemeral", value: "0.0 ha" },
      { label: "AOI", value: "980.5 ha" },
      { label: "Peak", value: "0.0% · 2023-03-14" },
    ])
  })
})

describe("legendFor, NDVI mean", () => {
  it("returns null without a result", () => {
    expect(legendFor("ndvi", {})).toBeNull()
    expect(legendFor("ndvi", { result: null })).toBeNull()
  })

  it("returns null when the run measured nothing the block could report", () => {
    // A water or solar run reaching this layer has no series and no window,
    // and Go sends both as null: an empty block is worse than no block.
    const result = payload<PredictResult>({
      vi_series: null,
      date_range: null,
    })

    expect(legendFor("ndvi", { result })).toBeNull()
  })

  it("reports the range of the AOI mean across the series, with the window", () => {
    // Unsorted on purpose: the row is the extremes of the series, not its first
    // and last date. 0.181 and 0.774 to two decimals are 0.18 and 0.77.
    const result = payload<PredictResult>({
      n_dates: 6,
      vi_series: [
        viPoint("2023-01-08", 0.42),
        viPoint("2023-01-28", 0.181),
        viPoint("2023-02-17", 0.774),
        viPoint("2023-03-09", 0.5),
      ],
      date_range: ["2023-01-01", "2023-04-30"],
    })

    const legend = asStats(legendFor("ndvi", { result }))

    expect(legend.subject).toBe("NDVI mean")
    expect(legend.rows).toEqual([
      { label: "Dates", value: "6" },
      { label: "AOI mean per date", value: "0.18 to 0.77" },
      { label: "Window", value: "2023-01-01 to 2023-04-30" },
    ])
    expect(legend.note).toBe(
      "Per-pixel mean over the dates that survived cloud masking."
    )
  })

  it("reports a single date as a range from that value to itself", () => {
    // 0.125 is a tie at two decimals and resolves upward.
    const result = payload<PredictResult>({
      vi_series: [viPoint("2023-01-08", 0.125)],
    })

    expect(asStats(legendFor("ndvi", { result })).rows).toEqual([
      { label: "AOI mean per date", value: "0.13 to 0.13" },
    ])
  })

  it("reads the AOI-wide series, not the crop-pixel one beside it", () => {
    /*
      The two are different measurements over the same dates and can differ in
      length, since a date whose crop pixels were entirely cloud-obscured leaves
      one series and stays in the other. This plane is the AOI mean.
    */
    const result = payload<PredictResult>({
      vi_series: [viPoint("2023-01-08", 0.4), viPoint("2023-01-28", 0.6)],
      vi_series_crop: [viPoint("2023-01-08", 0.9), viPoint("2023-01-28", 0.95)],
    })

    expect(asStats(legendFor("ndvi", { result })).rows).toEqual([
      { label: "AOI mean per date", value: "0.40 to 0.60" },
    ])
  })

  it("omits the range when the series is empty and the window when it is not a pair", () => {
    // A one-ended date range is not a window, and joining it would print a
    // start date as though it were both ends.
    const result = payload<PredictResult>({
      n_dates: 2,
      vi_series: [],
      date_range: ["2023-01-01"],
    })

    expect(asStats(legendFor("ndvi", { result })).rows).toEqual([
      { label: "Dates", value: "2" },
    ])
  })

  it("draws the NDVI formula's ramp over its fixed 0 to 1 domain", () => {
    /*
      Ends from rampFormulas.ndviMeanRGB. At 0: r = 1, g = 0.8, b = 0.45, whose
      bytes are 255, floor(204.0) = 204 and floor(114.75) = 114. At 1: r =
      1 - 0.85 = 0.15, g = 0.8 + 0.15 = 0.95, b = 0, giving floor(38.25) = 38,
      floor(242.25) = 242 and 0. Pale yellow to dark green.
    */
    const result = payload<PredictResult>({
      vi_series: [viPoint("2023-01-08", 0.4)],
    })

    const legend = asStats(legendFor("ndvi", { result }))

    expect(legend.ramp?.low).toBe("0")
    expect(legend.ramp?.high).toBe("1")
    expect(legend.ramp?.gradient.startsWith(
      "linear-gradient(to right, rgb(255 204 114) 0.00%,"
    )).toBe(true)
    expect(legend.ramp?.gradient.endsWith("rgb(38 242 0) 100.00%)")).toBe(true)
  })
})

describe("legendFor, layers with no legend", () => {
  it("returns null for true colour and for an id it does not know", () => {
    // A photograph explains itself, and inventing a legend for an unknown layer
    // would be this table describing a raster it has never seen.
    const result = payload<PredictResult>({
      overlay_uri: "data:image/png;base64,classification",
      mean_confidence: 0.62,
      class_stats: [classStat("Soybean", "#f5b3c8", 100, 10)],
    })

    expect(legendFor("true-color", { result })).toBeNull()
    expect(legendFor("solar:ghi", { result })).toBeNull()
    expect(legendFor("", { result })).toBeNull()
  })
})
