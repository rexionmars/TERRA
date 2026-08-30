import type { GeoJSONGeometry } from "@/lib/types"

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
 * Whether two geometries describe the same ground.
 *
 * FOR RUNS WRITTEN BEFORE THEY RECORDED WHICH AREA THEY WERE OF. A run stores
 * the polygon it was made over, so a run and the catalogued drawing behind it
 * hold the same ring — the run was sent that exact geometry. Equality on the
 * ring is therefore the honest test, and this is not a spatial predicate: two
 * drawings of the same field by hand are different ground here, correctly, and
 * anything that wanted overlap would have to measure it.
 *
 * The tolerance is a float round trip through JSON and nothing more. 1e-9
 * degrees is about a tenth of a millimetre, far under the precision any of
 * these coordinates carry.
 */
export function sameGround(
  a: GeoJSONGeometry | null | undefined,
  b: GeoJSONGeometry | null | undefined
): boolean {
  if (!a || !b) return false
  const ra = polygonOuterRing(a)
  const rb = polygonOuterRing(b)
  if (!ra || !rb || ra.length !== rb.length) return false
  return ra.every(
    (p, i) =>
      Math.abs(p[0] - rb[i][0]) < 1e-9 && Math.abs(p[1] - rb[i][1]) < 1e-9
  )
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

/** Longitude/latitude bounds over every part. */
/**
 * How much a degree of longitude shrinks at a given latitude.
 *
 * A span in degrees is not a span on the ground: meridians converge, so a
 * degree of longitude covers cos(latitude) of what a degree of latitude does.
 * Normalising an extent without this draws a Brazilian parcel stretched
 * east-west by about a tenth, and a Nordic one by half.
 *
 * Named here rather than written where it is needed, because it is needed in
 * two places now -- the footprint thumbnail and the whiteboard -- and this
 * repository has already been bitten by a value that existed twice.
 */
export function lonScaleAtLat(lat: number): number {
  return Math.cos((lat * Math.PI) / 180) || 1
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
export function geometryAreaM2(
  geometry: GeoJSONGeometry | null | undefined
): number {
  if (!geometry) return 0
  const bounds = geometryBounds(geometry)
  if (!bounds) return 0
  const midLat = (bounds.latMin + bounds.latMax) / 2
  const kx = METRES_PER_DEGREE * Math.cos((midLat * Math.PI) / 180)
  const ky = METRES_PER_DEGREE

  const ringArea = (ring: LonLat[]): number => {
    if (!ring || ring.length < 3) return 0
    const closed =
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
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

/**
 * AOI geometry of a project, or null when it has none.
 *
 * It also accepted a project storing an `area_id` referencing one of the three
 * embedded example areas, resolved against a list passed in. Those are gone,
 * and a project now holds the polygon or nothing. Projects created from the hub
 * start with nothing, so the absent case is normal rather than exceptional.
 */
export function resolveProjectGeometry(project: {
  polygon_geojson?: string
}): GeoJSONGeometry | null {
  const raw = project.polygon_geojson?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as GeoJSONGeometry
    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") {
      return parsed
    }
  } catch {
    /* stored text is opaque */
  }
  return null
}

/** Ray-cast point-in-polygon (lon/lat), for AOI right-click hit testing. */
// Moved here from MapView when a second map surface needed the same test: a
// hit test written twice is a hit test that can disagree with itself about
// what is inside an area.
export function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInAoi(lon: number, lat: number, geometry: GeoJSONGeometry): boolean {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as LonLat[][]
    const outer = coords[0]
    if (!outer || !pointInRing(lon, lat, outer)) return false
    for (let h = 1; h < coords.length; h++) {
      if (pointInRing(lon, lat, coords[h])) return false
    }
    return true
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry.coordinates as unknown as LonLat[][][]
    return multi.some((poly) => {
      const outer = poly[0]
      if (!outer || !pointInRing(lon, lat, outer)) return false
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) return false
      }
      return true
    })
  }
  return false
}

/** Longest edge in the southern band of the AOI — label glues to this segment. */
export function pickContourEdge(geometry: GeoJSONGeometry): {
  a: LonLat
  b: LonLat
  mid: LonLat
} | null {
  const ring = polygonOuterRing(geometry)
  if (!ring || ring.length < 2) return null

  let latMin = Infinity
  let latMax = -Infinity
  for (const [, lat] of ring) {
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
  }
  const southBand = latMin + (latMax - latMin) * 0.4

  let best: { a: LonLat; b: LonLat; mid: LonLat; score: number } | null = null
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const dlon = b[0] - a[0]
    const dlat = b[1] - a[1]
    const len = Math.hypot(dlon, dlat)
    if (len < 1e-12) continue
    // Prefer southern long edges (Wheat Field labels sit on the bottom contour).
    const southBonus = mid[1] <= southBand ? 3 : 1
    const score = len * southBonus - (mid[1] - latMin) * 0.15
    if (!best || score > best.score) {
      best = { a, b, mid, score }
    }
  }
  if (!best) return null
  return { a: best.a, b: best.b, mid: best.mid }
}


