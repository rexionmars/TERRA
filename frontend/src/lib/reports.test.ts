/**
 * That the report log keeps what it is given, in order, and within its bound.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { MAX_REPORTS, clearReports, readReports, report } from "./reports"

describe("the report log", () => {
  beforeEach(() => clearReports())

  it("keeps reports in the order they were raised", () => {
    report("info", "first")
    report("error", "second", "why")
    const log = readReports()
    expect(log.map((r) => r.title)).toEqual(["first", "second"])
    expect(log[1]).toMatchObject({ level: "error", description: "why" })
    expect(log[0].id).toBeLessThan(log[1].id)
  })

  it("drops the oldest past its bound, keeping the newest", () => {
    for (let i = 0; i < MAX_REPORTS + 20; i++) report("info", `r${i}`)
    const log = readReports()
    expect(log).toHaveLength(MAX_REPORTS)
    expect(log[log.length - 1].title).toBe(`r${MAX_REPORTS + 19}`)
    expect(log[0].title).toBe("r20")
  })

  it("returns a new list on every change, so a subscriber sees it", () => {
    const before = readReports()
    report("success", "saved")
    expect(readReports()).not.toBe(before)
  })

  it("empties on clear", () => {
    report("info", "x")
    clearReports()
    expect(readReports()).toEqual([])
  })
})
