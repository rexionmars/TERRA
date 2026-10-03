import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import type { FieldRow } from "@/lib/fieldTable"
import {
  buildPdfReport,
  dms,
  graticule,
  groundAspect,
  mapSource,
  PDF_REPORT_DEFAULT,
  productsIn,
  scaleBar,
  seasonSeries,
  type PdfReportInput,
} from "@/lib/pdfReport"
import type { Season } from "@/lib/season"

/*
  The document this input builds is kept in sidecar/tests/data, where the
  sidecar's tests validate it and compile it to a PDF. The two sides read one
  file, so a field renamed in this builder and not in document.py (or the
  template) fails one of them. After a deliberate change to the document:

    UPDATE_PDF_REPORT_FIXTURE=1 npx vitest run src/lib/pdfReport.test.ts
*/
const FIXTURE = resolve(__dirname, "../../../sidecar/tests/data/pdf_report_document.json")

// A 1 x 1 PNG, so the fixture carries a real image the sidecar can decode.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const season: Season = {
  rise: { date: "2025-10-27", from: "2025-10-20", to: "2025-11-04" },
  peak: { date: "2025-12-20", from: "2025-12-14", to: "2025-12-29" },
  fall: { date: "2026-02-19", from: "2026-02-10", to: "2026-03-05" },
  lengthDays: 115,
  peakNdvi: 0.86,
  baseNdvi: 0.21,
  observations: [
    { date: "2025-10-05", ndvi: 0.21 },
    { date: "2025-10-20", ndvi: 0.28 },
    { date: "2025-11-04", ndvi: 0.55 },
    { date: "2025-12-14", ndvi: 0.84 },
    { date: "2025-12-29", ndvi: 0.86 },
    { date: "2026-02-10", ndvi: 0.62 },
    { date: "2026-03-05", ndvi: 0.3 },
  ],
}

function row(field: string, over: Partial<FieldRow> = {}): FieldRow {
  return {
    field,
    classes: [
      { name: "Soybean", color: "#f5b3c8", amount: 120.5 },
      { name: "Pasture", color: "#edde8e", amount: 4.25 },
    ],
    unit: "ha",
    season,
    confidence: 0.82,
    health: { date: "2026-01-12", ndviZ: -2.4, ndreZ: -1.1, ndvi: 0.61 },
    overlap: {
      readAt: "2026-09-26T22:55:01Z",
      prodes2009to2020: 0,
      prodes2021: 0,
      prodesFrom2022: 1.5,
      deter: 0,
      embargoIbama: 0,
      embargoIcmbio: 0,
      indigenous: 0,
      conservation: null,
      carGap: 3.2,
      unread: ["Conservation units"],
    },
    radar: { passes: 30, losses: 1, lastLossFrom: "2026-03-01", lastLossTo: "2026-03-13", latestDate: "2026-09-25", latestWater: 0.004 },
    zones: { suggestedK: 3, fpi: 0.214, nce: 0.187, seasonsUsed: 4 },
    ...over,
  }
}

const INPUT: PdfReportInput = {
  settings: { ...PDF_REPORT_DEFAULT, author: "J. Leonardi", number: "TERRA-RA-2026-001", question: "Which fields departed this season?" },
  rows: [row("field 7"), row("field 12", { health: { date: "2026-01-12", ndviZ: 0.3, ndreZ: 0.1, ndvi: 0.83 }, radar: null })],
  areaName: "Fazenda Boa Vista",
  season: { field: "field 7", season },
  figures: [
    {
      title: "Predicted class, field 7.",
      caption: "One colour per class.",
      uri: PIXEL,
      width: 400,
      height: 300,
      extent: { lon_min: -55.7311, lat_min: -12.1503, lon_max: -55.71, lat_max: -12.13 },
      legend: [{ label: "Soybean", color: "#f5b3c8" }],
      pixelated: true,
      source: "Sentinel-2 L2A (Copernicus), classified by TERRA; MapBiomas legend, 2025-09-27 to 2026-09-19 (run e699f536)",
    },
  ],
  runs: [
    {
      id: "e699f536-efbb-4f05-a857-1a2b1f300f9b",
      kind: "classification",
      title: "run-field-7",
      modelKind: "spectral",
      periodStart: "2025-09-27",
      periodEnd: "2026-09-19",
      created: "2026-09-26T08:58:00Z",
    },
    {
      id: "1ff30854-6969-4b2a-a77e-add4ba3d7ec4",
      kind: "health",
      title: "run-field-7-health",
      modelKind: "ndvi-ndre-baseline",
      periodStart: "2025-09-25",
      periodEnd: "2026-09-25",
      created: "2026-09-26T17:19:22Z",
    },
  ],
  appVersion: "0.6.0",
  now: new Date("2026-09-27T01:30:00Z"),
}

describe("buildPdfReport", () => {
  const doc = buildPdfReport(INPUT)

  it("builds the document the sidecar's fixture holds", () => {
    const text = JSON.stringify(doc, null, 2) + "\n"
    if (process.env.UPDATE_PDF_REPORT_FIXTURE) writeFileSync(FIXTURE, text)
    expect(text).toBe(readFileSync(FIXTURE, "utf8"))
  })

  it("titles an untitled report by its products and subject", () => {
    expect(doc.meta.title).toBe("Report on 2 fields of Fazenda Boa Vista")
    expect(doc.meta.status).toBe("draft")
    expect(doc.meta.subtitle).toBe("Imagery 2025-09-27 to 2026-09-19 and 2025-09-25 to 2026-09-25")
  })

  it("states counts with their condition, and names the fields well below", () => {
    expect(doc.summary).toContain(
      "Across 2 fields, 249.5 ha were classified into 2 classes; the largest, Soybean, covers 96.6% of it."
    )
    expect(doc.summary.some((s) => s.includes("in 1 of 2 fields, and at least two below in 1 (field 7)"))).toBe(true)
    expect(doc.summary.some((s) => s.includes("PRODES clearing after 22 Jul 2008, 3.0 ha over 2 fields"))).toBe(true)
    expect(doc.summary.some((s) => s.endsWith("Not read: Conservation units."))).toBe(true)
    expect(doc.summary).toContain("The Sentinel-1 series records at least one canopy loss in 1 of 1 fields.")
  })

  it("prints a register not read as a dash, never as zero", () => {
    const t = doc.tables.find((x) => x.title.startsWith("Public registers"))!
    const col = t.columns.findIndex((c) => c.label === "Cons. unit")
    expect(t.rows[0][col]).toBe("—")
    expect(t.rows[0][t.columns.findIndex((c) => c.label === "DETER")]).toBe("0.0")
  })

  it("does not state a cloud ceiling the runs did not record", () => {
    const lines = doc.method.flatMap((m) => m.sections.flatMap((s) => s.lines))
    expect(lines.some((l) => l.includes("not recorded with it"))).toBe(true)
    expect(lines.some((l) => /\d+% scene cloud|below \d+%/.test(l))).toBe(false)
  })

  it("carries one method entry per run kind, and a limitation per product", () => {
    expect(doc.method.map((m) => m.product)).toEqual(["Land cover and season", "Vegetation health"])
    expect(doc.limitations.map((l) => l.label)).toContain("Radar thresholds")
    expect(doc.limitations.at(-1)?.label).toBe("Field verification")
  })

  it("leaves out what no row holds", () => {
    const rows = [row("f", { health: null, overlap: null, radar: null, zones: null })]
    expect(productsIn(rows)).toEqual(["classes", "season"])
    const bare = buildPdfReport({ ...INPUT, rows })
    expect(bare.tables.map((t) => t.title)).toEqual(["Land cover by field.", "Season dates by field."])
    expect(bare.references.some((r) => r.startsWith("Lee"))).toBe(false)
  })
})

describe("scaleBar", () => {
  it("is a round length no wider than a quarter of the map", () => {
    // 0.0211 degrees of longitude at 12.14 S is about 2.30 km.
    const bar = scaleBar({ lon_min: -55.7311, lat_min: -12.1503, lon_max: -55.71, lat_max: -12.13 })!
    expect(bar.label).toBe("500 m")
    expect(bar.fraction).toBeGreaterThan(0.2)
    expect(bar.fraction).toBeLessThanOrEqual(0.25)
    expect(scaleBar({ lon_min: -56, lat_min: -13, lon_max: -55, lat_max: -12 })!.label).toBe("20 km")
    expect(scaleBar({ lon_min: 1, lat_min: 0, lon_max: 1, lat_max: 1 })).toBeNull()
  })
})

describe("map sheet", () => {
  const extent = { lon_min: -55.7311, lat_min: -12.1503, lon_max: -55.71, lat_max: -12.13 }

  it("writes coordinates in degrees, minutes and seconds, to the precision of the interval", () => {
    expect(dms(-55.725, "lon", 30)).toBe("55°43′30″W")
    expect(dms(-12.5, "lat", 1800)).toBe("12°30′S")
    expect(dms(-12, "lat", 3600)).toBe("12°S")
    expect(dms(3.25, "lon", 900)).toBe("3°15′E")
  })

  it("ticks the frame at round intervals, at most four a side and none at a corner", () => {
    // 0.0211 degrees of longitude is 76 seconds of arc: 15 s would give five, 30 s gives two.
    const lon = graticule(extent.lon_min, extent.lon_max, "lon")
    expect(lon.map((t) => t.label)).toEqual(["55°43′30″W", "55°43′00″W"])
    expect(lon[0].at).toBeCloseTo((-55.725 - extent.lon_min) / (extent.lon_max - extent.lon_min), 9)
    // Parallels are placed from the top: the northern one first, nearer 0.
    const lat = graticule(extent.lat_min, extent.lat_max, "lat")
    expect(lat.length).toBeGreaterThanOrEqual(2)
    expect(lat.length).toBeLessThanOrEqual(4)
    expect(lat.every((t) => t.at >= 0.04 && t.at <= 0.96)).toBe(true)
    expect(lat[0].at).toBeGreaterThan(lat[1].at)
    expect(graticule(1, 1, "lon")).toEqual([])
  })

  it("shapes the frame by the ground, not by the pixels", () => {
    // 0.0211 x cos(12.14 S) over 0.0203 degrees.
    expect(groundAspect(extent)).toBeCloseTo((0.0211 * Math.cos((12.14015 * Math.PI) / 180)) / 0.0203, 6)
  })

  it("names the sensor, the period and the run behind a map", () => {
    expect(mapSource([INPUT.runs[0]])).toBe(
      "Sentinel-2 L2A (Copernicus), classified by TERRA; MapBiomas legend, 2025-09-27 to 2026-09-19 (run e699f536)"
    )
  })

  it("carries the sheet where the extent is known, and none where it is not", () => {
    const withExtent = buildPdfReport(INPUT).figures[0]
    expect(withExtent.map?.scale_bar.ticks).toEqual(["0", "250", "500 m"])
    expect(withExtent.map?.crs).toContain("WGS 84")
    const bare = buildPdfReport({ ...INPUT, figures: [{ ...INPUT.figures[0], extent: null }] }).figures[0]
    expect(bare.map).toBeNull()
    expect(bare.aspect).toBeCloseTo(400 / 300, 9)
    expect(bare.caption).toContain("no coordinates and no scale")
  })
})

describe("seasonSeries", () => {
  it("places the observations in days and the marks on their dates", () => {
    const s = seasonSeries("field 7", season)!
    expect(s.points[0]).toEqual({ x: 0, y: 0.21 })
    expect(s.x_range).toEqual([0, 151])
    expect(s.marks.map((m) => m.label)).toEqual(["rise", "peak", "fall"])
    expect(s.marks[1].x).toBe(76)
    expect(s.x_ticks[0]).toEqual({ at: 27, label: "Nov 2025" })
    expect(s.y_range).toEqual([0, 1])
  })

  it("draws nothing from fewer than two observations", () => {
    expect(seasonSeries("f", { ...season, observations: [{ date: "2025-10-05", ndvi: 0.2 }] })).toBeNull()
  })
})
