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

/** Forget everything. For a board that should open empty. */
export function clearBoardMemory(): void {
  kept.clear()
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

export function snapshotBoard(runIds: string[]): BoardSnapshot {
  return {
    runIds,
    added: Object.fromEntries(
      Object.entries(
        readBoardMemory<Record<string, readonly string[]>>("added", {})
      ).map(([k, v]) => [k, [...v]])
    ),
    removed: [...readBoardMemory<ReadonlySet<string>>("removed", new Set())],
    flat: [...readBoardMemory<ReadonlySet<string>>("flat", new Set())],
    order: { ...readBoardMemory<Record<string, string[]>>("order", {}) },
    names: { ...readBoardMemory<Record<string, string>>("names", {}) },
    extraState: {
      ...readBoardMemory<
        Record<string, { opacity: number; visible: boolean }>
      >("extraState", {}),
    },
    places: { ...keptObject<Record<string, { x: number; z: number }>>("places", () => ({})) },
    planePlaces: {
      ...keptObject<Record<string, { x: number; z: number }>>(
        "planePlaces",
        () => ({})
      ),
    },
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
