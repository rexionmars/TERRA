/**
 * What the board remembers between one opening and the next.
 *
 * The board is a component, and closing it unmounts the component. Every piece
 * of the arrangement lived in that component's state, so glancing at the map
 * and coming back threw away two areas, whatever had been dragged where, the
 * names, the order and the spread -- work that takes minutes to rebuild and no
 * time at all to lose.
 *
 * A module-level store rather than lifted state, and the reason is that
 * lifting would not have been enough: the map screen remounts when the user
 * visits another screen, so state held there would be lost by the same
 * gesture in a slightly longer form. This outlives every component.
 *
 * NOT persistence. It survives a close and it does not survive a restart --
 * that is what the comparisons table is for, and saving is a thing someone
 * asks for by name. This is the difference between putting something down and
 * throwing it away.
 */

const kept = new Map<string, unknown>()

/**
 * The area the map's own run occupies.
 *
 * Here rather than in BoardSurface because the map screen needs it and must
 * not import that module: BoardSurface reaches `three`, and importing it
 * eagerly would put half a megabyte back into the map screen's chunk.
 */
export const CURRENT_AREA = "current"

/**
 * The id of whatever the map is showing: its run, else its AOI, else nothing.
 *
 * IDENTITY IS THE SUBJECT, NOT THE SLOT. This was the bare `CURRENT_AREA` for
 * every live area, so one literal named whatever ground the map happened to be
 * on. Everything the board remembers per area -- the name a reader typed, the
 * layer order, what they removed, opacities, where they dragged it, which
 * planes are pinned in the compare editor -- is keyed by that id, and none of
 * it was ever rekeyed or pruned. Draw a second AOI and the new subject slid
 * into the previous one's name and arrangement, which is how a run appeared
 * under a name its ground never had.
 *
 * THE GROUND FIRST, WHICH IS A REVERSAL. This returned the run id first, on the
 * argument that keying by area would put two runs over the same shape into one
 * slot. The argument was right about the danger and wrong about where it lives:
 * only the LIVE area is keyed this way, and a run the map has moved on from is
 * still an area of its own under its own id, so two runs over one field remain
 * two areas and can be compared. What keying by run bought instead was an
 * identity that changed the instant a run was saved -- `aoi:x` while the area
 * was being set up, `<runId>` once it had an answer -- which orphaned every
 * per-area thing this module keeps and left the drawing to reappear beside its
 * own run as a second, empty area over the same field. Two drawings and two
 * runs made four areas, which is what a reader counted and reported.
 *
 * The sentinel keeps its one real job: an area with no run and no catalogued
 * AOI -- an example area, an adopted geometry, a studio opened on nothing.
 * `snapshotBoard` is told which id the live area is carrying rather than
 * assuming this one, since it is now rarely the answer.
 */
export function liveAreaId(
  runId?: string | null,
  aoiId?: string | null,
  /**
   * The catalogued area the SHOWN run is over, when it is known.
   *
   * Given rather than derived because only the caller can resolve it: the run
   * record carries it, and a run just saved is not in the list yet.
   */
  runAoiId?: string | null
): string {
  /*
    THE GROUND, NOT THE RUN, WHENEVER THE GROUND IS KNOWN.

    This used to return the run id first, so the live area changed identity the
    moment a run was saved: an area that was `aoi:x` while it was being set up
    became `<runId>` once it had an answer. Everything this module keys by area
    -- the name a reader typed, the layer order, where the area was dragged --
    was left behind under the old id, and the drawing reappeared beside its own
    run as a second, empty area over the same field.

    A run over a catalogued area now answers with that area, so setting one up
    and running it are one subject throughout. A run over an example area or an
    imported shape still answers with its own id: there is no area to be.
  */
  if (runId && runId !== CURRENT_AREA) return runAoiId || runId
  if (aoiId) return aoiId
  return CURRENT_AREA
}

/**
 * Whether the board has been changed since it was last saved or opened.
 *
 * ONLY THE ACTS A SAVE WOULD RECORD, which is why this is a flag set by the
 * writers rather than a comparison against the last snapshot. The scene writes
 * plane placements as it lays a board out, so a board freshly opened already
 * differs from what was stored, and a diff would report every board dirty the
 * moment it appeared.
 *
 * Read when a board is about to be replaced by another, which is the one
 * gesture that throws this work away without asking.
 */
let dirty = false
export function markBoardDirty(): void {
  dirty = true
}
export function boardIsDirty(): boolean {
  return dirty
}
/** Called when what is on disk is what is on screen: a save, or an open. */
export function clearBoardDirty(): void {
  dirty = false
}

/** Forget everything. For a board that should open empty. */
export function clearBoardMemory(): void {
  kept.clear()
  dirty = false
}

export function readBoardMemory<T>(key: string, fallback: T): T {
  return kept.has(key) ? (kept.get(key) as T) : fallback
}

export function writeBoardMemory(key: string, value: unknown): void {
  kept.set(key, value)
}

/**
 * A mutable object the board keeps across a close.
 *
 * For the things held in refs rather than in state -- where areas and planes
 * were dragged to. Returns the SAME object every time, so the ref that points
 * at it keeps working and writes into it are remembered without a copy.
 */
export function keptObject<T extends object>(key: string, initial: () => T): T {
  if (!kept.has(key)) kept.set(key, initial())
  return kept.get(key) as T
}

/**
 * Whether the board is holding an area other than the map's own run.
 *
 * The map screen decides whether to mount the board, and it can only see its
 * OWN layers -- so discarding the current result emptied that list and closed
 * a board that still had a second area on it, with a raster the user had gone
 * and fetched. Read at render rather than subscribed to: the moment that
 * matters is a render of the map screen, since it is the map screen's own
 * state that changes when a result is discarded.
 */
export function boardHoldsOtherAreas(): boolean {
  const added = kept.get("added") as
    | Record<string, readonly string[]>
    | undefined
  if (!added) return false
  return Object.entries(added).some(
    ([areaId, ids]) => areaId !== CURRENT_AREA && ids.length > 0
  )
}

/**
 * Rewrite every key that names one area so that it names another.
 *
 * THE OTHER HALF OF WHAT `snapshotBoard` DOES ON THE WAY OUT. A board is
 * stored as runs, so the live area's keys are written under the run it will
 * reopen as. Coming back, that run is usually loaded as an area of its own and
 * the keys match -- but when the map is already showing that same ground, the
 * live area carries the AREA's id (see `liveAreaId`) and the restored keys name
 * a run instead. Nothing errors: the removals, the renames, the order and the
 * placements simply do not apply, so planes taken off the board come back and
 * the reader is told nothing.
 *
 * Applied to the store in place, because everything read after it is read from
 * here. A no-op when the two ids are equal, which is the common case.
 */
export function renameBoardArea(from: string, to: string): void {
  if (!from || !to || from === to) return
  const r = renameArea(from, to)
  const added = kept.get("added") as Record<string, string[]> | undefined
  if (added) kept.set("added", r.map(added, r.byArea))
  for (const key of ["removed", "flat"] as const) {
    const set = kept.get(key) as ReadonlySet<string> | undefined
    if (set) kept.set(key, new Set(r.list([...set], r.byScene)))
  }
  const order = kept.get("order") as Record<string, string[]> | undefined
  if (order) kept.set("order", r.map(order, r.byArea))
  const names = kept.get("names") as Record<string, string> | undefined
  if (names) kept.set("names", r.map(names, r.byRow))
  const extraState = kept.get("extraState") as
    | Record<string, { opacity: number; visible: boolean }>
    | undefined
  if (extraState) kept.set("extraState", r.map(extraState, r.byScene))
  for (const [key, rename] of [
    ["places", r.byArea],
    ["planePlaces", r.byScene],
  ] as const) {
    const o = kept.get(key) as Record<string, { x: number; z: number }>
    if (!o) continue
    const next = r.map(o, rename)
    // The same object, because a ref elsewhere points at it -- see keptObject.
    for (const k of Object.keys(o)) delete o[k]
    Object.assign(o, next)
  }
}

/**
 * The whole arrangement, as plain data.
 *
 * Sets become arrays and back, because a Set does not survive JSON and the
 * store keeps these as text. Everything else is already plain.
 *
 * Deliberately NOT a dump of the map: naming the fields is what makes an old
 * saved board readable by a newer application. A dump would carry whatever
 * keys existed on the day it was written, and reading one back would mean
 * guessing which of them still mean anything.
 */
export interface BoardSnapshot {
  /** Runs on the board, by id, in the order their areas were created. */
  runIds: string[]
  /** Scene ids added per area. */
  added: Record<string, string[]>
  removed: string[]
  flat: string[]
  order: Record<string, string[]>
  names: Record<string, string>
  extraState: Record<string, { opacity: number; visible: boolean }>
  places: Record<string, { x: number; z: number }>
  planePlaces: Record<string, { x: number; z: number }>
  gap: number
  links: boolean
  labels: boolean
}

/**
 * @param areas Each area on the board, by the RUN it will be reopened as, with
 *   the scene ids actually on it.
 *
 * Not the `added` map. That records what someone ADDED, and the map's own area
 * adds nothing -- its layers arrive from the map -- so a board saved from it
 * recorded the run and not one raster of it. Reopened, the area came back
 * empty, the board had nothing to show, and its mount condition read false: the
 * menu closed and nothing happened.
 *
 * Membership is what a saved board is made of, so membership is what is saved.
 * It is also what makes reopening symmetric: every area comes back as a loaded
 * run, whichever one happened to be the map's when it was written.
 */
/*
  The map's own area is called `current` while the board is open and comes back
  as its run's id. Everything else the board remembers is keyed by an area --
  names by row, order and places by area, the rest by area and layer together --
  so a snapshot taken as written would carry keys naming an area that will not
  exist on the other side. The name given to a stack, the order set on it and
  the place it was dragged to would all be orphaned, silently.

  So the keys are rewritten on the way out. Three shapes, because the board has
  three: an area id on its own, an area and a layer joined by a null, and a row
  id whose second segment is the area.
*/
function renameArea(from: string, to: string) {
  const byArea = (k: string) => (k === from ? to : k)
  const byScene = (k: string) =>
    k.startsWith(`${from}\u0000`) ? `${to}${k.slice(from.length)}` : k
  const byRow = (k: string) => {
    const parts = k.split("::")
    if (parts.length >= 2 && parts[1] === from) {
      parts[1] = to
      return parts.join("::")
    }
    return k
  }
  const map = <T,>(o: Record<string, T>, f: (k: string) => string) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]))
  const list = (a: readonly string[], f: (k: string) => string) => a.map(f)
  return { byArea, byScene, byRow, map, list }
}

/**
 * @param areas Each area on the board, by the RUN it will be reopened as, with
 *   the scene ids actually on it.
 * @param currentRunId The run the map's own area belongs to, so its keys can
 *   be rewritten to the id it will carry when the board is opened again.
 *
 * Membership is taken from the areas rather than from the `added` map. That
 * map records what someone ADDED, and the map's own area adds nothing -- its
 * layers arrive from the map -- so a board saved from it recorded the run and
 * not one raster of it. Reopened, the area came back empty, the board had
 * nothing to show, and its mount condition read false: the menu closed and
 * nothing happened.
 */
export function snapshotBoard(
  areas: { runId: string; layerIds: string[] }[],
  currentRunId?: string,
  /**
   * The id the live area is carrying now, which is not always CURRENT_AREA.
   *
   * A board is stored as runs, so everything the live area holds has to be
   * rewritten to the run it will reopen as. That area used to be keyed by the
   * literal, then by the run id; it is now keyed by the ground it is over --
   * see `liveAreaId` -- so the key to rewrite has to be given rather than
   * assumed, or a reopened board loses the live area's names and placements.
   */
  liveId: string = CURRENT_AREA
): BoardSnapshot {
  const r = renameArea(liveId, currentRunId ?? liveId)
  return {
    runIds: areas.map((a) => a.runId),
    added: Object.fromEntries(areas.map((a) => [a.runId, [...a.layerIds]])),
    removed: r.list(
      [...readBoardMemory<ReadonlySet<string>>("removed", new Set())],
      r.byScene
    ),
    flat: r.list(
      [...readBoardMemory<ReadonlySet<string>>("flat", new Set())],
      r.byScene
    ),
    order: r.map(
      readBoardMemory<Record<string, string[]>>("order", {}),
      r.byArea
    ),
    names: r.map(
      readBoardMemory<Record<string, string>>("names", {}),
      r.byRow
    ),
    extraState: r.map(
      readBoardMemory<
        Record<string, { opacity: number; visible: boolean }>
      >("extraState", {}),
      r.byScene
    ),
    places: r.map(
      keptObject<Record<string, { x: number; z: number }>>("places", () => ({})),
      r.byArea
    ),
    planePlaces: r.map(
      keptObject<Record<string, { x: number; z: number }>>(
        "planePlaces",
        () => ({})
      ),
      r.byScene
    ),
    gap: readBoardMemory("gap", 0.1),
    links: readBoardMemory("links", false),
    labels: readBoardMemory("labels", false),
  }
}

/**
 * Replace everything with what a saved board holds.
 *
 * Cleared first, so opening a board gives that board rather than that board
 * mixed with whatever was on screen. The kept objects are refilled in place,
 * because refs elsewhere point at them.
 */
export function restoreBoard(snap: BoardSnapshot): void {
  clearBoardMemory()
  writeBoardMemory("added", snap.added)
  writeBoardMemory("removed", new Set(snap.removed))
  writeBoardMemory("flat", new Set(snap.flat))
  writeBoardMemory("order", snap.order)
  writeBoardMemory("names", snap.names)
  writeBoardMemory("extraState", snap.extraState)
  writeBoardMemory("gap", snap.gap)
  writeBoardMemory("links", snap.links)
  writeBoardMemory("labels", snap.labels)
  Object.assign(
    keptObject<Record<string, { x: number; z: number }>>("places", () => ({})),
    snap.places
  )
  Object.assign(
    keptObject<Record<string, { x: number; z: number }>>(
      "planePlaces",
      () => ({})
    ),
    snap.planePlaces
  )
}
