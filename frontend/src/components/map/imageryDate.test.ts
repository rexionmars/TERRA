import { describe, expect, it } from "vitest"

import { tileLevel } from "@/lib/mapScale"

import { normalizeImageryDate, pickHere } from "./imageryDate"

/*
  The reply shape this is written against: an identify over Brazil at the
  globe's opening view returns high-resolution footprints only, every one of
  them MinMapLevel 12 to MaxMapLevel 18. The low-resolution layer that actually
  covers 0 to 11 there is TerraColor NextGen, whose SRC_DATE the service gives
  as null.
*/
const HIGH_RES = [
  { date: "20230325", min: 12, max: 18 },
  { date: "20250918", min: 12, max: 18 },
  { date: "20240204", min: 12, max: 18 },
]

describe("pickHere", () => {
  /*
    EVERY NUMBER HERE IS A LEVEL. What the surfaces hold is a zoom, one below
    the level being fetched -- so the globe's opening z1.6 asks for level 3,
    and the z11 that reads as "not yet high resolution" is level 12, which is.
  */
  it("says nothing below the level the footprints cover", () => {
    // The defect this replaces: 2025-09-18, over the undated 15 m mosaic.
    expect(pickHere(HIGH_RES, tileLevel(1.6))).toEqual({
      date: null,
      maxLevel: null,
      magnified: false,
    })
    expect(pickHere(HIGH_RES, 11).date).toBeNull()
  })

  it("is reached one zoom earlier than the level reads", () => {
    // z11 draws level 12, which is where the high-resolution footprints begin.
    expect(pickHere(HIGH_RES, tileLevel(11)).date).toBe("2025-09-18")
    expect(pickHere(HIGH_RES, tileLevel(10)).date).toBeNull()
  })

  it("reports the newest acquisition that covers the level", () => {
    expect(pickHere(HIGH_RES, 12).date).toBe("2025-09-18")
    expect(pickHere(HIGH_RES, 18).date).toBe("2025-09-18")
  })

  it("carries the ceiling, so a surface can say where the imagery ends", () => {
    expect(pickHere(HIGH_RES, 14).maxLevel).toBe(18)
    expect(pickHere(HIGH_RES, 14).magnified).toBe(false)
  })

  /*
    Jose de Freitas: one 2026 footprint that stops at z17. Turning the wheel
    past it magnifies that same picture -- so its date still describes what is
    on screen, and the ceiling is what the reader needs told.
  */
  it("keeps the date past the ceiling, and marks the view magnified", () => {
    const shallow = [{ date: "20260201", min: 12, max: 17 }]
    // z16.5 on screen is level 17.5 asked for: past the footprint's ceiling.
    expect(pickHere(shallow, tileLevel(16.5))).toEqual({
      date: "2026-02-01",
      maxLevel: 17,
      magnified: true,
    })
  })

  it("takes the ceiling from the deepest footprint, not the newest", () => {
    const mixed = [
      { date: "20260201", min: 12, max: 17 },
      { date: "20250629", min: 12, max: 20 },
    ]
    const here = pickHere(mixed, 19)
    expect(here.maxLevel).toBe(20)
    expect(here.magnified).toBe(false)
    // At 19 only the deeper footprint is drawn, so its date is the one shown.
    expect(here.date).toBe("2025-06-29")
  })

  it("ignores footprints the service left without a date", () => {
    const mixed = [
      { date: "", min: 0, max: 11 },
      { date: "20240204", min: 12, max: 18 },
    ]
    expect(pickHere(mixed, 4).date).toBeNull()
    expect(pickHere(mixed, 14).date).toBe("2024-02-04")
  })

  it("does not read the word the service writes for no date", () => {
    // TerraColor's own SRC_DATE, on the footprint that covers 0 to 11.
    expect(pickHere([{ date: "Null", min: 0, max: 11 }], 4).date).toBeNull()
  })

  it("has nothing to say about an empty reply", () => {
    expect(pickHere([], 14).maxLevel).toBeNull()
  })
})

describe("normalizeImageryDate", () => {
  it("reads both shapes the service returns", () => {
    expect(normalizeImageryDate("20250918")).toBe("2025-09-18")
    expect(normalizeImageryDate("2/4/2024")).toBe("2024-02-04")
  })

  it("passes through what it does not recognise, and nothing for blank", () => {
    expect(normalizeImageryDate("  ")).toBeNull()
    expect(normalizeImageryDate("Null")).toBe("Null")
  })
})
