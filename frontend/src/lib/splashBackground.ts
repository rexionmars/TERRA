/**
 * The splash stills, and which one this launch shows.
 *
 * THE ONE SOURCE. These paths used to exist twice -- here, and hard-coded in a
 * script tag in index.html that paints the background before any JavaScript
 * bundle loads -- with "keep in sync" comments on both, which is the admission
 * that nothing kept them in sync. Changing an image meant three coordinated
 * edits, and missing one made the HTML paint one photo and React swap to
 * another the moment it mounted.
 *
 * The HTML now receives this list at build time (see the splashImages plugin in
 * vite.config.ts), so there is one place to edit and no way for the two to
 * disagree.
 *
 * WebP, sized for the window rather than for print: these were 4-megapixel
 * JPEGs totalling 4.2 MB, embedded in the binary, for a screen that shows one
 * of them for about a second.
 */
export const SPLASH_IMAGES = [
  "/terra-splash-images/pexels-aleksandar069-15509901.webp",
  "/terra-splash-images/pexels-andrey-kwin-145997290-10436186.webp",
  "/terra-splash-images/pexels-zelch-30596252.webp",
] as const

export const SPLASH_NEXT_KEY = "terra.splash.next"
export const SPLASH_CURRENT_KEY = "terra.splash.current"

/**
 * Pick the splash image for this app launch and advance the counter for the
 * next open.
 *
 * Safe to call once per boot: the HTML claims the index first and writes it to
 * sessionStorage, and React reads that back rather than advancing again --
 * otherwise the still would change under the user between the two splashes.
 */
export function claimSplashSlideForLaunch(
  count: number = SPLASH_IMAGES.length
): number {
  if (count <= 0) return 0
  try {
    const existing = sessionStorage.getItem(SPLASH_CURRENT_KEY)
    if (existing != null) {
      const parsed = Number.parseInt(existing, 10)
      if (Number.isFinite(parsed)) {
        return ((parsed % count) + count) % count
      }
    }
  } catch {
    /* sessionStorage unavailable */
  }

  let next = 0
  try {
    const raw = localStorage.getItem(SPLASH_NEXT_KEY)
    const parsed = Number.parseInt(raw ?? "0", 10)
    if (Number.isFinite(parsed)) next = parsed
  } catch {
    /* localStorage unavailable */
  }

  const index = ((next % count) + count) % count
  try {
    localStorage.setItem(SPLASH_NEXT_KEY, String((index + 1) % count))
    sessionStorage.setItem(SPLASH_CURRENT_KEY, String(index))
  } catch {
    /* ignore quota / private mode */
  }
  return index
}
