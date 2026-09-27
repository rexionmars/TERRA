import { describe, expect, it } from "vitest"

import { fieldRow, fieldTableCsv } from "@/lib/fieldTable"
import { byOrbit, lastLoss, latestPass, radarFigures } from "@/lib/radar"
import { runRowLine } from "@/lib/runSummary"
import type { RadarAnalysis, RadarPoint } from "@/lib/types"

function pass(date: string, orbit: number, water = 0): RadarPoint {
  return {
    date,
    relative_orbit: orbit,
    orbit_state: orbit === 163 ? "ascending" : "descending",
    platform: "sentinel-1c",
    vv_db: -7,
    vh_db: -13,
    cr_db: -6,
    water_fraction: water,
    valid_fraction: 1,
  }
}

const report: RadarAnalysis = {
  extent: { lon_min: -53.37, lat_min: -24.885, lon_max: -53.33, lat_max: -24.855 },
  orbits: [],
  series: [pass("2025-10-13", 170), pass("2025-10-12", 163), pass("2025-10-25", 170), pass("2025-10-24", 163, 0.02)],
  losses: [
    { date: "2025-10-16", date_from: "2025-10-13", date_to: "2025-10-20", orbits_agree: true, n_orbits: 3, drop_db: 6.3, cr_drop_db: 3 },
    { date: "2026-02-04", date_from: "2026-01-29", date_to: "2026-02-09", orbits_agree: true, n_orbits: 2, drop_db: 3.8, cr_drop_db: 2.7 },
  ],
  map_date: "2025-10-25",
  map_orbit: 170,
  water_vh_db: -23,
  water_vv_db: -13,
  loss_vh_db: 3,
  loss_cr_db: 1,
  composite_uri: "",
  water_uri: "",
}

describe("a radar run's series", () => {
  it("keeps orbits apart, each in date order", () => {
    expect(byOrbit(report).map((o) => [o.relativeOrbit, o.orbitState, o.points.map((p) => p.date)])).toEqual([
      [163, "ascending", ["2025-10-12", "2025-10-24"]],
      [170, "descending", ["2025-10-13", "2025-10-25"]],
    ])
  })

  it("reads the last canopy loss and the latest pass", () => {
    expect(lastLoss(report)?.date_from).toBe("2026-01-29")
    expect(lastLoss({ ...report, losses: [] })).toBeNull()
    expect(latestPass(report)?.date).toBe("2025-10-25")
    expect(radarFigures(report)).toEqual({
      passes: 4,
      losses: 2,
      lastLossFrom: "2026-01-29",
      lastLossTo: "2026-02-09",
      latestDate: "2025-10-25",
      latestWater: 0,
    })
  })

  it("fills the Field table's radar columns", () => {
    const csv = fieldTableCsv([fieldRow("field 3", null, null, null, null, report)])
    const [head, row] = csv.trim().split("\n").map((l) => l.split(","))
    const col = (name: string) => row[head.indexOf(name)]
    expect(col("radar_passes")).toBe("4")
    expect(col("radar_canopy_losses")).toBe("2")
    expect(col("radar_last_loss_from")).toBe("2026-01-29")
    expect(col("radar_last_loss_to")).toBe("2026-02-09")
    expect(col("radar_latest_water_share")).toBe("0")
  })

  it("says in a run list how many passes and when the last loss was", () => {
    const summary = JSON.stringify({ radar_n_passes: 46, radar_last_loss_from: "2026-01-29", radar_last_loss_to: "2026-02-09" })
    expect(runRowLine({ kind: "radar", model_kind: "sentinel-1-rtc", period_start: "", period_end: "", summary })).toBe(
      "Sentinel-1 radar · 46 passes · canopy loss 2026-01-29 to 2026-02-09"
    )
    expect(runRowLine({ kind: "radar", model_kind: "sentinel-1-rtc", period_start: "", period_end: "", summary: "{}" })).toBe(
      "Sentinel-1 radar · no canopy loss"
    )
  })
})
