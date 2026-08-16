/**
 * Request defaults for the wind screening.
 *
 * Kept apart from the energy defaults, as the product is: a different source on
 * a different grid, with its own run kind. Wind constants living in a file named
 * for the solar panel was the file-level form of the coupling being undone.
 */
export const WIND_DEFAULTS = {
  /** Mirrors the hourly window the solar resource uses. */
  recordYears: 10,
  /** The reference turbine hub. No turbine has been selected for any site. */
  hubHeightM: 110,
  calmThresholdMS: 0.5,
  /** No published basis: a check on a near-surface field whose extremes are absent. */
  recordMaxFloorMS: 10,
  /** Open agricultural land, assumed rather than measured. */
  roughnessLowM: 0.03,
  roughnessHighM: 0.1,
}
