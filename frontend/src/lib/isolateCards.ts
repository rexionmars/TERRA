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

/**
 * A plane to build, and nothing about its current state.
 *
 * Opacity and visibility used to live here and had to leave. This type is what
 * the scene is BUILT from, and IsolateBoard keeps it stable across renders so
 * the scene is not rebuilt for every change -- which means a card outlives the
 * state it was created with. A card carrying `visible` was a card that could
 * resurrect an old answer the moment anything rebuilt the scene, and something
 * did. State reaches the scene through setAppearance, which is one path
 * instead of two.
 */
export interface CardPlane {
  id: string
  title: string
  uri: string
  pixelated: boolean
  /** Size in world units; see `layoutGroups` for what one unit is. */
  width: number
  height: number
  /** Offset from the GROUP's centre, in the board plane. */
  x: number
  z: number
  /** Height in the stack, from the layer's order. */
  y: number
}

/** One area's stack: the planes, and where the stack itself sits. */
export interface CardGroup {
  id: string
  title: string
  cards: CardPlane[]
  /** Where the group's centre sits on the board. */
  x: number
  z: number
  /** The group's own footprint, in the same units as the cards. */
  width: number
  height: number
}

export interface GroupInput {
  id: string
  title: string
  layers: RasterLayer[]
  /**
   * Where the group was left, for an arrangement being restored.
   *
   * Undefined means "place it": a group appearing for the first time is laid
   * out beside the others, and one being reopened goes back where it was put.
   */
  at?: { x: number; z: number }
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
 * A box's size in units proportional to metres, not to degrees.
 *
 * Degrees of longitude shorten away from the equator, so a span in degrees is
 * not a span on the ground. Without this a Brazilian parcel is drawn stretched
 * east-west by about a tenth.
 */
function groundSize(u: Bounds): { w: number; h: number; kx: number } {
  const kx = lonScaleAtLat((u.lat_min + u.lat_max) / 2)
  return { w: (u.lon_max - u.lon_min) * kx, h: u.lat_max - u.lat_min, kx }
}

/** Clear space between two areas, as a fraction of the largest one's side. */
const AREA_MARGIN = 0.3

/**
 * Lays out one or more areas side by side, at a COMMON scale.
 *
 * The scale is the crux, and it is the one decision here that cannot be undone
 * by moving something afterwards. Normalising each area to its own longest side
 * would draw them the same size on screen, which flatters a comparison: two
 * areas an order of magnitude apart in extent would look alike, and any
 * statement about how much of something there is would be read off a picture
 * that had removed the difference. One divisor for all of them -- the largest
 * area's longest side -- means a group half the width of another is drawn half
 * the width of it, and the picture cannot say otherwise.
 *
 * Within a group the layers are normalised ONCE against the group's union
 * rather than each against its own extent. A classification and its confidence
 * raster share an extent exactly and so come out identical either way, and
 * that registration is what makes the stack readable; but a composition can
 * cover a different window (scopeCompositionsToView exists precisely because
 * runs and compositions disagree about extent), and normalising it alone would
 * draw partial coverage as though it covered the same ground.
 *
 * @param gap Vertical separation between consecutive layers, in world units.
 */
export function layoutGroups(groups: GroupInput[], gap: number): CardGroup[] {
  const live = groups.filter((g) => g.layers.length > 0)
  if (!live.length) return []

  const unions = live.map((g) => union(g.layers.map((l) => l.extent)))
  const sizes = unions.map(groundSize)
  // The largest area's longest side becomes one world unit, so the board's
  // scale does not depend on which areas happen to be on it.
  const scale = Math.max(...sizes.map((s) => Math.max(s.w, s.h))) || 1

  const widths = sizes.map((s) => s.w / scale)
  const heights = sizes.map((s) => s.h / scale)

  /*
    Placed left to right and centred as a whole, so opening a board with two
    areas frames both rather than one and a half. Only groups that need a
    place take one: a restored arrangement keeps what it was given, and a new
    group joining it goes to the right of everything.
  */
  const placed = live.map((g, i) => ({ g, i, at: g.at }))
  const needsPlace = placed.filter((p) => !p.at)
  const spanNeeded =
    needsPlace.reduce((sum, p) => sum + widths[p.i], 0) +
    AREA_MARGIN * Math.max(0, needsPlace.length - 1)
  // New groups start to the right of anything already placed, so restoring an
  // arrangement and then adding to it does not drop the new one on top.
  const placedRight = placed
    .filter((p) => p.at)
    .reduce(
      (max, p) => Math.max(max, (p.at as { x: number }).x + widths[p.i] / 2),
      Number.NEGATIVE_INFINITY
    )
  let cursor = Number.isFinite(placedRight)
    ? placedRight + AREA_MARGIN
    : -spanNeeded / 2

  return live.map((g, i) => {
    const u = unions[i]
    const { kx } = sizes[i]
    const uCx = (u.lon_min + u.lon_max) / 2
    const uCy = (u.lat_min + u.lat_max) / 2

    let x: number, z: number
    if (g.at) {
      x = g.at.x
      z = g.at.z
    } else {
      x = cursor + widths[i] / 2
      cursor += widths[i] + AREA_MARGIN
      z = 0
    }

    return {
      id: g.id,
      title: g.title,
      x,
      z,
      width: widths[i],
      height: heights[i],
      cards: g.layers.map((l, n) => {
        const e = l.extent
        return {
          id: l.id,
          title: l.title,
          uri: l.uri,
          pixelated: l.pixelated,
          width: ((e.lon_max - e.lon_min) * kx) / scale,
          height: (e.lat_max - e.lat_min) / scale,
          x: (((e.lon_min + e.lon_max) / 2 - uCx) * kx) / scale,
          // Negated: with the camera Y-up looking down, north is -Z.
          z: -(((e.lat_min + e.lat_max) / 2 - uCy) / scale),
          // By position in the sorted list rather than by the order number, so
          // the spacing is even however far apart the z-indices happen to be.
          y: n * gap,
        }
      }),
    }
  })
}
