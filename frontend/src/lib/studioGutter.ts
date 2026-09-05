/**
 * Whether the studio's panels are separated by a gap, and where that lives.
 *
 * A store rather than a prop, for the reason `lib/studioTelemetry.ts` is one:
 * the readers are four places at three depths -- the tree that lays the areas
 * out, the area that decides whether it has a corner to round, the lookup that
 * places the 3D viewport's overlays, and a keydown handler that runs outside
 * React's tree entirely. Threading a boolean to all four through App would put
 * a chrome preference in the component whose every state change reconciles the
 * application.
 *
 * ONE FUNCTION ANSWERS IT FOR EVERYONE, and that is the whole point of the
 * module. `areaRects` takes the gap as a parameter precisely so that three
 * call sites cannot disagree about where an area is; a preference read
 * separately by each of them would hand that disagreement straight back.
 *
 * Seeded from preferences on sign-in and written back on change, so the choice
 * outlives a restart the way the other settings on that page do.
 */
import { AREA_GUTTER_PX } from "@/lib/boardAreas"

/**
 * ON, WHICH IS WHAT SHIPPED AND WHAT THE BOARD IS DRAWN FOR.
 *
 * The areas carry no border while the gap is on -- a strip of the window's
 * ground says "separate object" without a rule to resolve -- so the gap is not
 * decoration that can simply be removed. Turning it off puts the border back.
 * See StudioArea.
 */
const DEFAULT = true

let on = DEFAULT
const listeners = new Set<() => void>()

/**
 * Set the preference. Called when preferences load and when the switch moves.
 *
 * Only an exact `false` turns it off, so an absent key, a value written by a
 * newer build and a corrupted blob all resolve to the behaviour that shipped
 * -- the same doctrine `alwaysShowWhatsNewFromPrefs` states for its own key.
 */
export function setStudioGutter(next: boolean | undefined): void {
  const value = next !== false
  if (value === on) return
  on = value
  for (const fn of listeners) fn()
}

export function subscribeStudioGutter(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Whether the gap is on, which is the question the settings row asks. */
export function studioGutterOn(): boolean {
  return on
}

/**
 * How wide the gap is, which is the question every geometry caller asks.
 *
 * Returns a number rather than a boolean so a caller passes it straight to
 * `areaRects` and never writes the conditional itself. Four of them writing
 * `on ? AREA_GUTTER_PX : 0` is four chances to write one of them backwards.
 */
export function studioGutterPx(): number {
  return on ? AREA_GUTTER_PX : 0
}
