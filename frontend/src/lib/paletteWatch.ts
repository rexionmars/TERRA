/**
 * Where the 3D surfaces get their chassis colours, and when they re-read them.
 *
 * Everything painted in CSS re-resolves `var(--p-accent)` on its own when the
 * palette moves -- that is what a custom property is for. A WebGL scene cannot:
 * it reads the tokens once, at build, into colours it then holds as its own
 * numbers, and no part of the cascade reaches those numbers afterwards. So the
 * studio kept whatever palette it opened in until something unrelated rebuilt
 * the scene. That is what `onPaletteChange` is for.
 *
 * The override is the second half. The scenes and the stylesheet read the SAME
 * `--p-*` tokens, which is correct for the product -- one palette, one place --
 * and is exactly what makes them impossible to judge apart: moving a token to
 * see it in the viewport moves every panel around the viewport at the same
 * time. An override pins the scenes to a palette of their own, so the two can
 * be held against each other.
 *
 * Nothing sets it in normal use, and while nothing does this module costs one
 * null check per repaint.
 */

/** The three chassis colours a scene is painted in, as three parses. */
export interface ViewportPalette {
  /** --p-ink: the background and the fog. */
  background: string
  /** --p-line: the ground grid, and an empty area's footprint. */
  line: string
  /** --p-accent: selection, links, and the path through an ordering. */
  accent: string
  /**
   * The ground grid's alpha, where the scene's own default is not wanted.
   *
   * A colour alone cannot say how much of the grid shows. The material draws at
   * 0.14, so the grid contributes at most a seventh of the pixel and any change
   * to its colour arrives divided by seven -- over a lifted background the
   * whole range of a colour control moved the composited channel by eleven of
   * 255, which reads as a control that does nothing. The alpha is the lever
   * that governs it, so the alpha is what is exposed.
   *
   * Absolute, not a multiplier: the scenes each carry their own default and a
   * multiplier would mean two different results from one number.
   */
  gridOpacity?: number
}

let override: ViewportPalette | null = null
const listeners = new Set<() => void>()

/**
 * Pins every open 3D scene to `next`, or releases them back to the tokens.
 *
 * Applies immediately: the subscribers are the scenes' own repaints, so this
 * behaves like a token change without one having happened.
 */
export function setViewportPaletteOverride(next: ViewportPalette | null): void {
  override = next
  for (const fn of listeners) fn()
}

/** What a scene should paint itself in, or null to read the tokens. */
export function viewportPaletteOverride(): ViewportPalette | null {
  return override
}

/**
 * Runs `onChange` whenever the palette actually being painted changes.
 *
 * TWO ATTRIBUTES, because the palette moves in two ways. `data-theme` is the
 * one next-themes writes, and it carries the RESOLVED theme -- "dark" or
 * "light", never "system" -- so it covers a reader left on the system setting
 * whose machine flips at dusk. `style` is the one AccentLab writes: it sets the
 * `--p-*` channels inline on the same element, where an inline custom property
 * outranks the stylesheet's without touching it.
 *
 * Mutations are delivered in batches, so the eleven properties AccentLab writes
 * per change arrive as one callback rather than eleven.
 *
 * Returns the unsubscribe, for the caller's own teardown.
 */
export function onPaletteChange(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme", "style"],
  })
  listeners.add(onChange)
  return () => {
    observer.disconnect()
    listeners.delete(onChange)
  }
}
