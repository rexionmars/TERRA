import { describe, expect, it } from "vitest"

import {
  bandPath,
  chartScales,
  linePath,
  monthLabel,
  monthTicks,
  ndviRange,
  ndviTicks,
  ndviText,
  scaleWords,
  trajectoryFigures,
} from "./trajectory"
import type { TrajectoryAnalysis } from "./types"

function report(over: Partial<TrajectoryAnalysis> = {}): TrajectoryAnalysis {
  return {
    dates: ["2020-09-05", "2020-09-06", "2020-09-07"],
    ndvi: [0.3, 0.32, 0.35],
    lower: [0.2, 0.1, 0.25],
    upper: [0.4, 0.54, 0.45],
    level: 0.95,
    observations: [
      { date: "2020-09-05", ndvi: 0.29, clear_fraction: 0.9, kept: true },
      { date: "2020-09-06", ndvi: 0.7, clear_fraction: 0.4, kept: false },
      { date: "2020-09-07", ndvi: 0.36, clear_fraction: 1, kept: true },
    ],
    scenes_found: 5,
    scenes_read: 5,
    min_clear_fraction: 0.3,
    region: "MT",
    scale: "MT",
    multiplier: 0.8,
    model: { id: "gp_series", version: "0.1.0", name: "Gaussian Process", digest: "x" },
    ...over,
  }
}

describe("trajectoryFigures", () => {
  it("counts the dates kept and set aside, and finds the last day and the widest interval", () => {
    const f = trajectoryFigures(report())
    expect([f.used, f.kept, f.setAside]).toEqual([3, 2, 1])
    expect([f.from, f.to]).toEqual(["2020-09-05", "2020-09-07"])
    expect(f.last).toEqual({ date: "2020-09-07", ndvi: 0.35, lower: 0.25, upper: 0.45 })
    expect(f.widest?.date).toBe("2020-09-06")
    expect(f.widest?.width).toBeCloseTo(0.44)
  })

  it("says nothing of a last day when the trajectory is empty", () => {
    const f = trajectoryFigures(report({ dates: [], ndvi: [], lower: [], upper: [] }))
    expect(f.last).toBeNull()
    expect(f.widest).toBeNull()
  })
})

describe("scaleWords", () => {
  it("names the region whose scale was used", () => {
    expect(scaleWords({ scale: "MT", region: "MT" })).toBe("Mato Grosso")
    expect(scaleWords({ scale: "PR", region: "PR" })).toBe("Paraná")
  })

  it("says why the global scale was used", () => {
    expect(scaleWords({ scale: "global", region: "" })).toBe(
      "global, outside the calibrated regions or near a border"
    )
    expect(scaleWords({ scale: "global", region: "BA" })).toBe(
      "global, since Bahia has no scale of its own"
    )
  })
})

describe("the chart's scales", () => {
  it("spans 0 to 1 unless a bound or an observation leaves it", () => {
    expect(ndviRange(report())).toEqual([0, 1])
    expect(
      ndviRange(report({ lower: [-0.13, 0.1, 0.2], upper: [0.4, 1.07, 0.5] }))
    ).toEqual([-0.2, 1.2])
  })

  it("ticks every 0.2 over the usual range and every 0.5 past it", () => {
    expect(ndviTicks([0, 1])).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(ndviTicks([-0.2, 1])).toEqual([-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(ndviTicks([-0.4, 1.2])).toEqual([0, 0.5, 1])
  })

  it("ticks the first days of months, at most six, and puts the year where it changes", () => {
    expect(monthTicks("2020-09-05", "2020-12-20")).toEqual([
      "2020-10-01",
      "2020-11-01",
      "2020-12-01",
    ])
    const year = monthTicks("2020-09-01", "2021-08-31")
    expect(year.length).toBeLessThanOrEqual(6)
    expect(year[0]).toBe("2020-09-01")
    expect(monthLabel("2020-10-01", null)).toBe("Oct 2020")
    expect(monthLabel("2020-12-01", "2020-10-01")).toBe("Dec")
    // Every second month: the year turns on February, not on a January ticked.
    expect(monthLabel("2021-02-01", "2020-12-01")).toBe("Feb 2021")
  })

  it("writes a minus sign, not a hyphen, and no sign on a zero", () => {
    expect(ndviText(-0.126)).toBe("−0.13")
    expect(ndviText(-0.002)).toBe("0.00")
  })
})

describe("the chart's paths", () => {
  const frame = { width: 110, height: 60, left: 10, right: 0, top: 0, bottom: 10 }
  const r = report()
  const { x, y } = chartScales(r, frame, [0, 1])

  it("places the first day on the left edge and the last on the right", () => {
    expect(x(r.dates[0])).toBe(10)
    expect(x(r.dates[2])).toBe(110)
    expect(y(0)).toBe(50)
    expect(y(1)).toBe(0)
  })

  it("draws one point a day and closes the band back along the lower bound", () => {
    expect(linePath(r, x, y)).toBe("M10.0,35.0L60.0,34.0L110.0,32.5")
    expect(bandPath(r, x, y)).toBe(
      "M10.0,30.0L60.0,23.0L110.0,27.5L110.0,37.5L60.0,45.0L10.0,40.0Z"
    )
  })
})
