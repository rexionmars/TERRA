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
 * It names the two halves rather than listing the products, because the list is
 * the part that keeps changing -- it has grown four times already, and a
 * subtitle that enumerates is a subtitle that goes stale. The title bar carries
 * a signature rather than a description of the screen; this is the one line
 * shown before any screen exists.
 *
 * Defined here because it appears in two places that cannot import from each
 * other: the React splash, and the static markup in index.html that paints
 * before any bundle loads. The HTML copy is substituted at build time from this
 * value -- the same treatment the splash image list needed, for the same reason.
 */
export const BRAND_TAGLINE = "earth observation · energy"

/**
 * The name of this release.
 *
 * Fixed for the version, the way Sierra and Sonoma are: it identifies the
 * release, not whatever is on screen at the moment. It briefly followed the
 * splash still, which made it change from launch to launch as the rotation
 * advanced -- a name that moves is not a name, it is a caption.
 *
 * The stills carry names from the same set, and the one this release is named
 * for is featured on the first launch after an update (FEATURED_STILL in
 * splashBackground.ts). That is a deliberate correspondence, not a dependency:
 * the release keeps this name whichever photograph the rotation happens to
 * land on.
 *
 * Bump it with AppVersion in version.go -- see docs/RELEASING.md.
 */
export const RELEASE_NAME = "Ember"
