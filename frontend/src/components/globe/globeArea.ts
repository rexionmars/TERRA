/**
 * What the globe draws, and how a geometry becomes one.
 *
 * SEPARATE FROM THE SURFACE, and the separation is load-bearing rather than
 * tidy. `GlobeSurface` imports MapLibre and MapLibre's stylesheet at module
 * scope, so it is 945 kB; anything that reaches for the type or the conversion
 * would pull the library with it. The studio does exactly that -- it converts
 * its catalog whether or not any area is currently a globe, and mounts the
 * surface lazily only when one is. Both halves in one file would have made
 * that lazy boundary do nothing.
 */
import { geometryCentroid, polygonParts, type LonLat } from "@/lib/geometry"
import type { GeoJSONGeometry } from "@/lib/types"

/** One area drawn on the globe: every part of its outline, and where it is. */
export interface GlobeArea {
  id: string
  name: string
  /**
   * EVERY PART, not the outer ring alone.
   *
   * geometry.ts says why: polygonOuterRing keeps the first part of a
   * MultiPolygon, which is "enough to pick a camera target but not to draw or
   * measure one" -- rural properties are routinely split by a road or a
   * riparian buffer.
   */
  parts: LonLat[][]
  centre: LonLat
}

/**
 * One geometry as an area the globe can draw, or null if it is not drawable.
 *
 * Here rather than at each call site because there are three of them -- the
 * catalog and the projects on the globe screen, and the catalog again in the
 * studio -- and the null cases are the whole content of the function. A
 * project with no geometry of its own is the normal case, not a fault, and a
 * ring that survived the filter empty would be a shape drawn at 0,0.
 */
export function toGlobeArea(
  id: string,
  name: string,
  geometry: GeoJSONGeometry | null | undefined
): GlobeArea | null {
  if (!geometry) return null
  const parts = polygonParts(geometry)
    .map((rings) => rings[0])
    .filter((r): r is LonLat[] => !!r?.length)
  const centre = geometryCentroid(geometry)
  if (!parts.length || !centre) return null
  return { id, name, parts, centre }
}
