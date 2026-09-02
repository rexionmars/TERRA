/**
 * What the map surface is costing and what its zoom is worth, published
 * outside React.
 *
 * A STORE FOR THE REASON lib/mapPose.ts IS ONE. These figures change on every
 * painted frame and on every tile that lands; routed through state they would
 * reconcile the studio's tree at that rate, and the one component that wants
 * them is a strip at the foot. It publishes at 4 Hz rather than per frame,
 * which is as often as a number can be read anyway.
 *
 * WHY THESE FIGURES AND NOT A COPY OF THE BOARD'S. The board's telemetry is
 * about a renderer: how many frames, how many calls, how many triangles. A map
 * spends its time waiting for tiles, and what a reader needs to know about it
 * is different in kind:
 *
 *   level  -- the tile level being fetched, which is NOT the z on the readout
 *             and is the number every imagery service states its limits in.
 *             See lib/mapScale.ts for the measurement behind the offset.
 *   m/px   -- what one screen pixel covers on the ground. The figure that
 *             settles whether a zoom is worth anything: 10 m Sentinel-2 at
 *             8.7 m/px is at its own scale, at 1.5 m/px it is being magnified
 *             sixfold and no amount of turning the wheel will add detail.
 *   tiles  -- tiles still loading, over every source the map draws. The
 *             numeric form of "loading imagery", and the difference between a
 *             slow source and a finished one.
 *   fps    -- frames the map actually painted, and the interval between them.
 *             Measured but NOT drawn in the strip: the board's block already
 *             carries a frame rate a few pixels away, and two of them side by
 *             side belong to nothing a reader can tell apart. Kept because the
 *             measurement is free and the next reader to ask "is the pan
 *             smooth" will want it somewhere.
 *
 * All four are free. Nothing here starts a loop, forces a frame or polls: the
 * counters ride events MapLibre already fires, and the scale is arithmetic on
 * the camera. That is why they need no switch in Settings, where the board's
 * page-frame figure needs one.
 */
import type { Map as MapLibreMap } from "maplibre-gl"

import { metresPerPixel, tileLevel } from "@/lib/mapScale"

export interface MapTelemetry {
  /** The tile level being fetched at this zoom. */
  level: number
  /** Ground covered by one CSS pixel at the centre, in metres. */
  mPerPx: number
  /** Tile requests started and not yet answered. */
  tiles: number
  /** Frames painted in the last second. */
  fps: number
  /** Median interval between painted frames, in ms. */
  gapMs: number
}

let current: MapTelemetry | null = null
const listeners = new Set<() => void>()

function publish(next: MapTelemetry | null): void {
  current = next
  for (const fn of listeners) fn()
}

export function subscribeMapTelemetry(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** The last published reading, or null while no map is reporting. */
export function mapTelemetry(): MapTelemetry | null {
  return current
}

/**
 * Watch a map and publish its figures until the returned function is called.
 *
 * THE TILE COUNT IS EVENT-DERIVED AND CLAMPED. MapLibre states no public count
 * of requests in flight; what it does state is one `dataloading` per tile and
 * one `data`, `error` or `dataabort` when that tile is done, which is the same
 * pair the surface already reads for its own loading flag. Counting them can
 * drift -- an event lost to a style replacement leaves the count high -- so it
 * is floored at zero and reset whenever the map reports itself idle, where the
 * true answer is known to be none.
 */
export function attachMapTelemetry(map: MapLibreMap): () => void {
  /*
    THE TILES STILL LOADING, BY IDENTITY AND BY THEIR OWN STATE.

    Counting events does not work here, and the measurement says why: one drag
    over this map fired 16 tile-level `dataloading` events against 88 tile-level
    `data` events -- MapLibre re-emits per tile as it settles -- so a counter
    incremented on one and decremented on the other sits at zero from the first
    frame, which is exactly what the strip showed.

    Every one of those events carries `sourceId` and `tile.tileID.key`, which
    together name a tile, and `tile.state`, which is the answer being looked
    for. So the set holds what is loading and each event overwrites its own
    entry rather than adding to a running total: a repeat is idempotent, and a
    tile that never reports again is cleared by the idle below.
  */
  const loading = new Set<string>()
  let frames: number[] = []
  let stopped = false

  type TileEvent = {
    sourceId?: string
    tile?: { tileID?: { key?: string }; state?: string }
  }

  /*
    Read through a narrowing rather than through the library's event union.
    MapSourceDataEvent declares `tile` as unknown and `error` carries an
    ErrorEvent, so every handler here would need its own cast; one shape,
    applied once, keeps the reading in one place and the casts at the edge.
  */
  const seen = (raw: unknown) => {
    const e = raw as TileEvent
    const key = e.tile?.tileID?.key
    if (!key) return
    const id = `${e.sourceId ?? "?"}:${key}`
    if (e.tile?.state === "loading") loading.add(id)
    else loading.delete(id)
  }
  const onRender = () => frames.push(performance.now())
  // Idle is MapLibre stating that nothing is outstanding, which is the one
  // moment the true count is known rather than accumulated.
  const onIdle = () => loading.clear()

  const subs = [
    map.on("dataloading", seen),
    map.on("data", seen),
    map.on("dataabort", seen),
    // A tile that failed is still a request that has landed. Leaving `error`
    // out is what would let the count climb over a bad link until the next
    // idle.
    map.on("error", seen),
    map.on("render", onRender),
    map.on("idle", onIdle),
  ]

  const tick = window.setInterval(() => {
    if (stopped) return
    const now = performance.now()
    frames = frames.filter((t) => now - t < 1000)
    // The median interval, not the mean: a map that drew twenty frames for a
    // gesture and then stood still has one enormous gap, and a mean over it
    // describes neither the gesture nor the rest.
    const gaps: number[] = []
    for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1])
    gaps.sort((a, b) => a - b)
    const c = map.getCenter()
    const zoom = map.getZoom()
    publish({
      level: tileLevel(zoom),
      mPerPx: metresPerPixel(zoom, c.lat),
      tiles: loading.size,
      fps: frames.length,
      gapMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
    })
  }, 250)

  return () => {
    stopped = true
    window.clearInterval(tick)
    for (const s of subs) s.unsubscribe()
    // Nothing is reporting any more, and a strip left showing the last frame
    // of a map that has been unmounted is a reading about nothing.
    publish(null)
  }
}

/**
 * A distance in the unit that keeps it to three or four characters.
 *
 * A status strip has room for a number, not for a number and an exponent. The
 * range this covers is z0 to z22, which is 78 km to 4 cm at the equator.
 */
export function formatGround(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)}km`
  if (metres >= 10) return `${metres.toFixed(0)}m`
  if (metres >= 1) return `${metres.toFixed(1)}m`
  return `${(metres * 100).toFixed(0)}cm`
}
