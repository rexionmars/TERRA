import type { Area, GeoJSONGeometry } from "@/lib/types"

/** Coordinate pair in GeoJSON axis order: [lon, lat]. */
export type LonLat = [number, number]

/**
 * Outer ring of a Polygon, or the outer ring of the first part of a
 * MultiPolygon. Returns null for geometries without a usable ring.
 */
export function polygonOuterRing(geometry: GeoJSONGeometry): LonLat[] | null {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates[0] as LonLat[]) ?? null
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry.coordinates as unknown as number[][][][]
    return (multi[0]?.[0] as LonLat[]) ?? null
  }
  return null
}

/**
 * Arithmetic mean of a linear ring's vertices.
 *
 * GeoJSON linear rings repeat the first position as the last one (RFC 7946
 * section 3.1.6), so the closing vertex is excluded to avoid weighting it
 * twice. Including it biases the result toward the first vertex by roughly
 * 15-35 m on the bundled example AOIs.
 *
 * This is the vertex centroid, not the area centroid: it is used to pick a
 * camera target for flyTo, not for any area-weighted measurement.
 */
export function ringCentroid(ring: LonLat[]): LonLat {
  if (ring.length === 0) return [0, 0]
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const count = closed ? ring.length - 1 : ring.length
  if (count === 0) return [ring[0][0], ring[0][1]]
  let lon = 0
  let lat = 0
  for (let i = 0; i < count; i++) {
    lon += ring[i][0]
    lat += ring[i][1]
  }
  return [lon / count, lat / count]
}

/** Vertex centroid of a geometry's outer ring, or null when it has none. */
export function geometryCentroid(
  geometry: GeoJSONGeometry | null | undefined
): LonLat | null {
  if (!geometry) return null
  const ring = polygonOuterRing(geometry)
  if (!ring?.length) return null
  return ringCentroid(ring)
}

/**
 * True when `activeExample` names an area that is present in `areas`.
 *
 * Requests send either an area id or an inline polygon, never both, so this
 * guard decides which branch applies. A stale id that no longer resolves falls
 * back to the drawn polygon rather than referencing a missing area.
 */
export function usesExampleArea(
  activeExample: string,
  areas: Area[]
): boolean {
  return !!activeExample && areas.some((a) => a.id === activeExample)
}
