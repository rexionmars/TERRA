import { describe, expect, it } from "vitest"

import { legendShown, toggleLegend, type LegendState } from "./legendChoice"

const ramp: LegendState = { key: "water", hasLegend: true, byDefault: true }
const classes: LegendState = { key: "mineral-2", hasLegend: true, byDefault: false }
const none: LegendState = { key: "true-color", hasLegend: false, byDefault: false }

describe("legendShown", () => {
  it("draws a ramp's legend and waits to be asked for a class list", () => {
    expect(legendShown({}, ramp)).toBe(true)
    expect(legendShown({}, classes)).toBe(false)
  })

  it("never draws a legend a raster does not have, whatever was chosen", () => {
    expect(legendShown({ "true-color": true }, none)).toBe(false)
  })
})

describe("toggleLegend", () => {
  it("puts a class list on the map, and takes it off again", () => {
    const on = toggleLegend({}, classes)
    expect(legendShown(on, classes)).toBe(true)
    expect(legendShown(toggleLegend(on, classes), classes)).toBe(false)
  })

  it("takes a ramp's legend off, and keeps the other rasters as they were", () => {
    const off = toggleLegend({ "mineral-2": true }, ramp)
    expect(legendShown(off, ramp)).toBe(false)
    expect(legendShown(off, classes)).toBe(true)
  })

  it("leaves the choices alone for a raster with no legend", () => {
    const choice = { water: false }
    expect(toggleLegend(choice, none)).toBe(choice)
  })
})
