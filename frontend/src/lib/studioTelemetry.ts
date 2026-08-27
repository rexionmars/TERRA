/**
 * Which figures the studio's status bar reports, and where that choice lives.
 *
 * A store rather than props, for the reason lib/panelSelection.ts is one: the
 * readers are the status bar, deep inside the studio, and the scene, which is
 * not React at all. Routing a preference to both through App would put it in
 * the component whose every state change reconciles the application.
 *
 * Seeded from preferences on sign-in and written back on change, so the choice
 * outlives a restart the way the other settings on that page do.
 */

/** One switchable figure, and what it costs to have on. */
export interface TelemetryFigure {
  key: TelemetryKey
  label: string
  /** What the figure means, in the words the settings row uses. */
  what: string
  /**
   * When it is worth having on. Not a rating: each says the question it
   * answers, because a reader turning these on is diagnosing something and the
   * useful thing to know is which figure speaks to which symptom.
   */
  when: string
  /**
   * What having it on costs, or null where it is free.
   *
   * Only one of these is not free, and it is the most useful of them, so the
   * cost is stated rather than the figure being left out or left on quietly.
   */
  cost: string | null
}

export type TelemetryKey =
  | "page"
  | "fps"
  | "work"
  | "pointer"
  | "draws"
  | "resources"
  | "buffer"

export const TELEMETRY_FIGURES: readonly TelemetryFigure[] = [
  {
    key: "page",
    label: "Page frame rate",
    what: "How fast the browser delivers frames, measured by a loop that draws nothing.",
    when: "First, when anything feels slow. It is the figure that says whether the studio is the cause at all — if it is low while the frame work below is near zero, nothing being drawn here is the reason.",
    cost: "Keeps the page animating for as long as the studio is open, which is the state it measures and not one the studio would otherwise sit in. On battery, leave it off until something needs diagnosing.",
  },
  {
    key: "fps",
    label: "Board frame rate",
    what: "Frames the board actually drew, and the interval between them.",
    when: "Beside the page rate. The board draws on demand, so a long interval on a still scene is the board idling rather than a fault.",
    cost: null,
  },
  {
    key: "work",
    label: "Frame work",
    what: "Time spent inside one frame: controls, draw, orientation helper, labels.",
    when: "When the board is the suspect. This is the only figure that accuses the scene itself; a high page rate with high work here means the drawing is what costs.",
    cost: null,
  },
  {
    key: "pointer",
    label: "Pointer cost",
    what: "Time inside one pointer event, and how many arrive per second.",
    when: "When a drag is worse than an idle scene. Pointer handlers run outside the animation callback, so an expensive one blocks frames without appearing in the frame timing.",
    cost: null,
  },
  {
    key: "draws",
    label: "Draw calls",
    what: "Draw calls and triangles submitted for the last frame.",
    when: "When a board has grown. Both should stay small here — a raster is two triangles — so a large count means something is being drawn per plane that should not be.",
    cost: null,
  },
  {
    key: "resources",
    label: "GPU resources",
    what: "Textures and geometries the renderer is holding.",
    when: "When opening and closing boards. These should return to where they were; a count that only climbs is something not being released.",
    cost: null,
  },
  {
    key: "buffer",
    label: "Drawing buffer",
    what: "The buffer's size in device pixels, and the ratio it was built at.",
    when: "When the cost seems to track the window rather than the scene. A frame that draws almost nothing still has to be moved, and this is how much of it there is to move.",
    cost: null,
  },
] as const

export type StudioTelemetry = Partial<Record<TelemetryKey, boolean>>

/**
 * Off by default, all of it.
 *
 * A status bar that reports its own performance to a reader who did not ask is
 * chrome spent on a question they are not holding. These are switched on to
 * diagnose something and switched off after -- and the one with a cost must not
 * be on for anyone who has not read what it costs.
 */
export const TELEMETRY_DEFAULT: StudioTelemetry = {}

let shown: StudioTelemetry = TELEMETRY_DEFAULT
const listeners = new Set<() => void>()

/** Replaces the whole set. Called when preferences load and when one changes. */
export function setStudioTelemetry(next: StudioTelemetry): void {
  shown = next
  for (const fn of listeners) fn()
}

export function subscribeStudioTelemetry(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** The reference is stable between writes, which useSyncExternalStore needs. */
export function studioTelemetry(): StudioTelemetry {
  return shown
}

/** Whether one figure is on, which is the only question most callers have. */
export function telemetryShows(key: TelemetryKey): boolean {
  return shown[key] === true
}
