/**
 * How the application names itself before it knows what you are doing.
 *
 * WHY THIS IS NOT "land cover · sentinel-2" ANY MORE. That line was accurate
 * when classification was the whole product. It is now one of several the
 * sidecar answers -- surface water and scene composition among them -- and not
 * all of them read Sentinel-2: the MapBiomas land-use reading takes a published
 * map instead. The old line described the application's past and hid its
 * present.
 *
 * WHY IT NO LONGER NAMES ENERGY EITHER. It read "earth observation · energy"
 * for a while, which named the two halves rather than listing the products --
 * and naming halves is the same habit as listing products, one level up. Two
 * nouns joined by a separator is a claim that the application is two things,
 * and it is one: everything here observes the earth.
 *
 * A subtitle that enumerates goes stale, and this one had already grown once.
 * The shorter line cannot: it says what the application does rather than which
 * departments it has.
 *
 * Defined here because it appears in two places that cannot import from each
 * other: the React splash, and the static markup in index.html that paints
 * before any bundle loads. The HTML copy is substituted at build time from this
 * value.
 */
export const BRAND_TAGLINE = "earth observation"

/**
 * The name of the application's own menu, under the mark in the header.
 *
 * The name and not a word for what the menu holds: what is there -- project
 * files, settings, the environment, About -- belongs to the application, and
 * its name says so. The header shows it, and the operator search and the
 * keymap print it as the way to these commands, so it is defined once.
 */
export const APP_MENU = "TERRA EO"

/**
 * The name of this release.
 *
 * Fixed for the version, the way Sierra and Sonoma are: it identifies the
 * release, not whatever is on screen at the moment. It briefly followed the
 * splash still, which made it change from launch to launch as the rotation
 * advanced -- a name that moves is not a name, it is a caption.
 *
 * IT DOES NOT DESCRIBE WHAT SHIPPED. The name is drawn from a set -- what is
 * observable from orbit -- the way Sonoma is drawn from places in California,
 * and Mojave brought no desert features. docs/RELEASING.md carries the
 * argument: a name that has to describe a theme cannot be given to a release
 * of thirty refactors, so it either lies or holds the release until a theme
 * arrives. The changelog describes the release.
 *
 * It equals FEATURED_STILL in splashBackground.ts, and check-version.ts fails
 * when it does not: the release is named for the still the start screen shows,
 * and the two disagreed once, silently.
 *
 * IT BELONGS TO THE MINOR LINE. A MINOR takes the next name from the set; a
 * PATCH keeps the one it has, the way 14.0 through 14.7 are all Sonoma. So
 * this is edited less often than AppVersion in version.go, not with it --
 * see docs/RELEASING.md.
 */
export const RELEASE_NAME = "Sunset"

/** Where the source, the issues and the documents are. */
export const REPO_URL = "https://github.com/rexionmars/TERRA"

/**
 * The photograph the splash and the start screen are set on: the ground the
 * application observes, seen from where people stand on it.
 *
 * Imadedana's "Petani padi", two farmers planting rice at dawn in a flooded
 * terrace at Tembuku, Bangli, Bali, on 10 July 2021, with Mount Agung behind:
 * a featured picture on Wikimedia Commons, under CC BY-SA 4.0. The licence
 * asks for the author's name, the licence and a way to the source, which the
 * credit gives, and for the cropped and resized files to be shared under the
 * same licence, which they are. It replaced a photograph of children in a
 * displacement camp: a picture of people in a crisis, used as the face of a
 * product, says something about them they did not choose to say. So the
 * picture carries no claim and no caption that speaks for the people in it.
 *
 * The files are resized from the 4928x3264 original with Lanczos and passed
 * through cwebp -q 82, as docs/RELEASING.md encodes the stills, by
 * .temp/splash_photo/build_splash.py: terra-splash-rice-planting.webp at
 * 2880 px wide, the full window's width at twice its density, so the splash's
 * push-in does not soften it much, and its 840 px copy for the 420x280 boot
 * window; and terra-start-rice-planting.webp, cropped at full width from
 * y 760 to 2830 to the start card's 500:210 and resized to 1600x672, which
 * keeps both farmers and their reflections and leaves the dark trees under
 * the card's darkened top, where the lockup is set.
 */
export const BRAND_PHOTO = {
  author: "Imadedana",
  license: "CC BY-SA 4.0",
  source: "https://commons.wikimedia.org/wiki/File:Petani_padi.jpg",
}
