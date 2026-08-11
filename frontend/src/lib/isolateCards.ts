/**
 * Where each raster sits on the board, in world units.
 *
 * Pure arithmetic over `Bounds`, with no `three` import, so it can be read and
 * checked without a GL context — the geometry is the part most likely to be
 * subtly wrong, and it should not need a running scene to inspect.
 */
import type { Bounds } from "@/lib/types"
import type { RasterLayer } from "@/lib/mapLayers"
import { lonScaleAtLat } from "@/lib/geometry"

export interface CardPlane {
  id: string
  title: string
  uri: string
  opacity: number
  pixelated: boolean
  /** Size in world units, the union's longest side being 1. */
  width: number
  height: number
  /** Offset from the union's centre, in the board plane. */
  x: number
  z: number
  /** Height in the stack, from the layer's order. */
  y: number
}

function union(extents: Bounds[]): Bounds {
  return {
    lon_min: Math.min(...extents.map((e) => e.lon_min)),
    lat_min: Math.min(...extents.map((e) => e.lat_min)),
    lon_max: Math.max(...extents.map((e) => e.lon_max)),
    lat_max: Math.max(...extents.map((e) => e.lat_max)),
  }
}

/**
 * Lays the layers out as planes, normalised ONCE against their union.
 *
 * Normalising each plane against its own extent would be the obvious thing and
 * would be wrong. A classification and its confidence raster share an extent
 * exactly, so they come out identical either way and register perfectly — and
 * that registration is what makes the stack readable. But a composition can
 * cover a different window from the classification (scopeCompositionsToView
 * exists precisely because runs and compositions disagree about extent), and
 * normalising it on its own would draw a partial-coverage composition as
 * though it covered the same ground. Normalise once, offset each.
 *
 * @param gap Vertical separation between consecutive layers, in world units.
 */
export function layoutCards(layers: RasterLayer[], gap: number): CardPlane[] {
  if (!layers.length) return []

  const u = union(layers.map((l) => l.extent))
  const midLat = (u.lat_min + u.lat_max) / 2
  // Degrees of longitude shorten away from the equator, so a span in degrees
  // is not a span on the ground. Without this a Brazilian parcel is drawn
  // stretched east-west by about a tenth.
  const kx = lonScaleAtLat(midLat)

  const unionW = (u.lon_max - u.lon_min) * kx
  const unionH = u.lat_max - u.lat_min
  // The longest side becomes one world unit, so the board's scale does not
  // depend on how large the AOI happens to be.
  const scale = Math.max(unionW, unionH) || 1
  const uCx = (u.lon_min + u.lon_max) / 2
  const uCy = (u.lat_min + u.lat_max) / 2

  return layers.map((l, i) => {
    const e = l.extent
    return {
      id: l.id,
      title: l.title,
      uri: l.uri,
      opacity: l.opacity,
      pixelated: l.pixelated,
      width: ((e.lon_max - e.lon_min) * kx) / scale,
      height: (e.lat_max - e.lat_min) / scale,
      x: (((e.lon_min + e.lon_max) / 2 - uCx) * kx) / scale,
      // Negated: with the camera Y-up looking down, north is -Z.
      z: -(((e.lat_min + e.lat_max) / 2 - uCy) / scale),
      // By position in the sorted list rather than by the order number, so the
      // spacing is even however far apart the z-indices happen to be.
      y: i * gap,
    }
  })
}
