/**
 * How this application moves, named once.
 *
 * The same argument `components/ui/buttons.ts` makes about its own subject, at
 * the same stage. Motion was written at each site: a screen eased over 0.24s on
 * a custom cubic, a modal's scrim faded over 0.12s while the dialog under it
 * rode a 380/32 spring, a panel rode the same spring by coincidence rather than
 * by decision, and the studio's own surfaces carried a third pair. Four
 * transitions, four opinions, and no way to change how the application feels
 * without finding all of them.
 *
 * NAMED FOR WHAT THEY DO, not for how long they take. `SURFACE` is what a thing
 * the size of a screen or a panel arrives on; `SCRIM` is what a fade behind a
 * dialog takes. A name like `fast` would have to be re-decided every time
 * something new is animated, and two callers would answer differently.
 *
 * WHAT IS NOT HERE: the splash. Its Ken Burns and its cross-fade are in
 * index.css, run before any bundle loads, and cannot import this. They are also
 * the one place in the application that already honours prefers-reduced-motion
 * on its own, with the argument written beside them.
 */

/**
 * A surface arriving or leaving: a screen, a panel, a dialog.
 *
 * A spring rather than a duration. These carry weight -- a dialog is a plate
 * and a panel is a drawer -- and a spring is what makes a thing look like it
 * has mass rather than like it was faded in. 380/32 is what three of the four
 * sites had already converged on by hand; this is that decision, written down.
 */
export const SURFACE = { type: "spring", stiffness: 380, damping: 32 } as const

/**
 * The scrim behind a dialog.
 *
 * Short and linear, because it is not a thing arriving -- it is the room going
 * dark. Given the surface spring it would arrive after the dialog it is meant
 * to sit behind.
 */
export const SCRIM = { duration: 0.12 } as const

/**
 * One screen replacing another.
 *
 * Not the surface spring: a screen crosses the whole stage, and a spring over
 * that distance overshoots by enough to read as a bounce. The curve is an ease
 * that leaves quickly and settles long, which is what makes a long travel feel
 * short.
 */
export const SCREEN = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
} as const

/**
 * A press, in milliseconds for CSS rather than for motion.
 *
 * Kept here so the one thing that answers a pointer immediately is declared
 * beside the things that answer it over time.
 */
export const PRESS_MS = 90
