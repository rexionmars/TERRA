import type { GeoJSONGeometry } from "@/lib/types"

/** Coordinate pair in GeoJSON axis order: [lon, lat]. */
export type LonLat = [number, number]

/**
 * Outer ring of a Polygon, or the outer ring of the first part of a
 * MultiPolygon. Returns null for geometries without a usable ring.
 */
function polygonOuterRing(geometry: GeoJSONGeometry): LonLat[] | null {
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
function ringCentroid(ring: LonLat[]): LonLat {
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

/**
 * Every ring of a geometry, as [outer, ...holes] per part.
 *
 * polygonOuterRing keeps only the first part of a MultiPolygon, which is enough
 * to pick a camera target but not to draw or measure one: rural properties are
 * routinely split into several parts by a road or a riparian buffer, and the
 * dropped parts would be missing from both the outline and the area.
 */
export function polygonParts(geometry: GeoJSONGeometry): LonLat[][][] {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as unknown as LonLat[][]
    return rings?.length ? [rings] : []
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry.coordinates as unknown as LonLat[][][]
    return (multi ?? []).filter((part) => part?.length)
  }
  return []
}

export function geometryBounds(
  geometry: GeoJSONGeometry | null | undefined
): { lonMin: number; latMin: number; lonMax: number; latMax: number } | null {
  if (!geometry) return null
  let lonMin = Infinity
  let latMin = Infinity
  let lonMax = -Infinity
  let latMax = -Infinity
  for (const part of polygonParts(geometry)) {
    for (const [lon, lat] of part[0] ?? []) {
      if (lon < lonMin) lonMin = lon
      if (lat < latMin) latMin = lat
      if (lon > lonMax) lonMax = lon
      if (lat > latMax) latMax = lat
    }
  }
  if (!Number.isFinite(lonMin) || !Number.isFinite(latMin)) return null
  return { lonMin, latMin, lonMax, latMax }
}

/** Metres per degree on a sphere of the mean Earth radius (IUGG). */
const EARTH_RADIUS_M = 6371008.8
const METRES_PER_DEGREE = (2 * Math.PI * EARTH_RADIUS_M) / 360

/**
 * Area in square metres, summing outer rings and subtracting interior rings.
 *
 * Uses a shoelace on an equirectangular projection about the geometry's own
 * latitude, which at field scale agrees with the spherical-excess formula to
 * within a few square metres over tens of hectares.
 *
 * Both axes take the same metres-per-degree constant, with longitude scaled by
 * cos(latitude). Mixing the usual ellipsoidal pair (111320 for longitude,
 * 110540 for latitude) instead introduces a systematic bias of about 0.48
 * percent, which is 0.34 ha on a 71 ha parcel.
 */
function geometryAreaM2(geometry: GeoJSONGeometry | null | undefined): number {
  if (!geometry) return 0
  const bounds = geometryBounds(geometry)
  if (!bounds) return 0
  const midLat = (bounds.latMin + bounds.latMax) / 2
  const kx = METRES_PER_DEGREE * Math.cos((midLat * Math.PI) / 180)
  const ky = METRES_PER_DEGREE

  const ringArea = (ring: LonLat[]): number => {
    if (!ring || ring.length < 3) return 0
    const closed =
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    const pts = closed ? ring.slice(0, -1) : ring
    let sum = 0
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      sum += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky)
    }
    return Math.abs(sum / 2)
  }

  let total = 0
  for (const part of polygonParts(geometry)) {
    total += ringArea(part[0])
    for (let h = 1; h < part.length; h++) total -= ringArea(part[h])
  }
  return Math.max(0, total)
}

export function geometryAreaHectares(
  geometry: GeoJSONGeometry | null | undefined
): number {
  return geometryAreaM2(geometry) / 10_000
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

/*
  THE OUTLINE THE MAP CAN EDIT, AND THE HOLES IT CANNOT.

  terra-draw, which draws and edits the area in hand, refuses a feature whose
  coordinates carry more decimals than its precision of nine, and one with
  holes, and refuses it without a word: the feature is simply not in its store.
  A field delineated by the sidecar has both, so it could not be edited, and a
  store holding no polygon reported the area as removed when the cut mode
  cleared its guide points. So the store is given the outline alone, at nine
  decimals (about 0.1 mm of ground, what importedPolygon brings a file to), and
  an edit made on it gets the holes back.
*/
const DRAW_DECIMALS = 9

function atDrawPrecision(v: number): number {
  const k = 10 ** DRAW_DECIMALS
  return Math.round(v * k) / k
}

/** A Polygon's outline as the draw store holds it, or null for anything else. */
export function drawableOutline(geometry: GeoJSONGeometry): GeoJSONGeometry | null {
  if (geometry.type !== "Polygon" || !geometry.coordinates[0]?.length) return null
  const ring = geometry.coordinates[0].map((p) => [
    atDrawPrecision(p[0]),
    atDrawPrecision(p[1]),
  ])
  return { type: "Polygon", coordinates: [ring] }
}

/** Whether a point lies inside a ring, by the crossings of a ray to the east. */
function insideRing(pt: number[], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * An outline edited on the map, with the holes of the polygon it was edited
 * from that still lie inside it. A hole the new outline has left outside is
 * dropped: it is no longer ground inside the field to leave out.
 */
export function withHolesInside(
  outline: GeoJSONGeometry,
  original: GeoJSONGeometry
): GeoJSONGeometry {
  if (outline.type !== "Polygon" || original.type !== "Polygon") return outline
  const ring = outline.coordinates[0]
  const holes = original.coordinates
    .slice(1)
    .filter((h) => h.every((p) => insideRing(p, ring)))
  return { type: "Polygon", coordinates: [ring, ...holes] }
}
