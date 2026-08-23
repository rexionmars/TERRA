/**
 * The splash stills: what they are, where they came from, and which one shows.
 *
 * A MANIFEST, NOT A LIST OF PATHS. This was three URLs whose filenames were
 * their upload IDs -- pexels-andrey-kwin-145997290-10436186 says nothing about
 * a photograph of terraced farmland, so nobody could tell which file to replace
 * without opening all of them. It also recorded no source, so a year from now
 * there would be no way back to the original to re-encode it at a different
 * size.
 *
 * Each still carries a code name, and each release features one. That is the
 * point of the code name: a version focused on solar and wind ships an image of
 * turbines at dusk, and the name is how the release is referred to afterwards.
 *
 * ONE STILL, BY DECISION, NOT BY ACCIDENT. The manifest held six and the splash
 * walked them; it now holds the one the splash shows. The machinery below still
 * describes a rotation because a rotation is what this becomes again the moment
 * a second entry is added -- with one entry every path through it resolves to
 * that entry, and nothing here special-cases the count. The six that were
 * removed, with their sources and photographers, are in the history of this
 * file; their files are still in public/terra-splash-images.
 *
 * THE ONE SOURCE. index.html paints a background before any bundle loads, so it
 * cannot import this -- the paths used to be duplicated into a script tag with
 * "keep in sync" comments on both copies, which is the admission that nothing
 * did. A Vite plugin now substitutes them at build time from here.
 *
 * WebP sized for the window rather than for print: the originals are 24-megapixel
 * photographs, and the window is 420x280.
 */

export type SplashStill = {
  /** The code name. Names the release that introduced it. */
  name: string
  path: string
  /** What the photograph shows, for whoever has to pick one later. */
  subject: string
  /**
   * Where it came from. Not a licence obligation -- these are Pexels images,
   * which require no attribution -- but the only way back to the original if it
   * ever needs re-encoding at a different size.
   */
  source: string
  photographer: string
  /** The application version that introduced it. */
  since: string
}

/**
 * Named for what is observable from orbit, which is what this application is
 * about. The names come from one set, so that a manifest of several reads as
 * deliberate rather than arbitrary; the set is what a second entry rejoins.
 */
export const SPLASH_STILLS: SplashStill[] = [
  {
    name: "Amazon",
    path: "/terra-splash-images/amazon.webp",
    subject: "a river winding through closed rainforest canopy, from altitude",
    /*
      Pexels, which asks for no attribution, and the upload it came from was
      not recorded when the file arrived. The site rather than the photograph,
      which is as far back as this entry can point -- a URL invented to fill
      the field would be worse than an honest one that stops here.
    */
    source: "https://www.pexels.com",
    photographer: "",
    since: "0.4.0",
  },
]

/**
 * The still this release is named for.
 *
 * With one entry in the manifest it is also the only still there is, so the
 * splash is fixed and this names what is on it. With more than one it is what
 * the first launch after an update shows, and what half the launches after it
 * show; the rest walk the others, so featuring a still neither discards them
 * nor makes the code name decorative.
 */
export const FEATURED_STILL = "Amazon"

/** Paths alone, for the places that only need to load them. */
export const SPLASH_IMAGES = SPLASH_STILLS.map((s) => s.path)

export const SPLASH_NEXT_KEY = "terra.splash.next"
export const SPLASH_CURRENT_KEY = "terra.splash.current"
/** The version whose featured still has already been shown. */
export const SPLASH_SEEN_VERSION_KEY = "terra.splash.seenVersion"

/**
 * Pick the still for this launch and advance the counter for the next open.
 *
 * Safe to call once per boot: index.html claims the index first and writes it
 * to sessionStorage, and React reads that back rather than advancing again --
 * otherwise the image would change under the user between the two splashes.
 *
 * `version` opts into the featured-first behaviour. Without it -- which is how
 * the pre-bundle HTML calls it, since it has no version to compare -- this is
 * the plain rotation it always was.
 */
export function claimSplashSlideForLaunch(
  count: number = SPLASH_IMAGES.length,
  version?: string
): number {
  if (count <= 0) return 0

  // Already claimed this launch.
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

  // First launch on a new version: show what the release is named for.
  if (version) {
    try {
      if (localStorage.getItem(SPLASH_SEEN_VERSION_KEY) !== version) {
        const featured = SPLASH_STILLS.findIndex(
          (s) => s.name === FEATURED_STILL
        )
        if (featured >= 0 && featured < count) {
          localStorage.setItem(SPLASH_SEEN_VERSION_KEY, version)
          // The rotation resumes after it rather than repeating it.
          // Next launch is a rotation slot, so the featured still does not
          // appear twice in a row right after an update.
          localStorage.setItem(SPLASH_NEXT_KEY, "0")
          sessionStorage.setItem(SPLASH_CURRENT_KEY, String(featured))
          return featured
        }
      }
    } catch {
      /* storage unavailable: fall through to the plain rotation */
    }
  }

  let next = 0
  try {
    const raw = localStorage.getItem(SPLASH_NEXT_KEY)
    const parsed = Number.parseInt(raw ?? "0", 10)
    if (Number.isFinite(parsed)) next = parsed
  } catch {
    /* localStorage unavailable */
  }

  /*
    The counter counts LAUNCHES, not images.

    It runs over twice the number of stills because every second launch is the
    featured slot, so a full cycle takes two launches per still. The image
    index is derived from it below; conflating the two is what broke the first
    attempt at this.
  */
  const featuredIndex = SPLASH_STILLS.findIndex((s) => s.name === FEATURED_STILL)
  /*
    Alternation needs a featured still and something to alternate with. Below
    three stills, or with FEATURED_STILL naming nothing, the cycle collapses to
    the plain rotation -- otherwise every image would simply show twice in a
    row, which is a repeat rather than a rotation.
  */
  const alternating = featuredIndex >= 0 && featuredIndex < count && count > 2

  const cycle = alternating ? count * 2 : count
  const tick = ((next % cycle) + cycle) % cycle
  const index = alternating ? Math.floor(tick / 2) % count : tick

  /*
    The release's own still, every other launch.

    A flat rotation gave it one launch in five, which is little presence for
    the image the version is named for. Every second launch shows it; the ones
    between walk the rotation, so the whole set still appears.

    The counter advances on EVERY launch, including the featured ones, and the
    parity is read off the counter rather than off a separate flag. An earlier
    version advanced only on the rotation launches, which meant the counter
    visited even indices exclusively -- two of the five stills were never
    reachable and the featured one landed twice in a row whenever the walk
    passed over its own index.

    Alternating rather than weighted-random keeps the sequence derivable from
    the stored counter alone, which is what makes it testable and what stops
    the same image landing twice by chance. The featured index is skipped in
    the walk, since showing it as "one of the others" would waste a slot that
    is already half the launches.
  */
  let shown = index
  if (alternating) {
    if (tick % 2 === 1) {
      shown = featuredIndex
    } else if (index === featuredIndex) {
      // The walk landed on the featured still on a rotation launch. Take the
      // next one instead, so its extra presence comes only from its own slot.
      shown = (featuredIndex + 1) % count
    }
  }

  try {
    localStorage.setItem(SPLASH_NEXT_KEY, String((tick + 1) % cycle))
    sessionStorage.setItem(SPLASH_CURRENT_KEY, String(shown))
  } catch {
    /* ignore quota / private mode */
  }
  return shown
}
