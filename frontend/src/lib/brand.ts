/**
 * How the application names itself before it knows what you are doing.
 *
 * WHY THIS IS NOT "land cover · sentinel-2" ANY MORE. That line was accurate
 * when classification was the whole product. It is now one of ten actions the
 * sidecar answers: land cover, surface water, scene composition, solar
 * resource, solar terrain, solar siting, the photovoltaic energy model, and
 * wind screening. Four of those touch no Sentinel-2 scene at all -- they read
 * hourly reanalysis, which is why NASA POWER appears in the sidecar roughly
 * three times as often as Sentinel-2 does.
 *
 * So the old line described the application's past and hid its present: someone
 * opening TERRA to assess a photovoltaic site saw a subtitle that named neither
 * energy nor anything adjacent to it.
 *
 * WHY IT NO LONGER NAMES ENERGY EITHER. It read "earth observation · energy"
 * for a while, which named the two halves rather than listing the products --
 * and naming halves is the same habit as listing products, one level up. Two
 * nouns joined by a separator is a claim that the application is two things,
 * and it is one: everything here observes the earth, including the solar and
 * wind products, which read hourly reanalysis of it.
 *
 * A subtitle that enumerates goes stale, and this one had already grown once.
 * The shorter line cannot: it says what the application does rather than which
 * departments it has.
 *
 * Defined here because it appears in two places that cannot import from each
 * other: the React splash, and the static markup in index.html that paints
 * before any bundle loads. The HTML copy is substituted at build time from this
 * value -- the same treatment the splash image list needed, for the same reason.
 */
export const BRAND_TAGLINE = "earth observation"

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
 * when it does not -- they disagreed once, silently, and the splash would have
 * printed one release's name over another release's photograph. What the name
 * does NOT follow is the rotation: whichever still a given launch lands on,
 * the release keeps this name.
 *
 * IT BELONGS TO THE MINOR LINE. A MINOR takes the next name from the set; a
 * PATCH keeps the one it has, the way 14.0 through 14.7 are all Sonoma. So
 * this is edited less often than AppVersion in version.go, not with it --
 * see docs/RELEASING.md.
 */
export const RELEASE_NAME = "Cumulus"
