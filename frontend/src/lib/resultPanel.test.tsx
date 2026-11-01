import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ResultPanel } from "@/components/shell/ResultPanel"
import type { PredictResult, WaterAnalysis } from "@/lib/types"

/*
  A fixture and not a sample of anything: it exists to exercise the panel's
  branches, and it is rendered on the server because a React tree is what can
  crash here and this suite has no DOM.
*/
function classification(over: Partial<PredictResult> = {}): PredictResult {
  return {
    mean_confidence: 0.62,
    confidence_floor: 0.2,
    n_dates: 9,
    date_range: ["2026-01-05", "2026-03-20"],
    class_stats: [
      { class_id: 39, name: "Soybean", color: "#c59ff4", pixels: 100, pct: 60.5, area_ha: 12.5 },
      { class_id: 3, name: "Forest formation", color: "#1f8d49", pixels: 50, pct: 39.5, area_ha: 8.25 },
    ],
    ...over,
  } as PredictResult
}

const render = (props: Partial<Parameters<typeof ResultPanel>[0]>) =>
  renderToStaticMarkup(
    <ResultPanel
      result={null}
      view="summary"
      onViewChange={() => {}}
      areas={[]}
      runLabel="Test area"
      onPickZones={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
      {...props}
    />
  )

const BOX = { lon_min: -54, lat_min: -25, lon_max: -53, lat_max: -24 }

describe("ResultPanel", () => {
  it("says what would put something there when there is nothing", () => {
    expect(render({})).toContain("No result yet")
  })

  it("reads a classification with the limit on reading it beside it", () => {
    const html = render({ result: classification() })
    expect(html).toContain("Soybean")
    expect(html).toContain("12.5")
    expect(html).toContain("60.5")
    expect(html).toContain("floor 20")
    expect(html).toContain("western Paraná")
  })

  /*
    Go marshals a nil slice as null, and a run that produced no classification
    leaves these nil. lib/types.ts records that reading one unguarded once blanked
    the whole application.
  */
  it("survives a run that carries no classification", () => {
    const html = render({
      result: classification({ class_stats: null, date_range: null }),
    })
    expect(html).toContain("No result yet")
  })

  it("reports water without summing its two kinds", () => {
    const water = {
      index: "MNDWI",
      n_dates: 4,
      date_range: ["2026-01-05"],
      aoi_area_ha: 100,
      persistent_area_ha: 7,
      ephemeral_area_ha: 3,
      peak_date: "2026-02-01",
      peak_water_fraction_pct: 11.25,
    } as WaterAnalysis
    const html = render({ water })
    expect(html).toContain("Persistent water")
    expect(html).toContain("Ephemeral water")
    expect(html).toContain("never summed")
    expect(html).toContain("11.3 %")
  })

  it("reads a mineral map and keeps its limit beside it", () => {
    const mineral = {
      extent: BOX,
      observed_area_ha: 40,
      aoi_area_ha: 100,
      masked_cells: 0,
      scenes: [],
      groups: [],
      legend: [],
      notes: [],
    } as never
    const html = render({ mineral })
    expect(html).toContain("Mineral map")
    expect(html).toContain("Band depth is not abundance")
    expect(html).toContain("40.0 ha")
  })

  it("reads a field delineation and refuses to adopt one with no saved area", () => {
    const fields = {
      extent: BOX,
      checkpoint: { name: "c", title: "FTW", license: "CC" },
      window_a: { date: "2026-01-05", items: [], cloud_cover: 3, clear_fraction: 1 },
      window_b: { date: "2026-03-05", items: [], cloud_cover: 4, clear_fraction: 1 },
      area_ha: 90,
      masked_fraction: 0.1,
      n_fields: 0,
      field_area_ha: null,
      fields_geojson: "",
    } as never
    const html = render({ fields })
    expect(html).toContain("Field boundaries")
    expect(html).toContain("Only a saved delineation")
    expect(html).toContain("Not measured on Paraná fields")
  })

  it("reads a queued product from the run that was opened", () => {
    const job = {
      runId: "r1",
      label: "Field 7",
      radar: {
        extent: BOX,
        series: [],
        losses: [],
        map_date: "2026-01-05",
        map_orbit: 1,
      },
    } as never
    const html = render({ job })
    expect(html).toContain("Radar")
    expect(html).toContain("not calibrated against harvest records")
  })

  it("offers the choice only where more than one result is on the map", () => {
    const water = { index: "MNDWI", n_dates: 1, peak_water_fraction_pct: 1 } as WaterAnalysis
    expect(render({ result: classification() })).not.toContain('aria-label="Result"')
    expect(render({ result: classification(), water })).toContain('aria-label="Result"')
  })

  it("opens first on the product it was told to", () => {
    const water = { index: "MNDWI", n_dates: 1, peak_water_fraction_pct: 1 } as WaterAnalysis
    const html = render({ result: classification(), water, focus: "classify" })
    expect(html).toContain("Soybean")
    expect(html).not.toContain("Persistent water")
  })
})
