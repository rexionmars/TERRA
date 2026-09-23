/**
 * Table definitions for the analysis data views.
 *
 * Column names, order and value formatting mirror backend/export_research.go,
 * which writes the same tables into the research pack ZIP. What the application
 * shows on screen and what it exports must be the same table, so a figure read
 * here can be cited from the exported CSV without re-deriving it.
 *
 * Edit both together. The CSV file name on each definition is the file the Go
 * writer produces, and backend/export_parity_test.go reads this file to check
 * the names, the column keys and their order still agree with the Go writer's
 * researchTableColumns. The row-construction rules are not covered by that
 * check and are restated on each definition that has one.
 */
import type {
  ClassStat,
  DomainFingerprint,
  FloodAnalysis,
  WaterAnalysis,
  LULCAnalysis,
  PhenologyMetrics,
  PhenologyStatePoint,
  PredictResult,
  TemporalPoint,
  VISeriesPoint,
} from "@/lib/types"

export type CellValue = string | number | null | undefined

export interface TableColumn {
  /** Column name, identical to the CSV header written by the Go exporter. */
  key: string
  /** Right-align and use the monospace face for numeric columns. */
  numeric?: boolean
  /** Render a colour swatch from this cell's hex value instead of the text. */
  swatch?: boolean
}

export interface DataTable {
  id: string
  /** File name in the research pack; the anchor for parity with Go. */
  csvName: string
  columns: TableColumn[]
  rows: CellValue[][]
}

/**
 * Go writes floats with strconv.FormatFloat(v, 'f', -1, 64): the shortest
 * decimal that round-trips, with no exponent and no thousands separator.
 * JavaScript's default number-to-string is also shortest-round-trip but uses
 * exponential notation outside 1e-7..1e21, so those are expanded here.
 */
export function formatNumber(v: CellValue): string {
  if (v === null || v === undefined || v === "") return ""
  if (typeof v === "string") return v
  if (!Number.isFinite(v)) return ""
  const s = String(v)
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/)
  if (!m) return s
  // Expand the exponent by moving the point, rather than toFixed, which is
  // itself exponential at or above 1e21.
  const [, sign, intPart, fracPart = "", expPart] = m
  const exp = Number(expPart)
  const digits = intPart + fracPart
  if (exp >= 0) {
    const point = intPart.length + exp
    return (
      sign +
      (point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
    )
  }
  return `${sign}0.${"0".repeat(-exp - intPart.length)}${digits}`
}

function table(
  id: string,
  csvName: string,
  columns: TableColumn[],
  rows: CellValue[][]
): DataTable | null {
  return rows.length ? { id, csvName, columns, rows } : null
}

const num = (key: string): TableColumn => ({ key, numeric: true })

/**
 * A flag that may not have been recorded.
 *
 * Null stays null so the cell comes out empty, matching the Go writer's
 * formatBoolPtr: a fact nobody recorded is not the same as a fact that is
 * false, and the flood tables are the ones where the difference decides
 * whether a figure compares terrain alone.
 */
const boolCell = (v: boolean | null | undefined): CellValue =>
  v === null || v === undefined ? null : String(v)

export function classStatsTable(stats: ClassStat[]): DataTable | null {
  return table(
    "class_stats",
    "class_stats.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pixels"),
      num("pct"),
      num("area_ha"),
    ],
    (stats ?? []).map((c) => [
      c.class_id,
      c.name,
      c.color,
      c.pixels,
      c.pct,
      c.area_ha,
    ])
  )
}

export function viSeriesTable(series: VISeriesPoint[]): DataTable | null {
  return table(
    "vi_series",
    "vi_series.csv",
    [
      { key: "date" },
      num("ndvi_mean"),
      num("ndvi_std"),
      num("evi_mean"),
      num("evi_std"),
      num("savi_mean"),
      num("savi_std"),
    ],
    (series ?? []).map((p) => [
      p.date,
      p.ndvi_mean,
      p.ndvi_std,
      p.evi_mean,
      p.evi_std,
      p.savi_mean,
      p.savi_std,
    ])
  )
}

/** True when at least one metric is present; matches hasPhenology in Go. */
export function hasPhenology(ph?: PhenologyMetrics | null): boolean {
  if (!ph) return false
  return [
    ph.sos_doy,
    ph.pos_doy,
    ph.eos_doy,
    ph.los_days,
    ph.peak,
    ph.base,
    ph.amplitude,
  ].some((v) => v !== null && v !== undefined)
}

export function phenologyTable(
  ph?: PhenologyMetrics | null
): DataTable | null {
  if (!hasPhenology(ph) || !ph) return null
  return table(
    "phenology",
    "phenology.csv",
    [
      num("sos_doy"),
      num("pos_doy"),
      num("eos_doy"),
      num("los_days"),
      num("peak"),
      num("base"),
      num("amplitude"),
    ],
    [
      [
        ph.sos_doy,
        ph.pos_doy,
        ph.eos_doy,
        ph.los_days,
        ph.peak,
        ph.base,
        ph.amplitude,
      ],
    ]
  )
}

export function phenologyStatesTable(
  states: PhenologyStatePoint[]
): DataTable | null {
  return table(
    "phenology_states",
    "phenology_states.csv",
    [
      { key: "date" },
      num("state"),
      { key: "state_name" },
      { key: "color", swatch: true },
      num("ndvi_mean"),
    ],
    (states ?? []).map((s) => [
      s.date,
      s.state,
      s.state_name,
      s.color,
      s.ndvi_mean,
    ])
  )
}

export function temporalTable(points: TemporalPoint[]): DataTable | null {
  return table(
    "temporal",
    "temporal.csv",
    [
      { key: "date" },
      num("n_dates_stack"),
      num("soja_ndvi_mean"),
      num("soja_retention_pct"),
      { key: "dominant" },
    ],
    (points ?? []).map((t) => [
      t.date,
      t.n_dates_stack,
      t.soja_ndvi_mean,
      t.soja_retention_pct,
      t.dominant ?? "",
    ])
  )
}

export function lulcMetricsTable(lulc?: LULCAnalysis | null): DataTable | null {
  if (!lulc?.metrics) return null
  const m = lulc.metrics
  return table(
    "lulc_metrics",
    "lulc_metrics.csv",
    [
      num("year"),
      { key: "source" },
      num("area_ha"),
      num("n_pixels"),
      num("n_classes"),
      num("shannon_h"),
      num("pielou_j"),
      { key: "dominant_class" },
      num("dominant_pct"),
      num("soja_pct"),
      num("outras_lav_pct"),
      num("agricola_pct"),
    ],
    [
      [
        lulc.year,
        lulc.source,
        m.area_ha,
        m.n_pixels,
        m.n_classes,
        m.shannon_h,
        m.pielou_j,
        m.dominant_class,
        m.dominant_pct,
        m.soja_pct,
        m.outras_lav_pct,
        m.agricola_pct,
      ],
    ]
  )
}

export function lulcCompositionTable(
  lulc?: LULCAnalysis | null
): DataTable | null {
  return table(
    "lulc_composition",
    "lulc_composition.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      { key: "group" },
      num("pixels"),
      num("pct"),
      num("area_ha"),
    ],
    (lulc?.composition ?? []).map((c) => [
      c.class_id,
      c.name,
      c.color,
      c.group,
      c.pixels,
      c.pct,
      c.area_ha,
    ])
  )
}

export function lulcGroupsTable(lulc?: LULCAnalysis | null): DataTable | null {
  return table(
    "lulc_groups",
    "lulc_groups.csv",
    [
      { key: "group" },
      { key: "color", swatch: true },
      num("pct"),
      num("area_ha"),
    ],
    (lulc?.groups ?? []).map((g) => [g.group, g.color, g.pct, g.area_ha])
  )
}

export function lulcPredVsRefTable(
  lulc?: LULCAnalysis | null
): DataTable | null {
  return table(
    "lulc_pred_vs_ref",
    "lulc_pred_vs_ref.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pct_ref"),
      num("pct_pred"),
      // pixels_ref counts 10 m pixels; n_reference_cells counts the native 30 m
      // MapBiomas cells behind them, which is the agreement sample size.
      num("pixels_ref"),
      num("n_reference_cells"),
    ],
    (lulc?.pred_vs_ref ?? []).map((r) => [
      r.class_id,
      r.name,
      r.color,
      r.pct_ref,
      r.pct_pred,
      r.pixels_ref ?? 0,
      r.n_reference_cells ?? 0,
    ])
  )
}

/** Summary of the classify-time domain fingerprint (no raw sample matrix). */
export function domainFingerprintTable(
  fp?: DomainFingerprint | null
): DataTable | null {
  if (!fp?.mean?.length) return null
  let meanL2 = 0
  for (const v of fp.mean) meanL2 += v * v
  meanL2 = Math.sqrt(meanL2)
  let entropy = 0
  for (const p of fp.ndvi_hist?.probs ?? []) {
    if (p > 0) entropy -= p * Math.log(p)
  }
  return table(
    "domain_fingerprint",
    "domain_fingerprint.csv",
    [
      { key: "space" },
      num("n_features"),
      num("n_pixels"),
      num("n_sample"),
      num("mean_l2"),
      num("ndvi_hist_entropy"),
    ],
    [[fp.space, fp.n_features, fp.n_pixels, fp.n_sample, meanL2, entropy]]
  )
}

export function waterSeriesTable(
  water?: WaterAnalysis | null
): DataTable | null {
  return table(
    "water_series",
    "water_series.csv",
    [
      { key: "date" },
      { key: "scene_id" },
      num("cloud_cover"),
      // The denominator of water_fraction_pct: AOI pixels seen on that date.
      num("observed_pixels"),
      num("threshold_fixed"),
      num("threshold_otsu"),
      { key: "threshold_clipped" },
      { key: "threshold_degenerate" },
      num("water_fraction_pct"),
      num("water_fraction_otsu_pct"),
      num("water_pixels"),
      num("area_ha"),
    ],
    (water?.series ?? []).map((d) => [
      d.date,
      d.scene_id,
      d.cloud_cover,
      d.observed_pixels,
      d.threshold_fixed,
      d.threshold_otsu,
      String(d.threshold_clipped),
      String(d.threshold_degenerate),
      d.water_fraction_pct,
      d.water_fraction_otsu_pct,
      d.water_pixels,
      d.area_ha,
    ])
  )
}

/*
  THE FLOOD TABLES ARE THE EVIDENCE, NOT THE PRODUCT. The product is the
  agreement count raster -- for each cell, how many DEM products call it
  flooded -- and it is not a table: reduced to a histogram it stops saying
  WHERE the products disagree, which is the one thing the analysis measures.
  The raster travels in the research pack as rasters/flood_agreement.tif, and
  these three tables carry what a reader can recompute from numbers.

  Empty cells here are undefined, never zero. `resampled` is written as an
  empty cell when the fact was not recorded, which is not the same as false,
  and the two indices have no value over two empty extents.
*/

/**
 * One DEM product's extent at the reference threshold.
 *
 * The threshold is not a column because every row shares it; it is in the
 * manifest, and an area read from this file without it names no extent. Areas
 * are cell counts times the cell size over the cells inside the AOI polygon,
 * which is what area_frac is a fraction of. The buffered window the terrain
 * chain ran over is several times that ground and nothing here is measured
 * against it.
 */
export function floodProductsTable(
  flood?: FloodAnalysis | null
): DataTable | null {
  return table(
    "flood_products",
    "flood_products.csv",
    [
      { key: "id" },
      { key: "collection" },
      num("native_resolution_m"),
      { key: "resampled" },
      num("cells"),
      num("area_km2"),
      num("area_frac"),
    ],
    (flood?.products ?? []).map((p) => [
      p.id,
      p.collection,
      p.native_resolution_m,
      boolCell(p.resampled),
      p.cells,
      p.area_km2,
      p.area_frac,
    ])
  )
}

/**
 * Every unordered pair at every threshold.
 *
 * iou is the Jaccard index between the two binary extents, which for a binary
 * mask is numerically the critical success index (CSI) of the flood
 * literature. Both columns are over the AOI polygon: iou_inset repeats the
 * comparison over the AOI shrunk by the inset margin, and a wide gap between
 * the two places the disagreement at the border of the reported area, where
 * the contributing area is short of whatever drains in from beyond the buffer
 * and HAND reads high.
 */
export function floodPairsTable(
  flood?: FloodAnalysis | null
): DataTable | null {
  return table(
    "flood_pairs",
    "flood_pairs.csv",
    [
      { key: "dem_a" },
      { key: "dem_b" },
      num("threshold_m"),
      num("iou"),
      num("iou_inset"),
      num("area_ratio_b_over_a"),
      { key: "resampled" },
    ],
    (flood?.pairs ?? []).map((p) => [
      p.dem_a,
      p.dem_b,
      p.threshold_m,
      p.iou,
      p.iou_inset,
      p.area_ratio_b_over_a,
      boolCell(p.resampled),
    ])
  )
}

/**
 * The range the products span at each threshold.
 *
 * TERRA's own measurement over its own DEM set, and not the range the study
 * this ports published over a different set from a different catalogue. The
 * manifest carries the sentence that says so, and these numbers cannot be
 * quoted without it.
 */
export function floodEnvelopeTable(
  flood?: FloodAnalysis | null
): DataTable | null {
  return table(
    "flood_envelope",
    "flood_envelope.csv",
    [
      num("threshold_m"),
      num("iou_min"),
      num("iou_max"),
      num("iou_min_inset"),
      num("iou_max_inset"),
    ],
    (flood?.envelope ?? []).map((e) => [
      e.threshold_m,
      e.iou_min,
      e.iou_max,
      e.iou_min_inset,
      e.iou_max_inset,
    ])
  )
}

/** Every table a result can produce, in the order the ZIP writes them. */
export function allAnalysisTables(result: PredictResult): DataTable[] {
  return [
    classStatsTable(result.class_stats ?? []),
    viSeriesTable(result.vi_series ?? []),
    phenologyTable(result.phenology),
    phenologyStatesTable(result.phenology_states ?? []),
    temporalTable(result.temporal ?? []),
    lulcMetricsTable(result.lulc),
    lulcCompositionTable(result.lulc),
    lulcGroupsTable(result.lulc),
    lulcPredVsRefTable(result.lulc),
    domainFingerprintTable(result.domain_fingerprint),
    waterSeriesTable(result.water),
    floodProductsTable(result.flood),
    floodPairsTable(result.flood),
    floodEnvelopeTable(result.flood),
  ].filter((t): t is DataTable => t !== null)
}

/** RFC 4180 quoting, matching encoding/csv on the Go side. */
export function tableToCSV(t: DataTable): string {
  const esc = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const lines = [t.columns.map((c) => esc(c.key)).join(",")]
  for (const row of t.rows) {
    lines.push(row.map((cell) => esc(formatNumber(cell))).join(","))
  }
  return lines.join("\n")
}
