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
