/**
 * Undo over whole snapshots of a state, as Solara keeps its project's.
 *
 * A snapshot per step rather than an inverse per operation, because the board's
 * edits are written by dozens of handlers and an inverse for each would be a
 * second implementation of every one of them, free to disagree with the first.
 * The states recorded here are immutable -- every writer replaces a set or a
 * record rather than mutating it -- so a snapshot is a handful of references
 * and costs nothing to keep.
 *
 * CHANGES CLOSE TOGETHER ARE ONE STEP. A drag on an opacity field writes forty
 * values in a second; undoing it one value at a time would make the history
 * useless for anything else. A change within `mergeMs` of the previous one
 * extends that step, so undo returns to where the burst began.
 */
export class UndoHistory<T> {
  private past: T[] = []
  private future: T[] = []
  private current: T | null = null
  private lastChange = -Infinity

  constructor(
    private readonly same: (a: T, b: T) => boolean,
    private readonly mergeMs = 800,
    private readonly limit = 100
  ) {}

  /** The state as it is now. The first call sets the baseline and records nothing. */
  record(next: T, now: number): void {
    if (this.current === null) {
      this.current = next
      return
    }
    if (this.same(this.current, next)) return
    if (now - this.lastChange > this.mergeMs) {
      this.past.push(this.current)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.future = []
    this.current = next
    this.lastChange = now
  }

  /**
   * Take the state as it is without making it a step: a change nobody made by
   * hand, such as a new run arriving, which undo must not take back.
   */
  rebase(next: T): void {
    this.current = next
  }

  /** The state before the last step, or null when there is none. */
  undo(): T | null {
    const prev = this.past.pop()
    if (prev === undefined || this.current === null) return null
    this.future.push(this.current)
    this.current = prev
    // The next edit starts a step of its own rather than extending this one.
    this.lastChange = -Infinity
    return prev
  }

  /** The state an undo left, or null when there is none. */
  redo(): T | null {
    const next = this.future.pop()
    if (next === undefined || this.current === null) return null
    this.past.push(this.current)
    this.current = next
    this.lastChange = -Infinity
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Forget every step and the baseline, for a state that starts over. */
  reset(): void {
    this.past = []
    this.future = []
    this.current = null
    this.lastChange = -Infinity
  }
}
