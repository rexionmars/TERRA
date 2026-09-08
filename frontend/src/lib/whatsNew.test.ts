/**
 * Which notes the menu shows, which is not the question the gate asks.
 *
 * The two callers want different spans out of one catalogue -- everything
 * missed, versus what this release is -- and the difference is easy to lose in
 * a refactor because both are "the release notes". So each is pinned against
 * the same fixture, and the case that decides them apart is the reader who
 * skipped a version.
 */
import { describe, expect, it } from "vitest"

import { entriesSince, notesForVersion, type WhatsNewEntry } from "./whatsNew"

const CATALOG: WhatsNewEntry[] = [
  { version: "0.6.0", title: "six", items: [] },
  { version: "0.5.0", title: "five", items: [] },
  { version: "0.4.0", title: "four", items: [] },
]

describe("notesForVersion", () => {
  it("is the running version's entry, not everything before it", () => {
    expect(notesForVersion("0.5.0", CATALOG).map((e) => e.title)).toEqual([
      "five",
    ])
  })

  it("differs from the gate's span for a reader who skipped a version", () => {
    /*
      The reader last saw 0.4.0 and is running 0.6.0. The gate owes them both
      releases; the menu owes them the one they are in. Same catalogue, same
      version, two answers -- which is the whole reason the second function
      exists.
    */
    expect(entriesSince("0.4.0", "0.6.0", CATALOG).map((e) => e.title)).toEqual([
      "six",
      "five",
    ])
    expect(notesForVersion("0.6.0", CATALOG).map((e) => e.title)).toEqual(["six"])
  })

  it("falls back to the newest for a build between tags", () => {
    // A development version, or a patch folded into the minor above it.
    expect(notesForVersion("0.6.1", CATALOG).map((e) => e.title)).toEqual(["six"])
    expect(notesForVersion("", CATALOG).map((e) => e.title)).toEqual(["six"])
  })

  it("finds the newest by version rather than by position", () => {
    const shuffled = [CATALOG[2], CATALOG[0], CATALOG[1]]
    expect(notesForVersion("9.9.9", shuffled).map((e) => e.title)).toEqual(["six"])
  })

  it("answers nothing only when there is nothing to answer with", () => {
    expect(notesForVersion("0.6.0", [])).toEqual([])
  })
})
