/**
 * The one polygon an imported file is read as.
 *
 * A FILE IS NOT A DRAWING, and the difference is in the coordinates. Google
 * Earth writes every vertex as `lon,lat,0` at fifteen decimals; the draw store
 * accepts a position of exactly two numbers at no more than nine
 * (terra-draw's `coordinatePrecision`) and rejects the feature otherwise. The
 * area was created and its outline never reached the map. So the shape is
 * brought to what a hand would have produced: two numbers per vertex, nine
 * decimals -- about 0.1 mm of ground -- and a ring that closes.
 *
 * THE FIRST POLYGON, wherever the file keeps it. A KML MultiGeometry arrives
 * as a GeometryCollection and a multi-part placemark as a MultiPolygon, and a
 * search that only looked at top-level Polygon features reported "no polygon"
 * for files that held several. One area is the rule of the surface this feeds,
 * so the first is taken rather than the union.
 */
import type { GeoJSONGeometry } from "@/lib/types"

const PRECISION = 9

type Loose = {
  type?: string
  coordinates?: unknown
  geometry?: Loose | null
  geometries?: Loose[]
  features?: Loose[]
}

function firstRings(node: Loose | null | undefined): number[][][] | null {
  if (!node) return null
  switch (node.type) {
    case "Polygon":
      return node.coordinates as number[][][]
    case "MultiPolygon":
      return (node.coordinates as number[][][][])[0] ?? null
    case "Feature":
      return firstRings(node.geometry)
    case "GeometryCollection":
    case "FeatureCollection": {
      for (const child of node.geometries ?? node.features ?? []) {
        const rings = firstRings(child)
        if (rings) return rings
      }
      return null
    }
    default:
      return null
  }
}

function round(v: number): number {
  const k = 10 ** PRECISION
  return Math.round(v * k) / k
}

/** The first polygon in a parsed GeoJSON value, or null when it holds none. */
export function importedPolygon(parsed: unknown): GeoJSONGeometry | null {
  const rings = firstRings(parsed as Loose)
  if (!rings?.length) return null
  const coordinates = rings.map((ring) => {
    const out = ring.map((p) => [round(p[0]), round(p[1])])
    const a = out[0]
    const b = out[out.length - 1]
    if (a && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1]])
    return out
  })
  // Three vertices and the closing one: fewer is a line, not ground.
  if (coordinates[0].length < 4) return null
  return { type: "Polygon", coordinates }
}
