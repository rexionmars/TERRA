import { describe, expect, it } from "vitest"

import { droppedPackage } from "./packageDrop"

describe("droppedPackage", () => {
  it("takes one dropped zip or folder as the package", () => {
    expect(droppedPackage(["/Users/x/gp_series-0.1.0.zip"])).toEqual({
      path: "/Users/x/gp_series-0.1.0.zip",
    })
    expect(droppedPackage(["/Users/x/package"])).toEqual({ path: "/Users/x/package" })
  })

  it("refuses several at once, saying how many came", () => {
    expect(droppedPackage(["/a.zip", "/b.zip"])).toEqual({
      refusal: "2 files were dropped. Drop one package at a time.",
    })
  })

  it("ignores a drop that carried no file", () => {
    expect(droppedPackage([])).toBeNull()
    expect(droppedPackage([""])).toBeNull()
  })
})
