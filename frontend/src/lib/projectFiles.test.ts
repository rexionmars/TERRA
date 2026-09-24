/**
 * That the recent list keeps each file once, newest first, and within bound.
 */
import { describe, expect, it } from "vitest"

import {
  MAX_RECENT_PROJECT_FILES,
  projectFileName,
  withRecent,
  withoutRecent,
} from "./projectFiles"

describe("the recent project files", () => {
  it("puts the file first and keeps it once", () => {
    expect(withRecent(["/a.terra", "/b.terra"], "/b.terra")).toEqual(["/b.terra", "/a.terra"])
    expect(withRecent(undefined, "/a.terra")).toEqual(["/a.terra"])
  })

  it("keeps no more than its bound, dropping the oldest", () => {
    const many = Array.from({ length: MAX_RECENT_PROJECT_FILES }, (_, i) => `/f${i}.terra`)
    const next = withRecent(many, "/new.terra")
    expect(next).toHaveLength(MAX_RECENT_PROJECT_FILES)
    expect(next[0]).toBe("/new.terra")
    expect(next).not.toContain(`/f${MAX_RECENT_PROJECT_FILES - 1}.terra`)
  })

  it("forgets a file that is gone", () => {
    expect(withoutRecent(["/a.terra", "/b.terra"], "/a.terra")).toEqual(["/b.terra"])
  })
})

describe("projectFileName", () => {
  it("is the name without the folder or the extension, on either separator", () => {
    expect(projectFileName("/Users/x/Field north.terra")).toBe("Field north")
    expect(projectFileName("C:\\data\\Soja.TERRA")).toBe("Soja")
    expect(projectFileName("plain")).toBe("plain")
  })
})
