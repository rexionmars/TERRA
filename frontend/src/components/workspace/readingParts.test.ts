import { describe, expect, it } from "vitest"

import { columnLabel, titled } from "@/components/workspace/readingParts"

describe("columnLabel", () => {
  it("spells out the exporter's keys for a reader", () => {
    expect(columnLabel("class_id")).toBe("Class ID")
    expect(columnLabel("area_ha")).toBe("Area (ha)")
    expect(columnLabel("agreement_pct")).toBe("Agreement %")
    expect(columnLabel("macro_f1")).toBe("Macro F1")
    expect(columnLabel("mmd2")).toBe("MMD²")
    expect(columnLabel("cva_sd")).toBe("CVA (SD)")
    expect(columnLabel("kl_ndvi")).toBe("KL NDVI")
    expect(columnLabel("color")).toBe("Colour")
    expect(columnLabel("pixels")).toBe("Pixels")
  })
})

describe("titled", () => {
  it("capitalises the first letter and leaves the rest", () => {
    expect(titled("field 23")).toBe("Field 23")
    expect(titled("MT north")).toBe("MT north")
    expect(titled("")).toBe("")
  })
})
