import { describe, expect, it } from "vitest"

import {
  FILE_LAYER_COLORS,
  areaPolygon,
  coloursTaken,
  countLabel,
  drawsOnMap,
  featureBounds,
  featureKind,
  featureLabel,
  isTable,
  layersBounds,
  toOpenedFile,
} from "./fileLayers"
import type { GeoPackage, GeoPackageLayer } from "./types"

const layer = (name: string, url: string, extra: Partial<GeoPackageLayer> = {}) =>
  ({
    name,
    title: name,
    data_type: "features",
    geometry_type: "POINT",
    kind: "point",
    crs: "WGS 84 (EPSG:4326)",
    count: 1,
    drawn: 1,
    unreadable: 0,
    bounds: null,
    columns: [],
    file: url ? "0.geojson" : "",
    url,
    reason: url ? "" : "it is a raster layer",
    ...extra,
  }) satisfies GeoPackageLayer

describe("toOpenedFile", () => {
  const gp: GeoPackage = {
    id: "f1",
    name: "br230.gpkg",
    path: "/x/br230.gpkg",
    layers: [layer("schools", "/a/0"), layer("ortofoto", ""), layer("roads", "/a/2")],
  }

  it("colours only the layers that are drawn, continuing from the colours taken", () => {
    const f = toOpenedFile(gp, 6)
    expect(f.layers.map((l) => l.color)).toEqual([
      FILE_LAYER_COLORS[6],
      "transparent",
      FILE_LAYER_COLORS[0],
    ])
    expect(f.layers.map((l) => l.visible)).toEqual([true, false, true])
    expect(f.layers[0].key).toBe("f1:schools")
    expect(coloursTaken([f])).toBe(2)
  })
})

describe("a table without geometry", () => {
  const about = layer("about", "/a/12", {
    data_type: "attributes",
    geometry_type: "",
    kind: "table",
    crs: "",
    count: 12,
    drawn: 12,
  })

  it("is listed with its rows and is not drawn on the map", () => {
    expect(isTable(about)).toBe(true)
    expect(drawsOnMap(about)).toBe(false)
    expect(countLabel(about)).toBe("12 rows")
    expect(countLabel({ ...about, drawn: 1 })).toBe("1 row")
  })

  it("takes no colour from the layers that are drawn", () => {
    const f = toOpenedFile(
      {
        id: "f2",
        name: "x.gpkg",
        path: "/x.gpkg",
        layers: [about, layer("schools", "/a/0")],
      },
      0
    )
    expect(f.layers.map((l) => [l.color, l.visible])).toEqual([
      ["transparent", false],
      [FILE_LAYER_COLORS[0], true],
    ])
    expect(coloursTaken([f])).toBe(1)
  })

  it("is not a table once it could not be read", () => {
    expect(isTable({ ...about, url: "" })).toBe(false)
  })
})

describe("layersBounds", () => {
  it("is the box around every layer that has one", () => {
    expect(
      layersBounds([
        { bounds: [-53, -25, -52, -24] },
        { bounds: null },
        { bounds: [-60, -10, -55, -5] },
      ])
    ).toEqual([-60, -25, -52, -5])
    expect(layersBounds([{ bounds: null }])).toBeNull()
  })
})

describe("countLabel", () => {
  it("names what the layer holds", () => {
    expect(countLabel({ kind: "point", drawn: 1204 })).toBe("1,204 points")
    expect(countLabel({ kind: "polygon", drawn: 1 })).toBe("1 polygon")
    expect(countLabel({ kind: "mixed", drawn: 3 })).toBe("3 features")
  })
})

describe("featureLabel", () => {
  it("takes a column named for names, then the first text, then the layer and key", () => {
    expect(
      featureLabel(
        { CD_MUN: "4104808", NM_MUN: "Cascavel" },
        ["CD_MUN", "NM_MUN"],
        "mun",
        7
      )
    ).toBe("Cascavel")
    expect(
      featureLabel({ area: 12, terrai: " Xingu " }, ["area", "terrai"], "ti", 3)
    ).toBe("Xingu")
    expect(featureLabel({ area: 12 }, ["area"], "ti", 3)).toBe("ti 3")
    expect(featureLabel(null, [], "ti", 3)).toBe("ti 3")
  })
})

describe("areaPolygon", () => {
  const square = (x: number, side: number) => [
    [
      [x, 0],
      [x + side, 0],
      [x + side, side],
      [x, side],
      [x, 0],
    ],
  ]

  it("keeps a polygon and takes a multipolygon's largest part", () => {
    expect(areaPolygon({ type: "Polygon", coordinates: square(0, 1) })?.parts).toBe(1)
    const got = areaPolygon({
      type: "MultiPolygon",
      coordinates: [square(0, 0.01), square(1, 0.1)],
    })
    expect(got?.parts).toBe(2)
    expect(got?.polygon.coordinates).toEqual(square(1, 0.1))
  })

  it("is null for a point or a line", () => {
    expect(areaPolygon({ type: "Point", coordinates: [0, 0] })).toBeNull()
    expect(
      areaPolygon({
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      })
    ).toBeNull()
    expect(areaPolygon(null)).toBeNull()
  })
})

describe("featureBounds", () => {
  it("is the box around a point, a line or a multipolygon", () => {
    expect(featureBounds({ type: "Point", coordinates: [-53.4, -24.9] })).toEqual([
      -53.4, -24.9, -53.4, -24.9,
    ])
    expect(
      featureBounds({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [2, 1],
              [0, 0],
            ],
          ],
          [
            [
              [-1, 3],
              [0, 0],
              [-1, 3],
            ],
          ],
        ],
      })
    ).toEqual([-1, 0, 2, 3])
    expect(featureBounds({ type: "Point", coordinates: [] })).toBeNull()
  })
})

describe("featureKind", () => {
  it("counts parts, so a one-part multipolygon is a polygon", () => {
    const ring = [
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    ]
    expect(featureKind({ type: "MultiPolygon", coordinates: [ring] })).toBe("A polygon")
    expect(featureKind({ type: "MultiPolygon", coordinates: [ring, ring] })).toBe(
      "A polygon of 2 parts"
    )
    expect(featureKind({ type: "Point", coordinates: [0, 0] })).toBe("A point")
    expect(featureKind(null)).toBe("A feature")
  })
})
