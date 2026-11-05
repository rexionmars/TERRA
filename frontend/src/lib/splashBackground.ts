/**
 * The release stills: what they are, where they came from, and which one shows.
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
 * THE START SCREEN SHOWS IT, NOT THE SPLASH. The splash showed the still and
 * walked the manifest from launch to launch; it now draws the Earth under its
 * orbits (splash.css), and the still is what the start screen's card shows for
 * the release. With nothing left to walk, the rotation went with it. The
 * stills that have been removed, with their sources and photographers, are in
 * the history of this file; their files are still in public/terra-splash-images.
 *
 * WebP sized for a window rather than for print: the originals are
 * 24-megapixel photographs, and the start screen's card is 500 px wide.
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
    /*
      A sunset, which is what this frame is: the lit sky thinning to orange
      over a horizon already in shadow, with the crescent above. From orbit it
      is the band along the line between day and night. The name keeps the
      register of the set -- Meander, Terraces, Vortex, Windfarm, Soybean,
      Cumulus each name the thing observed rather than where -- and Pexels
      records no location to read a place off in any case.

      It also bounds the method. An optical scene is acquired on the day side
      of that line, near 10:30 local time for Sentinel-2, and nothing past it
      is measured at all.

      SINCE IS AHEAD OF version.go, by one minor. The code name belongs to the
      minor line -- docs/RELEASING.md -- and 0.6.0 is tagged as Cumulus, so a
      new name is the next minor rather than a patch of this one. version.go
      stays at 0.6.0 until release-please bumps it, and check-version.ts does
      not compare this field for exactly that reason.
    */
    name: "Sunset",
    path: "/terra-splash-images/sunset.webp",
    subject:
      "a clear sky at dusk over a dark, low ridge line: a yellow-orange band " +
      "on the horizon fading through rose to violet and near-black overhead, " +
      "with a thin crescent moon in the upper right",
    /*
      Pexels, which asks for no attribution. The upload id is the route back to
      the original, which is the only reason it is written down.

      RE-ENCODED to what docs/RELEASING.md prescribes and the set already holds:
      the download is 4644x3094 and 2.0 MB, this is WebP at 1600 px and 55 KB.

      BANDING WAS LOOKED AT, and this frame is nothing but gradient. At q82 the
      encoder drops the film grain of the original, which removes the dither a
      smooth sky relies on; the decoded file was read by eye over the dark
      violet and the orange band, and measured for block edges -- the mean
      horizontal step on the 8 px grid is 1.002 times the step inside the
      blocks, so the encoder's grid does not show.
    */
    source: "https://www.pexels.com — upload 8533828",
    photographer: "bertellifotografia",
    since: "0.7.0",
  },
]

/**
 * The still this release is named for, and the one the start screen shows.
 * RELEASE_NAME in brand.ts names the same entry; check-version.ts fails when
 * the two differ.
 */
export const FEATURED_STILL = "Sunset"
