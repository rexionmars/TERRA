/**
 * What the board can run on its own area.
 *
 * In a module of its own so the map screen can name the shape without
 * importing the board's column. That column is reached from IsolateBoard,
 * which reaches `three`; a type-only import is erased and would be harmless
 * today, but the boundary that keeps half a megabyte out of the map screen's
 * chunk is not one to leave depending on which imports a bundler decides to
 * follow.
 *
 * Described rather than performed: what a run needs, whether it can go and how
 * far it is are the map screen's to know. The board only says so and offers
 * the button.
 */
export interface BoardTask {
  id: string
  label: string
  /** What it will run with -- the period, the model -- as one line. */
  detail: string
  running: boolean
  progress: number
  progressMsg: string
  /** False with the reason, so a refusal is never silent. */
  canRun: boolean
  blockedBy?: string
  onRun: () => void
}
