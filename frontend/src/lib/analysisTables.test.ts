/**
 * The row-construction rules in analysisTables.ts, measured against what each
 * definition states rather than against the module's own output.
 *
 * backend/export_parity_test.go already reads that module and fails when a
 * table's name, its column keys or their order stop agreeing with the Go
 * writer. It says nothing about what goes IN a row, and that is where the
 * rules are: a class with no area is dropped rather than written as zero, a
 * month carrying fewer than 24 hours is padded rather than shortened, a
 * threshold flag is written as text, a missing count becomes 0 while a missing
 * measurement stays empty. Any of those could invert with the parity check
 * still green, and the exported CSV would carry a number that reads as a
 * measurement.
 *
 * Every expected value here is derived from the definition's own statement or
 * worked out by hand: the L2 norm from its components, the entropy from
 * -sum p ln p, the expansions from the power of ten they name, the widths from
 * the column lists. None was read off this module's output.
 */
import { describe, expect, it } from "vitest"
import {
  allAnalysisTables,
  classStatsTable,
  domainFingerprintTable,
  energyDeclaredLossesTable,
  energyExceedanceTable,
  energyGenerationProfileTable,
  energyLossWaterfallTable,
  energyPlantCapacityTable,
  formatNumber,
  hasPhenology,
  lulcCompositionTable,
  lulcGroupsTable,
  lulcMetricsTable,
  lulcPredVsRefTable,
  phenologyStatesTable,
  phenologyTable,
  solarMonthlyTable,
  solarSitingTable,
  solarTerrainTable,
  solarTiltToleranceTable,
  tableToCSV,
  temporalTable,
  viSeriesTable,
  waterSeriesTable,
  windDirectionRoseTable,
  windMonthlySpeedTable,
  windShearSensitivityTable,
  type CellValue,
  type DataTable,
} from "./analysisTables"
import type {
  ClassStat,
  DomainFingerprint,
  EnergyModelAnalysis,
  EnergyPlant,
  LULCAnalysis,
  PhenologyMetrics,
  PredictResult,
  SolarTerrainAnalysis,
  WaterAnalysis,
  WindAnalysis,
} from "./types"

/**
 * A response carrying only the fields the builder under test reads.
 *
 * The energy and wind payloads hold several hundred fields each and these
 * builders read a handful. A fixture restating the rest would be pages of
 * numbers no assertion mentions, and the one field a test IS about would be
 * indistinguishable from them. The names and value types stay under the
 * compiler -- a renamed field still fails the build -- and the cast is
 * confined to the one line below.
 *
 * A fragment must still carry every field the builder dereferences. These
 * types declare their arrays non-nullable, so the builders guard the payload
 * itself and not the path below it, and an omitted branch is a TypeError
 * rather than a fallback.
 */
type Fragment<T> = T extends readonly (infer U)[]
  ? Fragment<U>[]
  : T extends object
    ? { [K in keyof T]?: Fragment<T[K]> }
    : T

function fragment<T>(parts: Fragment<T>): T {
  return parts as unknown as T
}

describe("formatNumber", () => {
  it("returns an empty field for an absent value, whatever shape it arrives in", () => {
    // Three spellings of absence reach the same cell: Go's nil pointer decodes
    // to null, an unset optional is undefined, and a text column that was
    // never filled is the empty string.
    expect(formatNumber(null)).toBe("")
    expect(formatNumber(undefined)).toBe("")
    expect(formatNumber("")).toBe("")
  })

  it("returns an empty field for a value no decimal notation can carry", () => {
    expect(formatNumber(NaN)).toBe("")
    expect(formatNumber(Infinity)).toBe("")
    expect(formatNumber(-Infinity)).toBe("")
  })

  it("distinguishes a zero measurement from an absent one", () => {
    // The pair the export depends on: a threshold of 0 is a threshold, and a
    // reader who cannot tell it from a blank has lost the measurement.
    expect(formatNumber(0)).toBe("0")
    expect(formatNumber(null)).toBe("")
  })

  it("passes a text cell through, exponent notation included", () => {
    // The expansion below is for numbers the payload carries as numbers. A
    // string was written by whoever built the row -- a date, a flag, a note --
    // and rewriting it would corrupt a value this function cannot interpret.
    expect(formatNumber("2024-03-01")).toBe("2024-03-01")
    expect(formatNumber("true")).toBe("true")
    expect(formatNumber("1e+21")).toBe("1e+21")
  })

  it("writes a number inside the plain-notation range unchanged", () => {
    expect(formatNumber(42)).toBe("42")
    expect(formatNumber(-1234.5)).toBe("-1234.5")
    expect(formatNumber(0.1)).toBe("0.1")
    // The last magnitude JavaScript spells out on its own: 10^20 is a 1
    // followed by 20 zeros, one short of the exponent threshold.
    expect(formatNumber(1e20)).toBe("1" + "0".repeat(20))
  })

  it("expands the exponent JavaScript introduces at 10^21, which Go's 'f' format never writes", () => {
    // 10^21 is a 1 followed by 21 zeros; 1.5 x 10^21 is 15 followed by 20.
    // Left as "1e+21" the field would not parse as a number in a spreadsheet
    // column the rest of which is plain decimal, and would not match the Go
    // writer for the same value.
    expect(formatNumber(1e21)).toBe("1" + "0".repeat(21))
    expect(formatNumber(1.5e21)).toBe("15" + "0".repeat(20))
    expect(formatNumber(-1e21)).toBe("-1" + "0".repeat(21))
    expect(formatNumber(6.02e23)).toBe("602" + "0".repeat(21))
    for (const v of [1e21, 1.5e21, -1e21, 6.02e23]) {
      expect(formatNumber(v)).not.toMatch(/e/i)
    }
  })

  it("expands the exponent JavaScript introduces below 10^-7", () => {
    // 10^-7 is a point, six zeros and the digit; 1.25 x 10^-7 carries its
    // three digits after the same six zeros; 2.5 x 10^-8 needs seven.
    expect(formatNumber(1e-6)).toBe("0.000001")
    expect(formatNumber(1e-7)).toBe("0.0000001")
    expect(formatNumber(1.25e-7)).toBe("0.000000125")
    expect(formatNumber(-2.5e-8)).toBe("-0.000000025")
    for (const v of [1e-7, 1.25e-7, -2.5e-8]) {
      expect(formatNumber(v)).not.toMatch(/e/i)
    }
  })

  it("writes every magnitude back to the value it came from", () => {
    // The property the whole function exists for: the field is the shortest
    // decimal that round-trips. Expanding by moving the point rather than by
    // rounding to a fixed width is what keeps this true at the extremes --
    // 5e-324 has 324 places and toFixed caps at 100.
    for (const v of [0, 42, -1234.5, 0.1, 1e20, 1e21, 1.5e21, 6.02e23, 1e-7, 5e-324]) {
      expect(Number(formatNumber(v)), String(v)).toBe(v)
    }
  })
})

describe("tableToCSV", () => {
  const table: DataTable = {
    id: "demo",
    csvName: "demo.csv",
    columns: [{ key: "date" }, { key: "label, short" }, { key: "value", numeric: true }],
    rows: [
      ["2024-01-05", 'he said "yes"', 1e21],
      [null, "a,b", null],
      ["line one\nline two", "carriage\rreturn", -0.5],
    ],
  }

  it("writes the column keys as the first line and one line per row", () => {
    const plain: DataTable = {
      id: "plain",
      csvName: "plain.csv",
      columns: [{ key: "date" }, { key: "value", numeric: true }],
      rows: [
        ["2024-01-05", 1],
        ["2024-01-06", 2],
      ],
    }
    expect(tableToCSV(plain).split("\n")).toEqual([
      "date,value",
      "2024-01-05,1",
      "2024-01-06,2",
    ])
  })

  it("quotes only the fields RFC 4180 requires it to, and doubles an inner quote", () => {
    // A comma, a quote or either line-break character inside a field is the
    // whole reason for quoting; anything else quoted as well would still
    // parse, but would no longer match what encoding/csv writes on the Go
    // side for the same row.
    //
    // The third row is why the whole document is compared rather than its
    // lines counted: a quoted newline is still one record, so this table of
    // three rows is five lines long and any reader splitting on the newline
    // reads two rows that were never written.
    expect(tableToCSV(table)).toBe(
      [
        'date,"label, short",value',
        '2024-01-05,"he said ""yes""",' + "1" + "0".repeat(21),
        ',"a,b",',
        '"line one\nline two","carriage\rreturn",-0.5',
      ].join("\n")
    )
  })

  it("writes a null cell as an empty field rather than the word null", () => {
    const line = tableToCSV(table).split("\n")[2]
    expect(line.startsWith(",")).toBe(true)
    expect(line.endsWith(",")).toBe(true)
  })
})

describe("hasPhenology", () => {
  const absent: PhenologyMetrics = {
    sos_doy: null,
    pos_doy: null,
    eos_doy: null,
    los_days: null,
    peak: null,
    base: null,
    amplitude: null,
  }

  it("is false for a missing block and for one whose every metric is null", () => {
    expect(hasPhenology(undefined)).toBe(false)
    expect(hasPhenology(null)).toBe(false)
    expect(hasPhenology(absent)).toBe(false)
  })

  it("is true when any single metric is present", () => {
    const keys = Object.keys(absent) as (keyof PhenologyMetrics)[]
    expect(keys).toHaveLength(7)
    for (const key of keys) {
      expect(hasPhenology({ ...absent, [key]: 1 }), key).toBe(true)
    }
  })

  it("treats a metric of zero as present, not as an absence", () => {
    // A baseline index of zero is a fitted value. Read as falsy it would drop
    // the whole table, and the six metrics beside it with it.
    expect(hasPhenology({ ...absent, base: 0 })).toBe(true)
  })
})

describe("phenologyTable", () => {
  const absent: PhenologyMetrics = {
    sos_doy: null,
    pos_doy: null,
    eos_doy: null,
    los_days: null,
    peak: null,
    base: null,
    amplitude: null,
  }

  it("returns null when no metric was fitted", () => {
    expect(phenologyTable(undefined)).toBeNull()
    expect(phenologyTable(absent)).toBeNull()
  })

  it("writes one row of seven metrics, keeping the ones that were not fitted empty", () => {
    const t = phenologyTable({ ...absent, sos_doy: 245, pos_doy: 310, peak: 0.78 })
    expect(t?.rows).toEqual([[245, 310, null, null, 0.78, null, null]])
    expect(t?.csvName).toBe("phenology.csv")
  })
})

describe("the empty-section gate", () => {
  it("returns null rather than a table of headings with no rows", () => {
    // A section a run did not produce must be absent, not present and empty.
    // An empty table reaches the research pack as a CSV holding one header
    // line, which reads as a measurement that came back with nothing in it.
    expect(classStatsTable([])).toBeNull()
    expect(viSeriesTable([])).toBeNull()
    expect(phenologyStatesTable([])).toBeNull()
    expect(temporalTable([])).toBeNull()
    expect(lulcCompositionTable(null)).toBeNull()
    expect(lulcGroupsTable(undefined)).toBeNull()
    expect(lulcPredVsRefTable(null)).toBeNull()
    expect(lulcMetricsTable(null)).toBeNull()
    expect(domainFingerprintTable(null)).toBeNull()
    expect(waterSeriesTable(null)).toBeNull()
    expect(solarMonthlyTable(null)).toBeNull()
    expect(solarTiltToleranceTable(undefined)).toBeNull()
    expect(solarTerrainTable(null)).toBeNull()
    expect(solarSitingTable(null)).toBeNull()
    expect(energyLossWaterfallTable(null)).toBeNull()
    expect(energyDeclaredLossesTable(undefined)).toBeNull()
    expect(energyExceedanceTable(null)).toBeNull()
    expect(energyPlantCapacityTable(null)).toBeNull()
    expect(windMonthlySpeedTable(null)).toBeNull()
    expect(windDirectionRoseTable(undefined)).toBeNull()
    expect(windShearSensitivityTable(null)).toBeNull()
  })

  it("returns a table as soon as one row exists", () => {
    const stat: ClassStat = {
      class_id: 3,
      name: "Soja",
      color: "#ffbb00",
      pixels: 51250,
      pct: 58.4,
      area_ha: 512.5,
    }
    const t = classStatsTable([stat])
    expect(t?.id).toBe("class_stats")
    expect(t?.csvName).toBe("class_stats.csv")
    expect(t?.rows).toEqual([[3, "Soja", "#ffbb00", 51250, 58.4, 512.5]])
    // The colour is rendered as a swatch and the four figures right-aligned;
    // the name is the one column that is neither.
    expect(t?.columns.filter((c) => c.swatch).map((c) => c.key)).toEqual(["color"])
    expect(t?.columns.filter((c) => c.numeric).map((c) => c.key)).toEqual([
      "class_id",
      "pixels",
      "pct",
      "area_ha",
    ])
  })
})

describe("temporalTable", () => {
  it("writes an absent dominant class as text and an unmeasured index as empty", () => {
    // The two absences are not the same absence. No dominant class is a
    // statement about the date; no NDVI mean is a date the crop pixels were
    // not seen on, and a 0 there would be read as bare ground.
    const t = temporalTable([
      { date: "2024-01-05", n_dates_stack: 4, soja_ndvi_mean: null, soja_retention_pct: null, dominant: null },
      { date: "2024-02-06", n_dates_stack: 5, soja_ndvi_mean: 0.71, soja_retention_pct: 92.4, dominant: "Soja" },
    ])
    expect(t?.rows).toEqual([
      ["2024-01-05", 4, null, null, ""],
      ["2024-02-06", 5, 0.71, 92.4, "Soja"],
    ])
  })
})

describe("the LULC tables", () => {
  const lulc: LULCAnalysis = {
    year: 2023,
    source: "MapBiomas Collection 9",
    metrics: {
      area_ha: 512.5,
      n_pixels: 51250,
      n_classes: 4,
      shannon_h: 1.02,
      pielou_j: 0.73,
      dominant_class: "Soja",
      dominant_pct: 58.4,
      soja_pct: 58.4,
      outras_lav_pct: 6.1,
      agricola_pct: 64.5,
    },
    composition: [],
    groups: [],
    pred_vs_ref: [],
  }

  it("takes the year and the source of the metrics row from the analysis, not from the metrics", () => {
    // Both name the reference map rather than a measurement over it, so they
    // sit on the analysis. Dropped from the row, the ten figures beside them
    // would be a composition of no stated collection and no stated year.
    const t = lulcMetricsTable(lulc)
    expect(t?.rows).toEqual([
      [2023, "MapBiomas Collection 9", 512.5, 51250, 4, 1.02, 0.73, "Soja", 58.4, 58.4, 6.1, 64.5],
    ])
    expect(t?.rows[0]).toHaveLength(t?.columns.length ?? 0)
  })

  it("writes a metrics row even when the composition it summarises is empty", () => {
    expect(lulcMetricsTable(lulc)).not.toBeNull()
    expect(lulcCompositionTable(lulc)).toBeNull()
  })

  it("writes an absent reference count as zero, which is what it counted", () => {
    // pixels_ref and n_reference_cells are absent on runs saved before they
    // were carried. Zero is the honest reading -- no reference cell was
    // counted -- and an empty field in a count column would be taken for a
    // count that failed rather than one that was never made.
    const t = lulcPredVsRefTable({
      ...lulc,
      pred_vs_ref: [
        { class_id: 3, name: "Soja", color: "#ffbb00", pct_ref: 58.4, pct_pred: 61.2 },
        {
          class_id: 12,
          name: "Forest formation",
          color: "#1f8d49",
          pct_ref: 20.0,
          pct_pred: 18.5,
          pixels_ref: 900,
          n_reference_cells: 100,
        },
      ],
    })
    expect(t?.rows).toEqual([
      [3, "Soja", "#ffbb00", 58.4, 61.2, 0, 0],
      [12, "Forest formation", "#1f8d49", 20.0, 18.5, 900, 100],
    ])
  })

  it("writes one row per group with the four columns the groups table declares", () => {
    const t = lulcGroupsTable({
      ...lulc,
      groups: [{ group: "Agricola", color: "#ffbb00", pct: 64.5, area_ha: 330.6 }],
    })
    expect(t?.rows).toEqual([["Agricola", "#ffbb00", 64.5, 330.6]])
  })
})

describe("domainFingerprintTable", () => {
  const base: DomainFingerprint = {
    space: "reflectance",
    n_features: 2,
    n_pixels: 40000,
    n_sample: 2048,
    mean: [3, -4],
    var: [0.1, 0.2],
  }

  it("returns null when the fingerprint carries no mean vector", () => {
    // n_features and n_pixels alone are not a fingerprint: the two derived
    // figures are the row, and without the vector both are zero.
    expect(domainFingerprintTable(undefined)).toBeNull()
    expect(domainFingerprintTable({ ...base, mean: [] })).toBeNull()
  })

  it("reduces the mean vector to its Euclidean norm", () => {
    // sqrt(3^2 + (-4)^2) = 5. A sum of absolute values would give 7 here, and
    // a sum of the components 1, so the 3-4-5 triangle separates all three.
    expect(domainFingerprintTable(base)?.rows[0][4]).toBe(5)
  })

  it("reports the NDVI histogram as Shannon entropy in nats", () => {
    // -sum p ln p. Two equal bins is ln 2 and four equal bins ln 4, which is
    // the property that makes the figure a spread rather than a count: it
    // depends on how the mass is divided and not on how many bins exist.
    const twoBins = domainFingerprintTable({
      ...base,
      ndvi_hist: { edges: [-1, 0, 1], counts: [50, 50], probs: [0.5, 0.5] },
    })
    expect(twoBins?.rows[0][5] as number).toBeCloseTo(0.6931471805599453, 12)

    const fourBins = domainFingerprintTable({
      ...base,
      ndvi_hist: {
        edges: [-1, -0.5, 0, 0.5, 1],
        counts: [25, 25, 25, 25],
        probs: [0.25, 0.25, 0.25, 0.25],
      },
    })
    expect(fourBins?.rows[0][5] as number).toBeCloseTo(1.3862943611198906, 12)
  })

  it("skips an empty bin instead of returning NaN for the whole histogram", () => {
    // p ln p tends to 0 as p tends to 0, but 0 * ln 0 evaluates to NaN and one
    // empty bin would carry that through the sum and blank the column. An
    // empty bin beside two equal ones must leave the entropy at ln 2.
    const t = domainFingerprintTable({
      ...base,
      ndvi_hist: { edges: [-1, 0, 0.5, 1], counts: [50, 50, 0], probs: [0.5, 0.5, 0] },
    })
    expect(Number.isNaN(t?.rows[0][5] as number)).toBe(false)
    expect(t?.rows[0][5] as number).toBeCloseTo(0.6931471805599453, 12)
  })

  it("reports zero entropy for one bin holding everything, and for no histogram at all", () => {
    // The two are different statements and the column cannot tell them apart,
    // which is why the histogram sits beside it in the payload.
    const oneBin = domainFingerprintTable({
      ...base,
      ndvi_hist: { edges: [-1, 0, 1], counts: [100, 0], probs: [1, 0] },
    })
    expect(oneBin?.rows[0][5]).toBe(0)
    expect(domainFingerprintTable(base)?.rows[0][5]).toBe(0)
  })

  it("writes the counts through unchanged beside the two derived figures", () => {
    expect(domainFingerprintTable(base)?.rows).toEqual([
      ["reflectance", 2, 40000, 2048, 5, 0],
    ])
  })
})

describe("waterSeriesTable", () => {
  it("writes the two threshold flags as text and keeps a threshold of zero a number", () => {
    // The flags are booleans in the payload and a column of true/false in the
    // export, matching strconv.FormatBool. A fixed threshold of 0 is a real
    // index cut-off and must not arrive as an empty field.
    const t = waterSeriesTable(
      fragment<WaterAnalysis>({
        series: [
          {
            date: "2024-02-11",
            scene_id: "S2A_20240211",
            cloud_cover: 3.2,
            observed_pixels: 10450,
            threshold_fixed: 0,
            threshold_otsu: 0.12,
            threshold_clipped: true,
            threshold_degenerate: false,
            water_fraction_pct: 12.5,
            water_fraction_otsu_pct: 13.1,
            water_pixels: 1306,
            area_ha: 130.6,
          },
        ],
      })
    )
    expect(t?.rows).toEqual([
      ["2024-02-11", "S2A_20240211", 3.2, 10450, 0, 0.12, "true", "false", 12.5, 13.1, 1306, 130.6],
    ])
    expect(t?.rows[0]).toHaveLength(t?.columns.length ?? 0)
  })
})

describe("solarTerrainTable", () => {
  const layer = {
    season: "annual",
    unit: "kWh/m2/year",
    poa_min: 1810.5,
    poa_max: 1902.25,
    poa_mean: 1866,
    poa_std_pct: 1.2,
    slope_mean_deg: 3.4,
    slope_max_deg: 11.9,
    pixels: 4096,
    dem_source: "Copernicus GLO-30",
    hourly_years: 5,
    shading_mean_pct: null,
    shading_max_pct: null,
    beam_fraction: 0.62,
    horizon_max_dist_m: 5000,
  } satisfies Fragment<SolarTerrainAnalysis>

  it("returns null for a layer covering no pixel", () => {
    // Zero pixels is the boundary: the row would be a set of statistics over
    // an empty sample, every one of them a placeholder.
    expect(solarTerrainTable(fragment<SolarTerrainAnalysis>({ ...layer, pixels: 0 }))).toBeNull()
    expect(solarTerrainTable(fragment<SolarTerrainAnalysis>({ ...layer, pixels: 1 }))).not.toBeNull()
  })

  it("names the layer and its unit in the first two columns rather than in the value ones", () => {
    // The value columns are not always an irradiation -- the shading layer
    // carries a blocked fraction -- so what the four numbers are is read off
    // `layer` and `unit` and not off a column name.
    const t = solarTerrainTable(
      fragment<SolarTerrainAnalysis>({
        ...layer,
        season: "shading",
        unit: "% of beam",
        sky_view: null,
      })
    )
    expect(t?.columns.slice(0, 6).map((c) => c.key)).toEqual([
      "layer",
      "unit",
      "value_min",
      "value_max",
      "value_mean",
      "value_std_pct",
    ])
    expect(t?.rows[0].slice(0, 6)).toEqual(["shading", "% of beam", 1810.5, 1902.25, 1866, 1.2])
  })

  it("leaves the six sky-view columns empty when the layer carries no sky view", () => {
    const t = solarTerrainTable(fragment<SolarTerrainAnalysis>({ ...layer, sky_view: null }))
    expect(t?.rows).toEqual([
      [
        "annual",
        "kWh/m2/year",
        1810.5,
        1902.25,
        1866,
        1.2,
        3.4,
        11.9,
        4096,
        "Copernicus GLO-30",
        5,
        null,
        null,
        0.62,
        5000,
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ])
    expect(t?.rows[0]).toHaveLength(21)
    expect(t?.rows[0]).toHaveLength(t?.columns.length ?? 0)
    // An unmeasured shading loss is carried as null and an absent sky view as
    // the empty string; both reach the CSV as the same empty field, which is
    // what keeps the row readable against the Go writer's output.
    expect(formatNumber(t?.rows[0][11])).toBe(formatNumber(t?.rows[0][16]))
  })

  it("says whether the sky-view correction was applied, which is not the same as its size", () => {
    // "not applied" and "applied at zero" are different statements about the
    // terrain, so the flag is written even when the two losses are absent.
    const notApplied = solarTerrainTable(
      fragment<SolarTerrainAnalysis>({
        ...layer,
        sky_view: {
          applied: false,
          mean_horizon_deg: 4.5,
          max_horizon_deg: 18,
          threshold_deg: 3,
          diffuse_loss_mean_pct: null,
          diffuse_loss_max_pct: null,
        },
      })
    )
    expect(notApplied?.rows[0].slice(15)).toEqual(["no", 4.5, 18, 3, "", ""])

    const applied = solarTerrainTable(
      fragment<SolarTerrainAnalysis>({
        ...layer,
        sky_view: {
          applied: true,
          mean_horizon_deg: 4.5,
          max_horizon_deg: 18,
          threshold_deg: 3,
          diffuse_loss_mean_pct: 0.8,
          diffuse_loss_max_pct: 2.1,
        },
      })
    )
    expect(applied?.rows[0].slice(15)).toEqual(["yes", 4.5, 18, 3, 0.8, 2.1])
  })
})

describe("energyGenerationProfileTable", () => {
  const profile = (mean_ac_w_kwp: number[], month = 1) =>
    energyGenerationProfileTable(
      fragment<EnergyModelAnalysis>({
        generation_profile: {
          mean_ac_power_by_month_and_hour: { rows: [{ month, mean_ac_w_kwp }] },
        },
      })
    )

  it("writes the month and 24 hour columns whatever the month carried", () => {
    // Every row must line up under the same 24 headings, so the width is a
    // property of the table and not of the month.
    const short = profile([0, 12.5, 40])
    const full = profile(Array.from({ length: 24 }, (_, h) => h))
    expect(short?.columns).toHaveLength(25)
    expect(short?.rows[0]).toHaveLength(25)
    expect(full?.rows[0]).toHaveLength(25)
    // A month arriving with more than 24 values cannot widen the row either:
    // the extra cells would sit under no heading at all.
    expect(profile(Array.from({ length: 26 }, (_, h) => h))?.rows[0]).toHaveLength(25)
  })

  it("pads a month carrying fewer than 24 hours rather than dropping it", () => {
    // 24 - 3 = 21 empty cells after the three that were measured. Dropped, the
    // month would be missing from the matrix; shortened, its remaining values
    // would sit under the wrong hour.
    const t = profile([0, 12.5, 40])
    expect(t?.rows[0]).toEqual([1, 0, 12.5, 40, ...Array<CellValue>(21).fill(null)])
  })

  it("keeps all 24 hours of a full month in the order they arrived", () => {
    const hours = Array.from({ length: 24 }, (_, h) => h * 10)
    expect(profile(hours, 6)?.rows[0]).toEqual([6, ...hours])
  })
})

describe("energyExceedanceTable", () => {
  it("repeats the convention and the uncertainty statement on every level", () => {
    // The level column is a bare integer. Read on its own it carries neither
    // the convention that puts P90 BELOW P50 -- the opposite of the statistical
    // percentile -- nor what the band leaves out, and a row lifted out of the
    // CSV would invert.
    const convention = "P90 is the value exceeded in 90 percent of years"
    const statement = "Excludes model and soiling uncertainty"
    const t = energyExceedanceTable(
      fragment<EnergyModelAnalysis>({
        plant: {
          exceedance: {
            convention,
            levels: [
              {
                level: 50,
                ghi_empirical_kwh_m2_year: 1900,
                factor_empirical: 1,
                ghi_normal_kwh_m2_year: 1898.5,
                factor_normal: 0.999,
                normal_fit_standard_error_kwh_m2: 42.5,
              },
              {
                level: 90,
                ghi_empirical_kwh_m2_year: 1845.2,
                factor_empirical: 0.971,
                ghi_normal_kwh_m2_year: 1843.8,
                factor_normal: 0.97,
                normal_fit_standard_error_kwh_m2: 42.5,
              },
            ],
          },
          uncertainty: { statement },
        },
      })
    )
    expect(t?.rows).toEqual([
      [50, 1900, 1, 1898.5, 0.999, 42.5, convention, statement],
      [90, 1845.2, 0.971, 1843.8, 0.97, 42.5, convention, statement],
    ])
  })
})

describe("energyPlantCapacityTable", () => {
  const AREAS_NOTE = "The three areas are never summed"
  const STATEMENT = "P50 to P90 spans resource variability only"

  const sited = {
    label: "Suitable, no conflict",
    area_ha: 412.5,
    capacity_dc_mw: 165,
    capacity_ac_mw: 127,
    specific_yield_kwh_kwp_year: 1520,
    energy: {
      p50_exceedance_gwh_year: 250.8,
      p75_exceedance_gwh_year: 243.1,
      p90_exceedance_gwh_year: 236.4,
    },
    contiguity: { largest_ha: 300.25, n_patches: 7 },
    reporting_basis: "DC",
    performance_ratio: 0.82,
    performance_ratio_source: "reference",
    note: "Ceiling on resource and land only",
  } satisfies Fragment<EnergyPlant["suitable"]>

  const plant = (parts: Fragment<EnergyPlant>) =>
    energyPlantCapacityTable(fragment<EnergyModelAnalysis>({ plant: parts }))

  it("omits a class with no area rather than writing it as a row of zeros", () => {
    // Exactly zero is the boundary on both guards. A zero row states that the
    // class was assessed and came out empty, which is the same thing a reader
    // would take from a capacity of 0 MW over 0 ha.
    expect(
      plant({
        suitable: { area_ha: 0 },
        cropland_conflict: { area_ha: 0 },
        restrictive: { area_ha: 0 },
        areas_note: AREAS_NOTE,
        uncertainty: { statement: STATEMENT },
      })
    ).toBeNull()
  })

  it("writes one row per class that has area, in the order suitable, conflict, restrictive", () => {
    const t = plant({
      suitable: { ...sited, area_ha: 412.5 },
      cropland_conflict: { ...sited, label: "On cropland", area_ha: 88 },
      restrictive: { label: "Restrictive slope", area_ha: 96.5, capacity_dc_mw: null, note: "Needs other racking" },
      areas_note: AREAS_NOTE,
      uncertainty: { statement: STATEMENT },
    })
    expect(t?.rows.map((r) => r[0])).toEqual(["suitable", "cropland_conflict", "restrictive"])
    for (const row of t?.rows ?? []) {
      expect(row).toHaveLength(17)
      expect(row).toHaveLength(t?.columns.length ?? 0)
    }
  })

  it("carries the class figures, the never-summed note and the band statement on a sited row", () => {
    const t = plant({
      suitable: sited,
      cropland_conflict: { area_ha: 0 },
      restrictive: { area_ha: 0 },
      areas_note: AREAS_NOTE,
      uncertainty: { statement: STATEMENT },
    })
    expect(t?.rows).toEqual([
      [
        "suitable",
        "Suitable, no conflict",
        412.5,
        165,
        127,
        1520,
        250.8,
        243.1,
        236.4,
        300.25,
        7,
        "DC",
        0.82,
        "reference",
        "Ceiling on resource and land only",
        AREAS_NOTE,
        STATEMENT,
      ],
    ])
  })

  it("leaves the restrictive row's capacity and energy empty and drops the band statement", () => {
    // This class needs racking the capacity density references do not cover,
    // so it has no capacity figure at all -- empty, never 0, which would be a
    // capacity that was computed. With no energy on the row, the exceedance
    // band statement does not describe anything on it either.
    const t = plant({
      suitable: { area_ha: 0 },
      cropland_conflict: { area_ha: 0 },
      restrictive: { label: "Restrictive slope", area_ha: 96.5, capacity_dc_mw: null, note: "Needs other racking" },
      areas_note: AREAS_NOTE,
      uncertainty: { statement: STATEMENT },
    })
    expect(t?.rows).toEqual([
      [
        "restrictive",
        "Restrictive slope",
        96.5,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "Needs other racking",
        AREAS_NOTE,
        "",
      ],
    ])
    // The area is still a measurement and the note still applies: only the
    // twelve figures the class cannot carry are empty.
    expect(formatNumber(t?.rows[0][2])).toBe("96.5")
    expect(t?.rows[0][15]).toBe(AREAS_NOTE)
  })
})

describe("windShearSensitivityTable", () => {
  const wind = (excluded_losses: string[]) =>
    windShearSensitivityTable(
      fragment<WindAnalysis>({
        hub: { excluded_losses },
        shear_sensitivity: [
          {
            shear_exponent: 0.143,
            roughness_length_m: null,
            basis: "record",
            hub_speed_ms: 7.2,
            capacity_factor_pct: 31.4,
            annual_energy_mwh: 8200,
          },
          {
            shear_exponent: 0.2,
            roughness_length_m: 0.1,
            basis: "assumed",
            hub_speed_ms: 7.9,
            capacity_factor_pct: 35.1,
            annual_energy_mwh: 9160,
          },
        ],
      })
    )

  it("joins the excluded losses with a semicolon and repeats them on every row", () => {
    // Semicolon, not comma: the field would otherwise need quoting in the CSV.
    // Repeated because "capacity_factor_pct" and "annual_energy_mwh" read on
    // their own give no sign that no plant loss is applied and that the energy
    // is one turbine's.
    const t = wind(["wake", "availability", "electrical"])
    expect(t?.rows.map((r) => r[6])).toEqual([
      "wake; availability; electrical",
      "wake; availability; electrical",
    ])
    expect(tableToCSV(t as DataTable)).not.toContain('"')
  })

  it("leaves the column empty when no loss list came back", () => {
    expect(wind([])?.rows.map((r) => r[6])).toEqual(["", ""])
  })

  it("leaves the roughness empty on the row derived from the record itself", () => {
    // That row inverts the record to a roughness rather than assuming one, so
    // there is no assumed length to report. A 0 there would read as open water.
    const t = wind([])
    expect(t?.rows[0][1]).toBeNull()
    expect(t?.rows[1][1]).toBe(0.1)
    expect(tableToCSV(t as DataTable).split("\n")[1]).toBe("0.143,,record,7.2,31.4,8200,")
  })
})

describe("allAnalysisTables", () => {
  const empty: PredictResult = {
    extent: { lon_min: -53.1, lat_min: -25.5, lon_max: -53, lat_max: -25.4 },
    overlay_uri: "",
    confidence_uri: "",
    ndvi_mean_uri: "",
    true_color_uri: "",
    reference_uri: "",
    raster_tif: "",
    mean_confidence: 0.82,
    n_dates: 0,
    date_range: null,
    class_stats: null,
    temporal: null,
    vi_series: null,
    phenology: {
      sos_doy: null,
      pos_doy: null,
      eos_doy: null,
      los_days: null,
      peak: null,
      base: null,
      amplitude: null,
    },
    phenology_states: null,
  }

  it("returns nothing for a result that produced no section", () => {
    // Go marshals a nil slice as null and a run that classified nothing --
    // a water or solar run -- leaves every one of them nil. Taken as
    // guaranteed arrays, one of these once blanked the whole application.
    expect(allAnalysisTables(empty)).toEqual([])
  })

  it("returns only the sections the result carries, in the order the ZIP writes them", () => {
    const tables = allAnalysisTables({
      ...empty,
      class_stats: [
        { class_id: 3, name: "Soja", color: "#ffbb00", pixels: 51250, pct: 58.4, area_ha: 512.5 },
      ],
      lulc: {
        year: 2023,
        source: "MapBiomas Collection 9",
        metrics: {
          area_ha: 512.5,
          n_pixels: 51250,
          n_classes: 4,
          shannon_h: 1.02,
          pielou_j: 0.73,
          dominant_class: "Soja",
          dominant_pct: 58.4,
          soja_pct: 58.4,
          outras_lav_pct: 6.1,
          agricola_pct: 64.5,
        },
        composition: [],
        groups: [],
        pred_vs_ref: [],
      },
      wind: fragment<WindAnalysis>({
        measured: {
          monthly_mean_speed_50m: [{ month: 1, mean_speed_ms: 5.4 }],
          direction_energy_rose_50m: [],
        },
        hub: { excluded_losses: [] },
        shear_sensitivity: [],
      }),
    })
    expect(tables.map((t) => t.id)).toEqual(["class_stats", "lulc_metrics", "wind_monthly_speed"])
  })

  it("names every table after the file the research pack writes it to", () => {
    // The CSV name is the anchor the Go parity check reads; a table whose id
    // and file name disagree would be exported under a name nothing verifies.
    for (const t of allAnalysisTables({
      ...empty,
      class_stats: [
        { class_id: 3, name: "Soja", color: "#ffbb00", pixels: 51250, pct: 58.4, area_ha: 512.5 },
      ],
      phenology: {
        sos_doy: 245,
        pos_doy: 310,
        eos_doy: 25,
        los_days: 145,
        peak: 0.78,
        base: 0.21,
        amplitude: 0.57,
      },
    })) {
      expect(t.csvName).toBe(t.id + ".csv")
    }
  })
})
