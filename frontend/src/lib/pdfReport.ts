/**
 * The PDF report's document: what the compositor's PDF report node sends to
 * the sidecar (sidecar/terra/report), which lays it out and does nothing else.
 *
 * EVERY NUMBER IS FORMATTED HERE. The rows are the Field table's own
 * (lib/fieldTable.ts), built from what the graph evaluated -- the class areas
 * after its filters, each field's season, departure, registers, passes and
 * zones -- so a figure in the PDF is the figure on the card. The template
 * receives strings and draws them; a change of rounding is made in this file.
 *
 * WHAT IT SAYS IS WHAT THE RUNS RECORD. The method text is methodBrief's, the
 * one the band shows before a run, fed the run's recorded period and model and
 * told that the cloud ceiling is not recorded, rather than the band's current
 * setting presented as the run's. The summary sentences state counts and
 * ranges with the condition they were measured under; none of them judges.
 */
import { band } from "@/lib/health"
import { methodBrief, type MethodBrief } from "@/lib/methodBrief"
import type { BoardToolId } from "@/lib/mapTools"
import { classifiedTotal, dominant, type FieldRow } from "@/lib/fieldTable"
import type { Season, SeasonMark } from "@/lib/season"
import type { Bounds, ModelKind } from "@/lib/types"
import type { PdfReportSettings } from "@/lib/pdfReportSettings"

export const PDF_REPORT_SCHEMA = 1

export { PDF_REPORT_DEFAULT, type PdfReportSettings } from "@/lib/pdfReportSettings"

/** A run the report reads, as the store recorded it. */
export interface PdfReportRun {
  id: string
  /** The store's run kind: classification, health, overlap, radar, zones, ... */
  kind: string
  title: string
  modelKind: string
  periodStart: string
  periodEnd: string
  created: string
}

/** A raster as the compositor drew it, and what is needed to read it as a map. */
export interface PdfReportFigure {
  title: string
  caption: string
  /** PNG data URI. */
  uri: string
  width: number
  height: number
  extent: Bounds | null
  legend: { label: string; color: string }[]
  /** Class maps are drawn without interpolation, as on the globe. */
  pixelated: boolean
  /** Sensor, period and run the raster comes from. */
  source: string
}

export interface PdfReportInput {
  settings: PdfReportSettings
  /** The Field table's rows: one per field of a set, or the one run's. */
  rows: readonly FieldRow[]
  /** The area a field set covers; null where the node reads one run. */
  areaName: string | null
  /** The season drawn as a chart, and whose it is. */
  season: { field: string; season: Season } | null
  figures: readonly PdfReportFigure[]
  runs: readonly PdfReportRun[]
  appVersion: string
  now: Date
}

// The document's shape; sidecar/terra/report/document.py checks the same one.
export interface PdfReportDocument {
  schema: number
  meta: {
    title: string
    subtitle: string
    number: string
    revision: string
    issued: string
    status: "draft" | "released"
    owner: string
    recipient: string
    author: string
    approver: string
    app_version: string
    generated_at: string
  }
  question: string
  scope: string
  summary: string[]
  provenance: { label: string; value: string }[]
  method: { product: string; subtitle: string; source: string; sections: { title: string; lines: string[]; note: string }[] }[]
  figures: {
    title: string
    caption: string
    uri: string
    aspect: number
    legend: { label: string; color: string }[]
    pixelated: boolean
    /** Sensor, period and run the raster comes from, printed under the map. */
    source: string
    /** The cartographic elements, where the raster's extent is known. */
    map: MapSheet | null
  }[]
  series: {
    title: string
    caption: string
    x_label: string
    y_label: string
    x_range: [number, number]
    y_range: [number, number]
    x_ticks: { at: number; label: string }[]
    y_ticks: { at: number; label: string }[]
    points: { x: number; y: number }[]
    marks: { x: number; label: string }[]
  }[]
  tables: { title: string; caption: string; columns: { label: string; align?: "right" }[]; rows: string[][] }[]
  limitations: { label: string; text: string }[]
  runs: { id: string; kind: string; period: string; created: string }[]
  references: string[]
}

// --- formatting -------------------------------------------------------------

const DASH = "—"
const fixed = (v: number | null | undefined, digits: number) =>
  v == null || !Number.isFinite(v) ? DASH : v.toFixed(digits)
const ha = (v: number | null | undefined) => fixed(v, 1)
const pct = (share: number | null | undefined, digits = 1) =>
  share == null || !Number.isFinite(share) ? DASH : `${(share * 100).toFixed(digits)}%`
const signed = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? DASH : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listed = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`

/** A season mark with the observations it lies between: "2025-11-02 (10-28–11-06)". */
function markCell(m: SeasonMark | null): string {
  if (!m) return DASH
  return m.from === m.to ? m.date : `${m.date} (${m.from.slice(5)}–${m.to.slice(5)})`
}

const DAY = 86_400_000
const at = (d: string) => Date.parse(`${d}T00:00:00Z`)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const isoDay = (t: Date) => t.toISOString().slice(0, 10)
const isoMinute = (t: Date) => t.toISOString().slice(0, 16).replace("T", " ")

// --- products ---------------------------------------------------------------

type Product = "classes" | "season" | "health" | "overlap" | "radar" | "zones"

const PRODUCT_NAME: Record<Product, string> = {
  classes: "Land cover",
  season: "Season",
  health: "Vegetation health",
  overlap: "Socio-environmental overlap",
  radar: "Sentinel-1 radar",
  zones: "Management zones",
}

/** The products whose columns hold at least one value. */
export function productsIn(rows: readonly FieldRow[]): Product[] {
  const has = (p: (r: FieldRow) => unknown) => rows.some((r) => p(r) != null)
  return (
    [
      ["classes", (r: FieldRow) => r.classes],
      ["season", (r: FieldRow) => r.season],
      ["health", (r: FieldRow) => r.health],
      ["overlap", (r: FieldRow) => r.overlap],
      ["radar", (r: FieldRow) => r.radar],
      ["zones", (r: FieldRow) => r.zones],
    ] as const
  )
    .filter(([, get]) => has(get))
    .map(([p]) => p)
}

/** The band's tool that runs each stored run kind; the method text is keyed on it. */
const TOOL_OF_KIND: Record<string, BoardToolId> = {
  classification: "classify",
  water: "water",
  mineral: "mineral",
  fields: "fields",
  health: "health",
  overlap: "overlap",
  radar: "radar",
  zones: "zones",
}

function methodOf(run: PdfReportRun): MethodBrief | null {
  const tool = TOOL_OF_KIND[run.kind || "classification"]
  if (!tool) return null
  return methodBrief({
    tool,
    modelKind: (run.modelKind || "spectral") as ModelKind,
    start: run.periodStart,
    end: run.periodEnd,
    maxCloud: null,
    monthlyBest: null,
  })
}

const PRODUCT_TITLE: Record<string, string> = {
  classification: "Land cover and season",
  water: "Surface water",
  mineral: "Mineral map",
  fields: "Field boundaries",
  health: "Vegetation health",
  overlap: "Socio-environmental overlap",
  radar: "Sentinel-1 radar",
  zones: "Management zones",
}

// --- figures and series -----------------------------------------------------

const M_PER_DEG = 111_320

/**
 * What the template needs to draw a raster as a map sheet: the neatline's
 * coordinate ticks, the scale, and the reference system.
 *
 * Positions are fractions of the map frame -- `at` from the left for a
 * meridian, from the top for a parallel -- because the frame's printed size is
 * decided by the template, and the numeric scale with it (from
 * `ground_width_m`, the frame's east-west length on the ground).
 */
export interface MapSheet {
  graticule: { lon: { at: number; label: string }[]; lat: { at: number; label: string }[] }
  ground_width_m: number
  /** A quarter of the frame or less; `ticks` label 0, half and the whole bar, the last with its unit. */
  scale_bar: { fraction: number; ticks: string[] }
  crs: string
}

/**
 * The frame's width over its height on the ground: an equirectangular plane
 * whose standard parallel is the extent's mid-latitude. The rasters are placed
 * by their lon/lat extent, so this is the shape they cover, whatever the pixel
 * grid they were written in.
 */
export function groundAspect(extent: Bounds): number {
  const mid = ((extent.lat_min + extent.lat_max) / 2) * (Math.PI / 180)
  const dLat = extent.lat_max - extent.lat_min
  return dLat > 0 ? ((extent.lon_max - extent.lon_min) * Math.cos(mid)) / dLat : 1
}

/**
 * A scale bar a quarter of the map wide or less, in a round length, measured
 * at the extent's mid-latitude. The maps are drawn by their lon/lat extent,
 * north up, so the east-west length is what the bar can state.
 */
export function scaleBar(
  extent: Bounds
): { fraction: number; label: string; ticks: string[]; groundWidthM: number } | null {
  const mid = ((extent.lat_min + extent.lat_max) / 2) * (Math.PI / 180)
  const widthM = (extent.lon_max - extent.lon_min) * M_PER_DEG * Math.cos(mid)
  if (!(widthM > 0)) return null
  const target = widthM / 4
  const pow = 10 ** Math.floor(Math.log10(target))
  const step = [5, 2, 1].map((k) => k * pow).find((v) => v <= target) ?? pow
  const km = step >= 1000
  const unit = km ? "km" : "m"
  const of = (m: number) => String(Number((km ? m / 1000 : m).toPrecision(6)))
  return {
    fraction: step / widthM,
    label: `${of(step)} ${unit}`,
    ticks: ["0", of(step / 2), `${of(step)} ${unit}`],
    groundWidthM: widthM,
  }
}

// Graticule intervals, in seconds of arc: the steps a topographic sheet uses.
const GRATICULE_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000]

/** A coordinate in degrees, minutes and seconds, to the precision its interval needs. */
export function dms(v: number, axis: "lon" | "lat", stepS: number): string {
  const hemi = axis === "lon" ? (v < 0 ? "W" : "E") : v < 0 ? "S" : "N"
  const a = Math.round(Math.abs(v) * 3600)
  const d = Math.floor(a / 3600)
  const m = Math.floor((a % 3600) / 60)
  const sec = a % 60
  const two = (n: number) => String(n).padStart(2, "0")
  if (stepS >= 3600) return `${d}°${hemi}`
  if (stepS >= 60) return `${d}°${two(m)}′${hemi}`
  return `${d}°${two(m)}′${two(sec)}″${hemi}`
}

/**
 * The meridians or parallels to tick along one side of the frame: the
 * smallest round interval that gives at most four, none within 4% of a corner
 * where its label would meet the other side's. In whole seconds, so the ticks
 * do not drift off their round values.
 */
export function graticule(min: number, max: number, axis: "lon" | "lat"): { at: number; label: string }[] {
  const span = max - min
  if (!(span > 0)) return []
  const inside = (stepS: number) => {
    const out: number[] = []
    for (let t = Math.ceil((min * 3600) / stepS) * stepS; t <= max * 3600; t += stepS) {
      const f = (t / 3600 - min) / span
      if (f >= 0.04 && f <= 0.96) out.push(t)
    }
    return out
  }
  const step = GRATICULE_S.find((s) => inside(s).length <= 4) ?? GRATICULE_S[GRATICULE_S.length - 1]
  return inside(step).map((t) => {
    const v = t / 3600
    const f = (v - min) / span
    return { at: axis === "lon" ? f : 1 - f, label: dms(v, axis, step) }
  })
}

/** What each run kind reads, as a map's source line names it. */
const SENSOR_OF_KIND: Record<string, string> = {
  classification: "Sentinel-2 L2A (Copernicus), classified by TERRA; MapBiomas legend",
  water: "Sentinel-2 L2A (Copernicus)",
  fields: "Sentinel-2 L2A (Copernicus)",
  health: "Sentinel-2 L2A (Copernicus)",
  zones: "Sentinel-2 L2A (Copernicus)",
  radar: "Sentinel-1 RTC (Copernicus, Planetary Computer)",
  mineral: "EMIT L2A reflectance (NASA LP DAAC), Tetracorder",
  overlap: "INPE TerraBrasilis, SICAR, IBAMA, FUNAI and MMA registers",
}

/**
 * A map's source line: what each run behind it read, over which period, and
 * the run, so a figure can be traced to the record that made it.
 */
export function mapSource(runs: readonly PdfReportRun[]): string {
  return runs
    .map((r) => {
      const kind = r.kind || "classification"
      const period = r.periodStart && r.periodEnd ? `, ${r.periodStart} to ${r.periodEnd}` : ""
      return `${SENSOR_OF_KIND[kind] ?? kind}${period} (run ${r.id.slice(0, 8)})`
    })
    .join("; ")
}

function mapSheet(extent: Bounds): MapSheet | null {
  const bar = scaleBar(extent)
  if (!bar) return null
  return {
    graticule: {
      lon: graticule(extent.lon_min, extent.lon_max, "lon"),
      lat: graticule(extent.lat_min, extent.lat_max, "lat"),
    },
    ground_width_m: bar.groundWidthM,
    scale_bar: { fraction: bar.fraction, ticks: bar.ticks },
    crs: "Geographic coordinates, datum WGS 84 (EPSG:4326)",
  }
}

function figureOf(f: PdfReportFigure): PdfReportDocument["figures"][number] {
  const map = f.extent ? mapSheet(f.extent) : null
  const integrity = map
    ? " Drawn by the raster's extent in an equirectangular plane at the mid-latitude, north up; the scales hold along that parallel."
    : " Its extent is not known, so it carries no coordinates and no scale."
  return {
    title: f.title,
    caption: `${f.caption}${integrity}`.trim(),
    uri: f.uri,
    aspect: map && f.extent ? groundAspect(f.extent) : f.width > 0 && f.height > 0 ? f.width / f.height : 1,
    legend: f.legend,
    pixelated: f.pixelated,
    source: f.source,
    map,
  }
}

/** The season's clear observations as a chart, days from the first, with its three marks. */
export function seasonSeries(field: string, s: Season): PdfReportDocument["series"][number] | null {
  const obs = s.observations
  if (obs.length < 2) return null
  const t0 = at(obs[0].date)
  const x = (d: string) => (at(d) - t0) / DAY
  const x1 = x(obs[obs.length - 1].date)
  if (!(x1 > 0)) return null
  const values = obs.map((o) => o.ndvi)
  const y0 = Math.min(0, Math.floor(Math.min(...values) * 5) / 5)
  const y1 = Math.max(1, Math.ceil(Math.max(...values) * 5) / 5)
  const yTicks: { at: number; label: string }[] = []
  for (let v = y0; v <= y1 + 1e-9; v += 0.2) yTicks.push({ at: Number(v.toFixed(1)), label: v.toFixed(1) })
  // First of each month inside the range; every other month past six.
  const first = new Date(t0)
  const months: number[] = []
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); (m.getTime() - t0) / DAY <= x1; m.setUTCMonth(m.getUTCMonth() + 1)) {
    months.push(m.getTime())
  }
  const every = months.length > 6 ? 2 : 1
  const xTicks = months
    .filter((_, i) => i % every === 0)
    .map((t) => {
      const d = new Date(t)
      const label = d.getUTCMonth() === 0 || t === months[0] ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()]
      return { at: (t - t0) / DAY, label }
    })
  const marks = (
    [
      ["rise", s.rise],
      ["peak", s.peak],
      ["fall", s.fall],
    ] as const
  )
    .filter(([, m]) => m != null && x(m.date) >= 0 && x(m.date) <= x1)
    .map(([label, m]) => ({ x: x(m!.date), label }))
  return {
    title: `NDVI through the season, ${field}.`,
    caption:
      `Mean NDVI of the field's clear observations (n = ${obs.length}), ${obs[0].date} to ${obs[obs.length - 1].date}. ` +
      "Dashed lines: rise, peak and fall, placed on the smoothed curve; each lies between the observations the season table lists.",
    x_label: "Date",
    y_label: "NDVI",
    x_range: [0, x1],
    y_range: [y0, y1],
    x_ticks: xTicks,
    y_ticks: yTicks,
    points: obs.map((o) => ({ x: x(o.date), y: o.ndvi })),
    marks,
  }
}

// --- tables -----------------------------------------------------------------

const R = { align: "right" as const }

function tablesOf(rows: readonly FieldRow[], products: readonly Product[]): PdfReportDocument["tables"] {
  const out: PdfReportDocument["tables"] = []
  const n = rows.length
  if (products.includes("classes")) {
    const unit = rows.some((r) => r.classes && r.unit === "px") ? "px" : "ha"
    out.push({
      title: "Land cover by field.",
      caption: `Area classified and its largest class, after the filters the compositor graph applies (n = ${plural(n, "field")}).`,
      columns: [{ label: "Field" }, { label: `Classified (${unit})`, ...R }, { label: "Largest class" }, { label: "Share", ...R }],
      rows: rows.map((r) => {
        const d = dominant(r)
        const total = classifiedTotal(r)
        return [r.field, unit === "ha" ? ha(total) : fixed(total, 0), d?.name ?? DASH, pct(d?.share)]
      }),
    })
  }
  if (products.includes("season")) {
    out.push({
      title: "Season dates by field.",
      caption:
        "Rise and fall are where the smoothed NDVI crossed half its amplitude; in brackets, the clear observations each lies between. " +
        "Mean confidence is the classifier's largest class probability averaged over the run, from 0 to 1.",
      columns: [
        { label: "Field" },
        { label: "Rise" },
        { label: "Peak" },
        { label: "Fall" },
        { label: "Days", ...R },
        { label: "Peak NDVI", ...R },
        { label: "Confidence", ...R },
      ],
      rows: rows.map((r) => [
        r.field,
        markCell(r.season?.rise ?? null),
        markCell(r.season?.peak ?? null),
        markCell(r.season?.fall ?? null),
        fixed(r.season?.lengthDays, 0),
        fixed(r.season?.peakNdvi, 2),
        fixed(r.confidence, 2),
      ]),
    })
  }
  if (products.includes("health")) {
    out.push({
      title: "Vegetation health by field.",
      caption:
        "The latest date with a reference, against the same days of earlier seasons, in standard deviations; " +
        "one and two standard deviations separate typical, below and well below.",
      columns: [
        { label: "Field" },
        { label: "Date" },
        { label: "NDVI", ...R },
        { label: "NDVI dep.", ...R },
        { label: "NDRE dep.", ...R },
        { label: "Reading" },
      ],
      rows: rows.map((r) => [
        r.field,
        r.health?.date ?? DASH,
        fixed(r.health?.ndvi, 2),
        signed(r.health?.ndviZ),
        signed(r.health?.ndreZ),
        r.health?.ndviZ != null ? band(r.health.ndviZ) : DASH,
      ]),
    })
  }
  if (products.includes("overlap")) {
    const readAt = [...new Set(rows.map((r) => r.overlap?.readAt).filter((x): x is string => !!x))]
    out.push({
      title: "Public registers under each field, in hectares.",
      caption:
        `Read at ${listed(readAt)} (UTC). PRODES clearing is split at 22 Jul 2008 and 31 Dec 2020; PRODES 2021 spans the second date. ` +
        `"Outside CAR" is the part of the field no CAR registration covers. A dash is a register not read, not zero.`,
      columns: [
        { label: "Field" },
        { label: "PRODES 2009–20", ...R },
        { label: "PRODES 2021", ...R },
        { label: "PRODES 2022–", ...R },
        { label: "DETER", ...R },
        { label: "Embargo IBAMA", ...R },
        { label: "Embargo ICMBio", ...R },
        { label: "Indig. land", ...R },
        { label: "Cons. unit", ...R },
        { label: "Outside CAR", ...R },
      ],
      rows: rows.map((r) => {
        const o = r.overlap
        return [
          r.field,
          ha(o?.prodes2009to2020),
          ha(o?.prodes2021),
          ha(o?.prodesFrom2022),
          ha(o?.deter),
          ha(o?.embargoIbama),
          ha(o?.embargoIcmbio),
          ha(o?.indigenous),
          ha(o?.conservation),
          ha(o?.carGap),
        ]
      }),
    })
  }
  if (products.includes("radar")) {
    out.push({
      title: "Sentinel-1 series by field.",
      caption:
        "Passes counted over the period; a canopy loss is a VH drop of at least 3 dB with the cross ratio falling by at least 1 dB, " +
        "placed between the two passes it fell between. Water share: the field read as open water on the latest pass.",
      columns: [
        { label: "Field" },
        { label: "Passes", ...R },
        { label: "Losses", ...R },
        { label: "Last loss between" },
        { label: "Latest pass" },
        { label: "Water share", ...R },
      ],
      rows: rows.map((r) => {
        const s = r.radar
        return [
          r.field,
          fixed(s?.passes, 0),
          fixed(s?.losses, 0),
          s?.lastLossFrom && s.lastLossTo ? `${s.lastLossFrom} and ${s.lastLossTo}` : DASH,
          s?.latestDate ?? DASH,
          pct(s?.latestWater),
        ]
      }),
    })
  }
  if (products.includes("zones")) {
    out.push({
      title: "Management zones by field.",
      caption:
        "The number of zones that ranks best on the fuzziness performance index (FPI) and the normalised classification entropy (NCE) together; " +
        "lower values of both separate more clearly.",
      columns: [
        { label: "Field" },
        { label: "Zones", ...R },
        { label: "FPI", ...R },
        { label: "NCE", ...R },
        { label: "Seasons used", ...R },
      ],
      rows: rows.map((r) => [
        r.field,
        fixed(r.zones?.suggestedK, 0),
        fixed(r.zones?.fpi, 3),
        fixed(r.zones?.nce, 3),
        fixed(r.zones?.seasonsUsed, 0),
      ]),
    })
  }
  return out
}

// --- summary ----------------------------------------------------------------

function summaryOf(rows: readonly FieldRow[], products: readonly Product[]): string[] {
  const out: string[] = []
  const n = rows.length
  const scope = n === 1 ? `In ${rows[0].field}` : `Across ${plural(n, "field")}`
  if (products.includes("classes")) {
    const totals = new Map<string, number>()
    let all = 0
    let unit: "ha" | "px" = "ha"
    for (const r of rows) {
      if (r.unit === "px") unit = "px"
      for (const c of r.classes ?? []) {
        totals.set(c.name, (totals.get(c.name) ?? 0) + c.amount)
        all += c.amount
      }
    }
    const [name, amount] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
    if (name != null && all > 0) {
      const size = unit === "ha" ? `${ha(all)} ha` : `${fixed(all, 0)} pixels`
      out.push(
        `${scope}, ${size} were classified into ${plural(totals.size, "class", "classes")}; the largest, ${name}, covers ${pct(amount! / all)} of it.`
      )
    }
  }
  if (products.includes("season")) {
    const peaks = rows.map((r) => r.season?.peak?.date).filter((d): d is string => !!d).sort()
    if (peaks.length) {
      out.push(
        peaks.length === 1
          ? `The NDVI peak falls on ${peaks[0]}${n > 1 ? ` in the one field with a season` : ""}.`
          : `NDVI peaks fall between ${peaks[0]} and ${peaks[peaks.length - 1]} in the ${peaks.length} fields with a season.`
      )
    }
  }
  if (products.includes("health")) {
    const read = rows.filter((r) => r.health?.ndviZ != null)
    const below = read.filter((r) => r.health!.ndviZ! <= -1)
    const well = read.filter((r) => r.health!.ndviZ! <= -2)
    if (read.length) {
      out.push(
        `On its latest date with a reference, NDVI is at least one standard deviation below the field's earlier seasons in ` +
          `${below.length} of ${read.length} fields, and at least two below in ${well.length}` +
          (well.length ? ` (${listed(well.map((r) => r.field))})` : "") +
          "."
      )
    }
  }
  if (products.includes("overlap")) {
    const regs: [string, (r: FieldRow) => number | null | undefined][] = [
      ["PRODES clearing after 22 Jul 2008", (r) => sum([r.overlap?.prodes2009to2020, r.overlap?.prodes2021, r.overlap?.prodesFrom2022])],
      ["DETER alerts", (r) => r.overlap?.deter],
      ["IBAMA embargoes", (r) => r.overlap?.embargoIbama],
      ["ICMBio embargoes", (r) => r.overlap?.embargoIcmbio],
      ["indigenous lands", (r) => r.overlap?.indigenous],
      ["conservation units", (r) => r.overlap?.conservation],
    ]
    const met = regs
      .map(([label, get]) => ({ label, fields: rows.filter((r) => (get(r) ?? 0) > 0), total: rows.reduce((s, r) => s + (get(r) ?? 0), 0) }))
      .filter((x) => x.fields.length)
    const unread = [...new Set(rows.flatMap((r) => r.overlap?.unread ?? []))]
    out.push(
      (met.length
        ? `Public registers other than CAR meet ${plural(new Set(met.flatMap((m) => m.fields.map((f) => f.field))).size, "field")}: ` +
          met.map((m) => `${m.label}, ${ha(m.total)} ha over ${plural(m.fields.length, "field")}`).join("; ") +
          "."
        : "No field meets PRODES clearing after 22 Jul 2008, DETER, an embargo, an indigenous land or a conservation unit among the registers read.") +
        (unread.length ? ` Not read: ${listed(unread)}.` : "")
    )
  }
  if (products.includes("radar")) {
    const withLoss = rows.filter((r) => (r.radar?.losses ?? 0) > 0)
    const read = rows.filter((r) => r.radar)
    out.push(`The Sentinel-1 series records at least one canopy loss in ${withLoss.length} of ${read.length} fields.`)
  }
  if (products.includes("zones")) {
    const ks = rows.map((r) => r.zones?.suggestedK).filter((k): k is number => k != null)
    const counts = [3, 4, 5].map((k) => [k, ks.filter((x) => x === k).length] as const).filter(([, c]) => c > 0)
    if (ks.length) {
      out.push(`The suggested number of management zones is ${counts.map(([k, c]) => `${k} in ${plural(c, "field")}`).join(", ")}.`)
    }
  }
  return out
}

function sum(xs: (number | null | undefined)[]): number | null {
  const known = xs.filter((x): x is number => x != null)
  return known.length ? known.reduce((s, x) => s + x, 0) : null
}

// --- limitations and references ----------------------------------------------

function limitationsOf(products: readonly Product[]): PdfReportDocument["limitations"] {
  const out: PdfReportDocument["limitations"] = []
  if (products.includes("classes")) {
    out.push(
      { label: "Resolution", text: "Sentinel-2 cells are 10 m (0.01 ha). A field's edge cells mix the field with what surrounds it." },
      {
        label: "Confidence",
        text: "Confidence is the probability the classifier gave its chosen class. A confidence of 0.67 does not mean 67% of such pixels are correct.",
      }
    )
  }
  if (products.includes("season")) {
    out.push({
      label: "Season dates",
      text: "NDVI marks emergence and senescence, not sowing and harvest. Each date lies between the clear observations around it, and cloud widens that window.",
    })
  }
  if (products.includes("health")) {
    out.push({
      label: "Departure",
      text: "A departure is not a diagnosis: a later sowing, another crop or a fallow field departs as a stressed one does. Earlier seasons of another crop in rotation shift the reference.",
    })
  }
  if (products.includes("overlap")) {
    out.push({
      label: "Registers",
      text:
        "The registers hold for the moment they were read. An overlap is not a finding of irregularity: a clearing can be authorised, an embargo lifted after publication. " +
        "APP and legal-reserve polygons are not published by WFS and are not read.",
    })
  }
  if (products.includes("radar")) {
    out.push({
      label: "Radar thresholds",
      text:
        "The canopy-loss rule (VH drop of 3 dB, cross-ratio drop of 1 dB) and the water rule (VH below −23 dB and VV below −13 dB) are fixed, and were not calibrated against harvest records.",
    })
  }
  if (products.includes("zones")) {
    out.push({
      label: "Zones",
      text: "The zones show where the canopy differed across seasons, not why: soil, drainage, compaction or a past management line draw the same boundary.",
    })
  }
  out.push({ label: "Field verification", text: "No figure in this report was verified on the ground by TERRA." })
  return out
}

const REFERENCES: Record<Product, string[]> = {
  classes: [],
  season: [
    "Savitzky, A., Golay, M. J. E. (1964). Smoothing and differentiation of data by simplified least squares procedures. Analytical Chemistry, 36(8), 1627–1639.",
  ],
  health: [
    "Gitelson, A. A., Merzlyak, M. N. (1994). Spectral reflectance changes associated with autumn senescence of Aesculus hippocastanum L. and Acer platanoides L. leaves. Journal of Plant Physiology, 143(3), 286–292.",
    "Rousseeuw, P. J., Croux, C. (1993). Alternatives to the median absolute deviation. Journal of the American Statistical Association, 88(424), 1273–1283.",
  ],
  overlap: [
    "Brazil (2012). Law No. 12,651 of 25 May 2012 (Forest Code).",
    "European Union (2023). Regulation (EU) 2023/1115 of the European Parliament and of the Council of 31 May 2023 on deforestation-free products.",
  ],
  radar: [
    "Lee, J.-S. (1980). Digital image enhancement and noise filtering by use of local statistics. IEEE Transactions on Pattern Analysis and Machine Intelligence, PAMI-2(2), 165–168.",
    "Veloso, A., Mermoz, S., Bouvet, A., Le Toan, T., Planells, M., Dejoux, J.-F., Ceschia, E. (2017). Understanding the temporal behavior of crops using Sentinel-1 and Sentinel-2-like data for agricultural applications. Remote Sensing of Environment, 199, 415–426.",
  ],
  zones: [
    "Bezdek, J. C. (1981). Pattern Recognition with Fuzzy Objective Function Algorithms. Plenum Press, New York.",
    "Fridgen, J. J., Kitchen, N. R., Sudduth, K. A., Drummond, S. T., Wiebold, W. J., Fraisse, C. W. (2004). Management Zone Analyst (MZA): software for subfield management zone delineation. Agronomy Journal, 96(1), 100–108.",
    "Odeh, I. O. A., Chittleborough, D. J., McBratney, A. B. (1992). Soil pattern recognition with fuzzy-c-means: application to classification and soil-landform interrelationships. Soil Science Society of America Journal, 56(2), 505–516.",
  ],
}

// --- the document -------------------------------------------------------------

export function buildPdfReport(input: PdfReportInput): PdfReportDocument {
  const { settings: s, rows } = input
  const products = productsIn(rows)
  const n = rows.length
  const subject = input.areaName
    ? `${plural(n, "field")} of ${input.areaName}`
    : (rows[0]?.field ?? input.runs[0]?.title ?? "one run")
  const periods = [
    ...new Set(input.runs.filter((r) => r.periodStart && r.periodEnd).map((r) => `${r.periodStart} to ${r.periodEnd}`)),
  ]

  // One method entry per run kind, from the first run of that kind.
  const seen = new Set<string>()
  const method: PdfReportDocument["method"] = []
  for (const run of input.runs) {
    const kind = run.kind || "classification"
    if (seen.has(kind)) continue
    seen.add(kind)
    const brief = methodOf(run)
    if (!brief) continue
    method.push({
      product: PRODUCT_TITLE[kind] ?? kind,
      subtitle: brief.subtitle,
      source: brief.source,
      sections: brief.sections.map((x) => ({ title: x.title, lines: x.lines, note: x.note ?? "" })),
    })
  }

  const series = input.season ? seasonSeries(input.season.field, input.season.season) : null

  return {
    schema: PDF_REPORT_SCHEMA,
    meta: {
      // The products are listed under Provenance; a title that listed them
      // too ran to three lines with six of them.
      title: s.title.trim() || `Report on ${subject}`,
      subtitle: s.subtitle.trim() || (periods.length ? `Imagery ${listed(periods)}` : ""),
      number: s.number.trim(),
      revision: s.revision.trim(),
      issued: isoDay(input.now),
      status: s.released ? "released" : "draft",
      owner: s.owner.trim(),
      recipient: s.recipient.trim(),
      author: s.author.trim(),
      approver: s.approver.trim(),
      app_version: input.appVersion,
      generated_at: isoMinute(input.now),
    },
    question: s.question.trim(),
    scope: s.scope.trim(),
    summary: summaryOf(rows, products),
    provenance: [
      { label: input.areaName ? "Area" : "Run", value: input.areaName ? `${input.areaName}, ${plural(n, "field")}` : subject },
      { label: "Products", value: products.map((p) => PRODUCT_NAME[p]).join(", ") || DASH },
      ...(periods.length ? [{ label: "Periods", value: listed(periods) }] : []),
      { label: "Runs", value: `${plural(input.runs.length, "run")}, listed under Reproducibility` },
      { label: "Software", value: `TERRA ${input.appVersion}` },
    ],
    method,
    figures: input.figures.map(figureOf),
    series: series ? [series] : [],
    tables: tablesOf(rows, products),
    limitations: limitationsOf(products),
    runs: input.runs.map((r) => ({
      id: r.id,
      kind: r.kind || "classification",
      period: r.periodStart && r.periodEnd ? `${r.periodStart} to ${r.periodEnd}` : "",
      created: r.created ? r.created.slice(0, 16).replace("T", " ") : "",
    })),
    references: [...new Set(products.flatMap((p) => REFERENCES[p]))],
  }
}
