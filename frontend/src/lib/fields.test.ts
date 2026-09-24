import { describe, expect, it } from "vitest"

import { fieldsByParent, rootOf, type Area } from "@/lib/areas"
import {
  fieldLayerDefaultVisible,
  fieldWindows,
  FIELD_LAYER,
  MIN_PERIOD_DAYS,
  parseFields,
} from "@/lib/fields"

describe("fieldWindows", () => {
  it("takes the first and last third of a season", () => {
    // 1 Oct 2024 to 31 Mar 2025 is 181 days; a third is 60.
    expect(fieldWindows("2024-10-01", "2025-03-31")).toEqual({
      a: { start: "2024-10-01", end: "2024-11-30" },
      b: { start: "2025-01-30", end: "2025-03-31" },
    })
  })

  it("keeps the two windows apart", () => {
    const w = fieldWindows("2024-01-01", "2024-12-31")!
    expect(w.a.end < w.b.start).toBe(true)
  })

  it("refuses a period too short to hold two windows", () => {
    expect(fieldWindows("2024-10-01", "2024-10-20")).toBeNull()
    const t0 = Date.parse("2024-10-01T00:00:00Z")
    const end = new Date(t0 + MIN_PERIOD_DAYS * 86_400_000).toISOString().slice(0, 10)
    expect(fieldWindows("2024-10-01", end)).not.toBeNull()
  })

  it("refuses dates out of order or unreadable", () => {
    expect(fieldWindows("2025-03-31", "2024-10-01")).toBeNull()
    expect(fieldWindows("", "2025-03-31")).toBeNull()
    expect(fieldWindows("not a date", "2025-03-31")).toBeNull()
  })
})

const square = {
  type: "Polygon",
  coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
}

describe("parseFields", () => {
  it("reads the features in the order written", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { field: 1, area_ha: 12.5, perimeter_m: 1500, mean_interior_prob: 0.99, cropland_share: 0.8 }, geometry: square },
        { type: "Feature", properties: { field: 2, area_ha: 0.3, perimeter_m: 230, mean_interior_prob: 0.9 }, geometry: square },
      ],
    }
    const fields = parseFields({ fields_geojson: JSON.stringify(fc) })
    expect(fields.map((f) => f.properties.field)).toEqual([1, 2])
    expect(fields[1].properties.cropland_share).toBeUndefined()
  })

  it("returns nothing for text that is not GeoJSON, rather than throwing", () => {
    expect(parseFields({ fields_geojson: "{" })).toEqual([])
    expect(parseFields({ fields_geojson: "" })).toEqual([])
    expect(parseFields(null)).toEqual([])
  })
})

describe("field layers", () => {
  it("draws the class map and not the two scenes until asked", () => {
    expect(fieldLayerDefaultVisible(FIELD_LAYER.classes)).toBe(true)
    expect(fieldLayerDefaultVisible(FIELD_LAYER.windowA)).toBe(false)
    expect(fieldLayerDefaultVisible(FIELD_LAYER.windowB)).toBe(false)
  })
})

function area(id: string, parent = ""): Area {
  return {
    id,
    name: id,
    geometry: square as Area["geometry"],
    created_at: "",
    notes: "",
    run_count: 0,
    parent_id: parent,
    source_run_id: parent ? "run" : "",
  }
}

describe("the area tree", () => {
  const areas = [area("aoi"), area("f1", "aoi"), area("other"), area("f2", "aoi")]

  it("lists each area's fields under it, in order", () => {
    const tree = fieldsByParent(areas)
    expect(tree.get("aoi")?.map((a) => a.id)).toEqual(["f1", "f2"])
    expect(tree.has("other")).toBe(false)
  })

  it("finds the area whose fields are in view, from the area or one of its fields", () => {
    expect(rootOf(areas, "f2")?.id).toBe("aoi")
    expect(rootOf(areas, "aoi")?.id).toBe("aoi")
    expect(rootOf(areas, "missing")).toBeNull()
    expect(rootOf(areas, null)).toBeNull()
  })
})
