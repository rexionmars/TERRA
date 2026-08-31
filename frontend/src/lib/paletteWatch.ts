/**
 * Where the 3D surfaces get their chassis colours, and when they re-read them.
 *
 * Everything painted in CSS re-resolves `var(--p-accent)` on its own when the
 * palette moves -- that is what a custom property is for. A WebGL scene cannot:
 * it reads the tokens once, at build, into colours it then holds as its own
 * numbers, and no part of the cascade reaches those numbers afterwards. So the
 * studio kept whatever palette it opened in until something unrelated rebuilt
 * the scene. That is what this module is for.
 *
 * It also held an override, which pinned the scenes to a palette of their own so
 * the studio could be judged against the panels around it -- the two read the
 * same `--p-*` tokens by design, which is correct for the product and is exactly
 * what makes them impossible to compare. Only the accent lab ever set it, and
 * the lab is gone, so the override went with it rather than staying as a lever
 * with no hand on it.
 */

/**
 * Runs `onChange` whenever the palette actually being painted changes.
 *
 * `data-theme` is the attribute next-themes writes, and it carries the RESOLVED
 * theme -- "dark" or "light", never "system" -- so it covers a reader left on
 * the system setting whose machine flips at dusk.
 *
 * It was watched alongside `style`, which is where the accent lab wrote the
 * `--p-*` channels inline. Nothing writes those inline now, so watching the
 * attribute would only wake every scene whenever anything else touched an
 * inline style on the root element.
 *
 * Returns the unsubscribe, for the caller's own teardown.
 */
export function onPaletteChange(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  })
  return () => observer.disconnect()
}
