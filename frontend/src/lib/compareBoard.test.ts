import { describe, expect, it } from "vitest"

import {
  EMPTY_BOARD,
  READING_X,
  addReading,
  arrange,
  linkRun,
  linkedRuns,
  nextReadingId,
  readingInputs,
  removeReading,
  runSlot,
  seed,
  unlink,
  type CompareBoard,
} from "./compareBoard"

const withReading = (kind: "differences" | "cohort" | "spectra", id = "r1") =>
  addReading(EMPTY_BOARD, kind, id, { x: 0, y: 0 })

function linked(
  board: CompareBoard,
  run: string,
  reading: string,
  socket: string | null
) {
  const out = linkRun(board, run, reading, socket)
  if ("refused" in out) throw new Error(out.refused)
  return out.board
}

describe("a pair", () => {
  it("takes A and B, and a run dropped on the body fills the first free one", () => {
    let b = withReading("differences")
    b = linked(b, "field 20", "r1", null)
    b = linked(b, "field 18", "r1", null)
    expect(readingInputs(b, b.readings[0]).map((i) => [i.id, i.run])).toEqual([
      ["a", "field 20"],
      ["b", "field 18"],
    ])
  })

  it("swaps B when another run is linked onto it", () => {
    let b = linked(withReading("differences"), "x", "r1", "a")
    b = linked(b, "y", "r1", "b")
    b = linked(b, "z", "r1", "b")
    expect(linkedRuns(b, b.readings[0]).map((i) => i.run)).toEqual(["x", "z"])
  })

  it("refuses a run against itself", () => {
    const b = linked(withReading("differences"), "x", "r1", "a")
    expect(linkRun(b, "x", "r1", "b")).toEqual({
      refused: "This run already feeds this reading.",
    })
  })

  it("refuses a third run with no input free", () => {
    let b = linked(withReading("differences"), "x", "r1", null)
    b = linked(b, "y", "r1", null)
    expect(linkRun(b, "z", "r1", null)).toEqual({
      refused: "This reading has no free input.",
    })
  })
})

describe("growing inputs", () => {
  it("always leave one free input after the linked ones", () => {
    let b = withReading("spectra")
    expect(readingInputs(b, b.readings[0]).map((i) => i.id)).toEqual(["run-1"])
    b = linked(b, "x", "r1", null)
    b = linked(b, "y", "r1", null)
    expect(readingInputs(b, b.readings[0]).map((i) => [i.id, i.run])).toEqual([
      ["run-1", "x"],
      ["run-2", "y"],
      ["run-3", undefined],
    ])
  })

  it("keep the others in place when one is unlinked", () => {
    let b = withReading("spectra")
    for (const r of ["x", "y", "z"]) b = linked(b, r, "r1", null)
    b = unlink(b, "r1", "run-2")
    expect(linkedRuns(b, b.readings[0]).map((i) => i.run)).toEqual(["x", "z"])
  })

  it("give a cohort one source and any number of targets", () => {
    let b = withReading("cohort")
    b = linked(b, "s", "r1", "source")
    b = linked(b, "t1", "r1", null)
    b = linked(b, "t2", "r1", null)
    expect(readingInputs(b, b.readings[0]).map((i) => i.label)).toEqual([
      "Source",
      "Target",
      "Target",
      "Target",
    ])
  })
})

describe("runs that have left the board", () => {
  it("are not drawn, and their input reads as free", () => {
    let b = linked(withReading("differences"), "x", "r1", "a")
    b = linked(b, "gone", "r1", "b")
    const present = new Set(["x"])
    expect(readingInputs(b, b.readings[0], present)[1].run).toBeUndefined()
    // The link is kept, so the run comes back where it was.
    expect(b.links).toHaveLength(2)
  })
})

describe("more than one comparison", () => {
  it("lets one run feed several readings", () => {
    let b = addReading(EMPTY_BOARD, "differences", "r1", { x: 0, y: 0 })
    b = addReading(b, "differences", "r2", { x: 0, y: 200 })
    b = linked(b, "field 20", "r1", "a")
    b = linked(b, "field 18", "r1", "b")
    b = linked(b, "field 20", "r2", "a")
    b = linked(b, "drawn 9", "r2", "b")
    expect(b.readings.map((r) => linkedRuns(b, r).map((i) => i.run))).toEqual([
      ["field 20", "field 18"],
      ["field 20", "drawn 9"],
    ])
  })

  it("removes a reading with its links and nothing else", () => {
    let b = addReading(EMPTY_BOARD, "differences", "r1", { x: 0, y: 0 })
    b = addReading(b, "spectra", "r2", { x: 0, y: 0 })
    b = linked(b, "x", "r1", "a")
    b = linked(b, "x", "r2", null)
    b = removeReading(b, "r1")
    expect(b.readings.map((r) => r.id)).toEqual(["r2"])
    expect(b.links).toEqual([{ run: "x", reading: "r2", socket: "run-1" }])
    expect(b.places.r1).toBeUndefined()
  })
})

describe("seed", () => {
  it("puts a Differences node on the first two classifications, once", () => {
    const b = seed(EMPTY_BOARD, ["a", "b", "c"])
    expect(b.readings).toEqual([{ id: "reading-1", kind: "differences" }])
    expect(linkedRuns(b, b.readings[0]).map((i) => i.run)).toEqual(["a", "b"])
    expect(seed(removeReading(b, "reading-1"), ["a", "b"]).readings).toEqual([])
  })

  it("waits for a second classification", () => {
    expect(seed(EMPTY_BOARD, ["a"])).toBe(EMPTY_BOARD)
  })
})

describe("places", () => {
  it("stand the runs in one column, with readings to its right", () => {
    expect(runSlot(0)).toEqual({ x: 0, y: 0 })
    // One column: every run stands at x 0, each below the last.
    expect(runSlot(1).x).toBe(0)
    expect(runSlot(1).y).toBeGreaterThan(runSlot(0).y)
    expect(runSlot(2).y).toBeGreaterThan(runSlot(1).y)
    expect(READING_X).toBeGreaterThan(runSlot(1).x)
  })

  it("arrange puts a reading level with the runs it reads, without overlap", () => {
    let b = addReading(EMPTY_BOARD, "differences", "r1", { x: 0, y: 0 })
    b = addReading(b, "differences", "r2", { x: 0, y: 0 })
    b = linked(b, "a", "r1", "a")
    b = linked(b, "b", "r1", "b")
    b = linked(b, "a", "r2", "a")
    b = linked(b, "b", "r2", "b")
    const out = arrange(b, ["a", "b"], { r1: 140, r2: 140, a: 300, b: 300 })
    const [y1, y2] = [out.places.r1.y, out.places.r2.y].sort((p, q) => p - q)
    expect(y2 - y1).toBeGreaterThanOrEqual(140)
    expect(out.places.r1.x).toBe(READING_X)
  })

  it("names a new reading with an id no other has", () => {
    const b = addReading(EMPTY_BOARD, "differences", "reading-2", { x: 0, y: 0 })
    expect(nextReadingId(b)).toBe("reading-3")
  })
})
