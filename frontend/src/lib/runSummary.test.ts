/**
 * The readers over InferenceRun.summary, exercised against the contract the
 * module states rather than against what it currently prints.
 *
 * summary is opaque TEXT. Nothing between app.go and these functions validates
 * it, so the input space here is not "a summary object" but "any string a row
 * may hold" -- absent, blank, truncated mid-write, or written by a version that
 * had not invented the key being read. Every reader is defensive for that
 * reason, and a defence is only worth having if something proves it fires: a
 * regression that let a malformed row through would surface as a thrown error
 * in a run list, which is a screen with no data of its own to fall back to.
 *
 * Every expected value below was worked out from the module's documented rules
 * -- the band thresholds in formatHectares, the tag names solarProductLabel
 * discriminates on, the separators runRowLine joins with -- and none was read
 * off the module's output. The one deliberate exception is the thousands
 * separator, noted where it appears.
 */
import { describe, expect, it } from "vitest"
import {
  classifiedAreaHa,
  datesByMonth,
  dominantClass,
  formatHectares,
  modelDisplayName,
  parseRunSummary,
  runKindLabel,
  runRowLine,
  runSummaryObject,
  solarProductLabel,
  type RunClassStat,
} from "./runSummary"

/** A stat as class_statistics writes it, with only the field under test varied. */
function stat(over: Partial<RunClassStat> = {}): RunClassStat {
  return {
    class_id: 1,
    name: "Forest",
    color: "#1f6f43",
    pct: 50,
    area_ha: 100,
    ...over,
  }
}

/** The placeholder formatHectares prints, spelled once: an em dash, not a hyphen. */
const NO_VALUE = "—"

describe("parseRunSummary", () => {
  const empty = { classStats: [], dateRange: null, nDates: null }

  it("reads nothing rather than throwing for a summary that is absent, blank or unparseable", () => {
    // The four shapes a row can actually hold: the column was null before the
    // writer set it, the writer set it to an empty or whitespace string, or
    // the JSON is truncated. A throw here reaches a run list with no data.
    expect(parseRunSummary(undefined)).toEqual(empty)
    expect(parseRunSummary(null)).toEqual(empty)
    expect(parseRunSummary("")).toEqual(empty)
    expect(parseRunSummary("   \n ")).toEqual(empty)
    expect(parseRunSummary('{"class_stats":')).toEqual(empty)
  })

  it("reads nothing from valid JSON that is not an object of keys", () => {
    // JSON.parse accepts these. Reading a key off the null case throws, which
    // is why the guard is a try and not an Array.isArray check alone.
    expect(parseRunSummary("null")).toEqual(empty)
    expect(parseRunSummary("42")).toEqual(empty)
    expect(parseRunSummary('"solar"')).toEqual(empty)
  })

  it("keeps only the class entries carrying both a name and a colour", () => {
    // Arrange: one well-formed entry among the shapes a partially written or
    // older row can put in the array.
    const summary = JSON.stringify({
      class_stats: [
        stat({ class_id: 3, name: "Water", color: "#1d4ed8" }),
        { class_id: 4, color: "#000000" },
        { class_id: 5, name: "Urban" },
        { class_id: 6, name: 7, color: "#000000" },
        null,
        "Water",
      ],
    })

    // Act
    const read = parseRunSummary(summary)

    // Assert: the legible entry survives intact, the five others are dropped
    // rather than reaching a renderer that would read .name off null.
    expect(read.classStats).toHaveLength(1)
    expect(read.classStats[0]).toEqual(
      stat({ class_id: 3, name: "Water", color: "#1d4ed8" })
    )
  })

  it("reads no classes when class_stats is missing or is not an array", () => {
    expect(parseRunSummary("{}").classStats).toEqual([])
    expect(parseRunSummary('{"class_stats":null}').classStats).toEqual([])
    expect(parseRunSummary('{"class_stats":{"0":{"name":"a","color":"#b"}}}')
      .classStats).toEqual([])
  })

  it("reads a date range only when both ends are non-empty strings", () => {
    const range = (v: unknown) =>
      parseRunSummary(JSON.stringify({ date_range: v })).dateRange

    expect(range(["2024-01-05", "2024-03-28"])).toEqual([
      "2024-01-05",
      "2024-03-28",
    ])
    // A one-sided range is not a range: half of it would render as "2024-01-05
    // → undefined". Same for the empty string a writer leaves when the search
    // returned no scenes.
    expect(range(["2024-01-05"])).toBeNull()
    expect(range(["", "2024-03-28"])).toBeNull()
    expect(range(["2024-01-05", ""])).toBeNull()
    expect(range([2024, 2025])).toBeNull()
    expect(range("2024-01-05")).toBeNull()
    expect(range([])).toBeNull()
    expect(parseRunSummary("{}").dateRange).toBeNull()
  })

  it("keeps the first two entries of a longer date_range", () => {
    // date_range is documented as [first, last]. A third entry is a writer
    // fault, not a reason to drop the extent the row does carry.
    expect(
      parseRunSummary(
        JSON.stringify({ date_range: ["2024-01-05", "2024-03-28", "2024-04-01"] })
      ).dateRange
    ).toEqual(["2024-01-05", "2024-03-28"])
  })

  it("reads n_dates only when it arrives as a number", () => {
    expect(parseRunSummary('{"n_dates":12}').nDates).toBe(12)
    // Zero is a real count -- a search that matched no scene -- and must not
    // be flattened into "the key was missing".
    expect(parseRunSummary('{"n_dates":0}').nDates).toBe(0)
    expect(parseRunSummary('{"n_dates":"12"}').nDates).toBeNull()
    expect(parseRunSummary('{"n_dates":null}').nDates).toBeNull()
    expect(parseRunSummary("{}").nDates).toBeNull()
  })
})

describe("dominantClass", () => {
  it("is null when the run recorded no classes", () => {
    expect(dominantClass([])).toBeNull()
  })

  it("is the first entry, the sidecar's pixel-count order, not the largest pct", () => {
    // The module documents that it trusts the order class_statistics emits and
    // does not scan. Stats ordered by something else -- or reordered by a
    // future caller -- would therefore report a different class, so the test
    // states the dependency instead of hiding it behind an already sorted list.
    const stats = [
      stat({ class_id: 1, name: "Pasture", pct: 40 }),
      stat({ class_id: 2, name: "Forest", pct: 55 }),
    ]

    expect(dominantClass(stats)).toBe(stats[0])
  })
})

describe("classifiedAreaHa", () => {
  it("is 0 for a run with no classes", () => {
    expect(classifiedAreaHa([])).toBe(0)
  })

  it("sums area_ha across every class", () => {
    // Halves and quarters, so the assertion is exact and does not turn into a
    // test of binary floating point: 12.5 + 0.25 + 7 = 19.75.
    const stats = [
      stat({ class_id: 1, area_ha: 12.5 }),
      stat({ class_id: 2, area_ha: 0.25 }),
      stat({ class_id: 3, area_ha: 7 }),
    ]

    expect(classifiedAreaHa(stats)).toBe(19.75)
  })

  it("skips a class whose area_ha is absent or not a number", () => {
    // parseRunSummary admits an entry on name and colour alone, so these reach
    // here from a real row. The sum stays a number: a single undefined added
    // in would make the whole figure NaN and the caller would print nothing.
    const stats = [
      stat({ class_id: 1, area_ha: 12.5 }),
      { class_id: 2, name: "Water", color: "#1d4ed8", pct: 10 },
      { class_id: 3, name: "Urban", color: "#000000", pct: 5, area_ha: "7" },
    ] as unknown as RunClassStat[]

    expect(classifiedAreaHa(stats)).toBe(12.5)
  })
})

describe("formatHectares", () => {
  it("prints a placeholder for zero, negative and non-finite areas", () => {
    // A run can report 0 classified hectares, and a division upstream can hand
    // over NaN or Infinity. None of them is a measurement, so none is printed
    // as one.
    expect(formatHectares(0)).toBe(NO_VALUE)
    expect(formatHectares(-1)).toBe(NO_VALUE)
    expect(formatHectares(-0.5)).toBe(NO_VALUE)
    expect(formatHectares(NaN)).toBe(NO_VALUE)
    expect(formatHectares(Infinity)).toBe(NO_VALUE)
    expect(formatHectares(-Infinity)).toBe(NO_VALUE)
  })

  it("keeps two decimals below 10 hectares", () => {
    // Small areas are where a dropped decimal changes the reading: 0.4 ha and
    // 0.44 ha are different parcels, both of which round to the same integer.
    expect(formatHectares(0.4)).toBe("0.40 ha")
    expect(formatHectares(1.5)).toBe("1.50 ha")
    expect(formatHectares(9.99)).toBe("9.99 ha")
  })

  it("keeps one decimal from 10 hectares up to 1000", () => {
    // 10 is the boundary and belongs to the one-decimal band: the band below
    // it is ha < 10, not ha <= 10.
    expect(formatHectares(10)).toBe("10.0 ha")
    expect(formatHectares(123.45)).toBe("123.5 ha")
    expect(formatHectares(999.9)).toBe("999.9 ha")
  })

  it("rounds to whole hectares from 1000 up", () => {
    // 1000 is the boundary and belongs to this band, since the band below it
    // is ha < 1000. The integers are worked out here -- 1000, and 1235 from
    // rounding 1234.6 and 1234.5 -- while the group separator is left to
    // toLocaleString, because the runtime locale chooses it and spelling
    // "1,235" would fail this file on a machine set to any locale that groups
    // differently.
    expect(formatHectares(1000)).toBe(`${(1000).toLocaleString()} ha`)
    expect(formatHectares(1234.6)).toBe(`${(1235).toLocaleString()} ha`)
    expect(formatHectares(1234.5)).toBe(`${(1235).toLocaleString()} ha`)
    expect(formatHectares(1234.4)).toBe(`${(1234).toLocaleString()} ha`)
  })
})

describe("runSummaryObject", () => {
  it("returns no keys for a summary that is absent, blank, unparseable or not an object", () => {
    expect(runSummaryObject(undefined)).toEqual({})
    expect(runSummaryObject(null)).toEqual({})
    expect(runSummaryObject("")).toEqual({})
    expect(runSummaryObject("  ")).toEqual({})
    expect(runSummaryObject("{")).toEqual({})
    // null parses, and every caller reads a key straight off the result.
    expect(runSummaryObject("null")).toEqual({})
    expect(runSummaryObject("42")).toEqual({})
    expect(runSummaryObject('"solar_terrain"')).toEqual({})
  })

  it("hands back every key the row carries, including ones no reader knows", () => {
    // The point of the raw reader: callers pick keys out of it by name, so a
    // key added by a newer writer must survive rather than be filtered against
    // a fixed schema.
    expect(
      runSummaryObject('{"solar_product":"solar_siting","tilt_deg":21,"future":true}')
    ).toEqual({ solar_product: "solar_siting", tilt_deg: 21, future: true })
  })
})

describe("solarProductLabel", () => {
  it("names each raster product by its stored tag", () => {
    expect(solarProductLabel('{"solar_product":"solar_terrain"}')).toBe(
      "Terrain and horizon shading"
    )
    expect(solarProductLabel('{"solar_product":"solar_siting"}')).toBe(
      "Photovoltaic siting"
    )
  })

  it("names an energy run from the tag prefix, so a renamed tag keeps the label", () => {
    // Prefix, not equality: the module states this is what keeps a renamed
    // energy tag from being listed as a resource run with a resource run's
    // figures.
    expect(solarProductLabel('{"solar_product":"energy"}')).toBe(
      "Photovoltaic energy model"
    )
    expect(solarProductLabel('{"solar_product":"energy_model"}')).toBe(
      "Photovoltaic energy model"
    )
    expect(solarProductLabel('{"solar_product":"energy_pv_v2"}')).toBe(
      "Photovoltaic energy model"
    )
  })

  it("calls a run without a usable tag a solar resource run", () => {
    // A row written before solar_product existed carries none, and that row is
    // a resource run -- so the fallback is a statement about those rows, not a
    // shrug. The prefix is a prefix and not a substring: solar_energy is not
    // an energy run.
    expect(solarProductLabel(undefined)).toBe("Solar resource")
    expect(solarProductLabel(null)).toBe("Solar resource")
    expect(solarProductLabel("")).toBe("Solar resource")
    expect(solarProductLabel("{}")).toBe("Solar resource")
    expect(solarProductLabel('{"solar_product":null}')).toBe("Solar resource")
    expect(solarProductLabel('{"solar_product":3}')).toBe("Solar resource")
    expect(solarProductLabel('{"solar_product":"solar_resource"}')).toBe(
      "Solar resource"
    )
    expect(solarProductLabel('{"solar_product":"solar_energy"}')).toBe(
      "Solar resource"
    )
  })
})

describe("modelDisplayName", () => {
  it("spells out the classification model kinds the store records", () => {
    expect(modelDisplayName("temporal_transformer")).toBe("Temporal Transformer")
    expect(modelDisplayName("prithvi")).toBe("Prithvi-EO 2.0")
    expect(modelDisplayName("spectral")).toBe("Random Forest")
    // The empty kind is the oldest rows, which were all Random Forest.
    expect(modelDisplayName("")).toBe("Random Forest")
  })

  it("returns an unrecognised kind unchanged rather than calling it Random Forest", () => {
    // The failure the module names: a solar run recorded as NASA POWER was
    // listed as a classification produced by a model that never ran.
    expect(modelDisplayName("NASA POWER")).toBe("NASA POWER")
    expect(modelDisplayName("nasa_power_merra2")).toBe("nasa_power_merra2")
    expect(modelDisplayName("Prithvi")).toBe("Prithvi")
  })
})

describe("runRowLine", () => {
  const period = { period_start: "2024-01-01", period_end: "2024-03-31" }

  it("gives a water run its index and its observed acquisition extent", () => {
    expect(
      runRowLine({
        kind: "water",
        model_kind: "ndwi",
        ...period,
        summary: '{"date_range":["2024-01-05","2024-03-28"]}',
      })
    ).toBe("Surface water · ndwi · 2024-01-05 → 2024-03-28")
  })

  it("ends a water run at its index when no acquisition extent was recorded", () => {
    // The whole reason for the Boolean filter: an absent extent must not leave
    // the row ending in a separator with nothing after it.
    expect(
      runRowLine({ kind: "water", model_kind: "ndwi", ...period, summary: null })
    ).toBe("Surface water · ndwi")
    expect(
      runRowLine({ kind: "water", model_kind: "ndwi", ...period, summary: "{}" })
    ).toBe("Surface water · ndwi")
  })

  it("names a water run's index generically when the row records none", () => {
    expect(
      runRowLine({ kind: "water", model_kind: "", ...period, summary: null })
    ).toBe("Surface water · index")
  })

  it("gives a solar run its product and source and no acquisition window at all", () => {
    // A climatology has no observed window, so the row carries none even when
    // the requested period is set on the run.
    expect(
      runRowLine({
        kind: "solar",
        model_kind: "NASA POWER",
        ...period,
        summary: '{"solar_product":"energy_pv","date_range":["2024-01-05","2024-03-28"]}',
      })
    ).toBe("Photovoltaic energy model · NASA POWER")
  })

  it("names a solar run's source generically when the row records none", () => {
    expect(
      runRowLine({ kind: "solar", model_kind: "", ...period, summary: null })
    ).toBe("Solar resource · NASA POWER")
  })

  it("gives a wind run its record window from the summary", () => {
    expect(
      runRowLine({
        kind: "wind",
        model_kind: "NASA POWER MERRA-2",
        ...period,
        summary: '{"record_window":"2001-2020"}',
      })
    ).toBe("Wind screening · NASA POWER MERRA-2 · 2001-2020")
  })

  it("ends a wind run at its source when the record window is absent or blank", () => {
    const wind = { kind: "wind", model_kind: "", ...period }
    expect(runRowLine({ ...wind, summary: null })).toBe(
      "Wind screening · NASA POWER MERRA-2"
    )
    expect(runRowLine({ ...wind, summary: "{}" })).toBe(
      "Wind screening · NASA POWER MERRA-2"
    )
    expect(runRowLine({ ...wind, summary: '{"record_window":"   "}' })).toBe(
      "Wind screening · NASA POWER MERRA-2"
    )
    expect(runRowLine({ ...wind, summary: '{"record_window":2001}' })).toBe(
      "Wind screening · NASA POWER MERRA-2"
    )
  })

  it("gives a flood run its reference threshold in place of a period", () => {
    // The envelope reads terrain and has no acquisition window at all, so the
    // requested period on the run is not what the row states.
    expect(
      runRowLine({
        kind: "flood",
        model_kind: "Planetary Computer DEM",
        ...period,
        summary: '{"flood_reference_threshold_m":1}',
      })
    ).toBe("Flood envelope · Planetary Computer DEM · HAND <= 1 m")
  })

  it("ends a flood run at its source when no reference threshold was recorded", () => {
    const flood = { kind: "flood", model_kind: "", ...period }
    expect(runRowLine({ ...flood, summary: null })).toBe(
      "Flood envelope · Planetary Computer DEM"
    )
    expect(runRowLine({ ...flood, summary: "{}" })).toBe(
      "Flood envelope · Planetary Computer DEM"
    )
    // A threshold stored as text is not a threshold. Printing it would put an
    // unvalidated string where a measured height belongs.
    expect(
      runRowLine({ ...flood, summary: '{"flood_reference_threshold_m":"1"}' })
    ).toBe("Flood envelope · Planetary Computer DEM")
  })

  it("keeps a reference threshold of zero, which is the drainage surface", () => {
    // Zero is a value here: HAND <= 0 m asks for the drainage surface itself.
    // A truthiness test would drop it and describe the run as thresholdless.
    expect(
      runRowLine({
        kind: "flood",
        model_kind: "Planetary Computer DEM",
        ...period,
        summary: '{"flood_reference_threshold_m":0}',
      })
    ).toBe("Flood envelope · Planetary Computer DEM · HAND <= 0 m")
  })

  it("prefers a classification run's observed extent over the window it requested", () => {
    // The requested window is what the operator asked for; the observed extent
    // is what the archive held. The row states the second.
    expect(
      runRowLine({
        model_kind: "prithvi",
        ...period,
        summary: '{"date_range":["2024-01-05","2024-03-28"]}',
      })
    ).toBe("Prithvi-EO 2.0 · 2024-01-05 → 2024-03-28")
  })

  it("falls back to a classification run's requested window when no extent was stored", () => {
    expect(
      runRowLine({ model_kind: "temporal_transformer", ...period, summary: null })
    ).toBe("Temporal Transformer · 2024-01-01 → 2024-03-31")
    // A kind the switch does not name is still a classification row.
    expect(
      runRowLine({ kind: "classification", model_kind: "spectral", ...period })
    ).toBe("Random Forest · 2024-01-01 → 2024-03-31")
  })

  it("gives a classification run its model alone when neither window is complete", () => {
    expect(
      runRowLine({
        model_kind: "spectral",
        period_start: "2024-01-01",
        period_end: "",
      })
    ).toBe("Random Forest")
    expect(runRowLine({ model_kind: "", period_start: "", period_end: "" })).toBe(
      "Random Forest"
    )
  })
})

describe("runKindLabel", () => {
  it("returns the one-word product name for each kind the store writes", () => {
    expect(runKindLabel("water")).toBe("water")
    expect(runKindLabel("solar")).toBe("solar")
    expect(runKindLabel("wind")).toBe("wind")
    expect(runKindLabel("flood")).toBe("flood")
  })

  it("labels a row with no kind a classification rather than an unknown product", () => {
    // Rows predate the kind column; the module states those rows are
    // classifications, so the fallback names a product that exists.
    expect(runKindLabel(undefined)).toBe("class")
    expect(runKindLabel("")).toBe("class")
    expect(runKindLabel("classification")).toBe("class")
  })
})

describe("datesByMonth", () => {
  it("cuts both ends of a period to their month", () => {
    // 23 characters is the width the module names as the one that truncated
    // the area column beside it; the month form is six shorter.
    const full = "2024-01-05 → 2024-03-31"
    expect(full).toHaveLength(23)
    expect(datesByMonth(full)).toBe("2024-01 → 2024-03")
  })

  it("cuts the dates inside a row line and leaves the rest of it alone", () => {
    expect(datesByMonth("Surface water · ndwi · 2024-01-05 → 2024-03-28")).toBe(
      "Surface water · ndwi · 2024-01 → 2024-03"
    )
  })

  it("leaves text carrying no full ISO date unchanged", () => {
    // A month already cut has no day to remove, and a row with no period at
    // all must survive the pass untouched.
    expect(datesByMonth("2024-01 → 2024-03")).toBe("2024-01 → 2024-03")
    expect(datesByMonth("Photovoltaic energy model · NASA POWER")).toBe(
      "Photovoltaic energy model · NASA POWER"
    )
    expect(datesByMonth("")).toBe("")
  })
})
