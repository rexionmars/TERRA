/**
 * The button primitives, derived from a sweep of all 196 button sites.
 *
 * The application had 14 distinct primary treatments across 5 heights and 3
 * disabled conventions, ghost buttons in two unrelated idioms, and icon buttons
 * drawing their hover from 4 different sources. None of that was a decision --
 * it was the same handful of buttons written many times.
 *
 * DELIBERATELY NOT BUILT ON .ar-ghost. That rule is unlayered in index.css and
 * sets border-color and background, and .ar-ghost:hover sets background again,
 * so on any element carrying it every border-*, bg-* and hover:bg-* utility is
 * permanently inert -- which is why one site's hover:border-destructive never
 * painted and nobody noticed. These strings reproduce what .ar-ghost paints via
 * its own fallbacks, in utilities that can actually be overridden.
 *
 * The measured constraints these encode:
 *   - A filled accent button takes near-black (5.23 dark, 5.00 light). White on
 *     the same fill is 3.43 and fails WCAG 1.4.3.
 *   - No whole-element hover fade on a filled button: hover:opacity-90 drops the
 *     label to 4.45 dark / 4.29 light, under the floor.
 *   - The destructive fill and its label are checked in lib/contrast.ts, because
 *     the pair shipped at 3.12 until it was.
 */

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

/** One convention across the whole set, so two buttons in a row never differ. */
const DISABLED = "disabled:opacity-60"

/**
 * The chassis height, 32px, which is also what .field-input sets. A primary
 * beside an input lines up without either knowing about the other.
 */
export const btnPrimary =
  `inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-body font-semibold text-primary-foreground ${DISABLED} ${FOCUS}`

/**
 * The taller primary, for the single committing action that anchors a panel
 * foot or a modal foot. The second height is earned rather than cosmetic: at
 * 32px in a foot bar the terminal action reads as toolbar chrome.
 *
 * Callers add their own w-full or flex-1; the string omits both because w-full
 * inside a flex row fights flex-1.
 */
export const btnPrimaryCommit =
  `inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary px-4 text-emphasis font-semibold text-primary-foreground ${DISABLED} ${FOCUS}`

export const btnDestructive =
  `inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-destructive px-3 text-body font-semibold text-destructive-foreground ${DISABLED} ${FOCUS}`

export const btnGhost =
  `inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-line/40 bg-ink/45 px-3 text-body text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground ${DISABLED} ${FOCUS}`

/**
 * The dense band, 28px. Real rather than lazy: these sit in a table toolbar, an
 * overlay-card foot that wraps, and a project-card action row, where 4px per
 * control repeats per row or per card.
 */
export const btnGhostDense =
  `inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-line/40 bg-ink/45 px-2 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground ${DISABLED} ${FOCUS}`

/** 28px square, matching the dense height so a toolbar row lines up. */
export const btnIcon =
  `inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${DISABLED} ${FOCUS}`
