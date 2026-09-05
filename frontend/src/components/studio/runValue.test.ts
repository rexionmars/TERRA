/**
 * That the three things a card's value has to answer stay one thing.
 *
 * The reading, the absence and the signature were three hand-written tables
 * over the same subject before runValue.ts, and what follows is the pair of
 * defects that came of it: an input nobody had added to the absence list drew
 * as though it were supplied, and two periods that READ the same were compared
 * as though they were the same.
 */
import { describe, expect, it } from "vitest"

import {
  HEAVY,
  reading,
  signature,
  subject,
  supplied,
  type RunValue,
} from "./runValue"

describe("supplied", () => {
  it("is false for a card holding nothing, by kind", () => {
    const empty: RunValue[] = [
      { kind: "ground", label: null },
      { kind: "span", start: "", end: "" },
      { kind: "choice", label: null },
      { kind: "scene", id: null, found: 12 },
      { kind: "store", reachable: false },
    ]
    for (const v of empty) expect(supplied(v)).toBe(false)
  })

  it("is true once the card holds it", () => {
    const held: RunValue[] = [
      { kind: "ground", label: "drawn 13" },
      { kind: "span", start: "2024-01-01", end: "2024-03-01" },
      { kind: "choice", label: "annual" },
      { kind: "scene", id: "S2A_20240101", found: 12 },
      { kind: "store", reachable: true },
    ]
    for (const v of held) expect(supplied(v)).toBe(true)
  })

  it("refuses a period that ends before it starts", () => {
    expect(supplied({ kind: "span", start: "2024-03-01", end: "2024-01-01" })).toBe(
      false
    )
  })

  it("counts a set below its floor as absent, not as smaller", () => {
    // An envelope IS the disagreement between elevation products: one product
    // is not a coarser answer, it is no answer.
    const one: RunValue = { kind: "several", items: ["a"], least: 2, of: 5 }
    const two: RunValue = { kind: "several", items: ["a", "b"], least: 2, of: 5 }
    expect(supplied(one)).toBe(false)
    expect(supplied(two)).toBe(true)
  })

  it("holds a card that always carries a figure", () => {
    expect(supplied({ kind: "record", years: 10, of: "hourly" })).toBe(true)
    expect(supplied({ kind: "measure", of: 2.5, unit: "m" })).toBe(true)
    expect(supplied({ kind: "band", low: 2, high: 98, unit: "%" })).toBe(true)
    expect(supplied({ kind: "none" })).toBe(true)
  })
})

describe("reading", () => {
  it("reports a period as the days it covers", () => {
    expect(reading({ kind: "span", start: "2024-01-01", end: "2024-01-31" })).toBe(
      "31 d"
    )
  })

  it("names a small set and counts a larger one", () => {
    const named: RunValue = {
      kind: "several",
      items: ["B4", "B3", "B2"],
      least: 3,
      of: 3,
    }
    const counted: RunValue = {
      kind: "several",
      items: ["a", "b", "c", "d"],
      least: 2,
      of: 6,
    }
    expect(reading(named)).toBe("B4 B3 B2")
    expect(reading(counted)).toBe("4 of 6")
  })

  it("writes a figure as short as it is exact", () => {
    expect(reading({ kind: "measure", of: 3, unit: "m" })).toBe("3 m")
    expect(reading({ kind: "measure", of: 2.5, unit: "m" })).toBe("2.5 m")
    expect(reading({ kind: "band", low: 2, high: 98, unit: "%" })).toBe("2-98 %")
  })

  it("says nothing for a card holding nothing", () => {
    expect(reading({ kind: "ground", label: null })).toBe("")
    expect(reading({ kind: "scene", id: null, found: 0 })).toBe("")
    expect(reading({ kind: "none" })).toBe("")
  })

  it("falls back to what the period found where no scene is chosen", () => {
    expect(reading({ kind: "scene", id: null, found: 12 })).toBe("12 scenes")
  })
})

describe("signature", () => {
  it("separates two values the reading cannot", () => {
    // Both read "31 d". A run made over one is not an answer about the other.
    const january: RunValue = {
      kind: "span",
      start: "2024-01-01",
      end: "2024-01-31",
    }
    const march: RunValue = { kind: "span", start: "2024-03-01", end: "2024-03-31" }
    expect(reading(january)).toBe(reading(march))
    expect(signature(january)).not.toBe(signature(march))
  })

  it("is stable for a value that has not moved", () => {
    const a: RunValue = { kind: "several", items: ["x", "y"], least: 2, of: 4 }
    const b: RunValue = { kind: "several", items: ["x", "y"], least: 2, of: 4 }
    expect(signature(a)).toBe(signature(b))
  })
})

describe("subject", () => {
  it("groups the three sources a run reads from as one part", () => {
    // The drawn polygon is the commonest of them, not the kind: a scene is one
    // acquisition and a store is a local database, and all three answer the
    // same question about where the run reads.
    const sources: RunValue[] = [
      { kind: "ground", label: "drawn 13" },
      { kind: "scene", id: "S2A", found: 4 },
      { kind: "store", reachable: true },
    ]
    for (const v of sources) expect(subject(v)).toBe("source")
  })

  it("groups a calendar span and a depth of record as one part", () => {
    expect(subject({ kind: "span", start: "2024-01-01", end: "2024-02-01" })).toBe(
      "when"
    )
    expect(subject({ kind: "record", years: 10, of: "hourly" })).toBe("when")
  })

  it("separates the method from the values it is run at", () => {
    expect(subject({ kind: "choice", label: "annual" })).toBe("method")
    expect(subject({ kind: "several", items: ["a"], least: 2, of: 5 })).toBe(
      "method"
    )
    expect(subject({ kind: "measure", of: 2.5, unit: "m" })).toBe("value")
    expect(subject({ kind: "band", low: 2, high: 98, unit: "%" })).toBe("value")
  })

  it("gives no part to a card that answers none of the question", () => {
    expect(subject({ kind: "none" })).toBeNull()
  })

  it("weighs where and when above how", () => {
    // Change where or when a run reads and it is a run about something else;
    // change a threshold and it is the same question answered differently.
    expect(HEAVY).toContain("source")
    expect(HEAVY).toContain("when")
    expect(HEAVY).not.toContain("method")
    expect(HEAVY).not.toContain("value")
  })
})
