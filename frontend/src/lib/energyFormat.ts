/**
 * One precision per energy quantity.
 *
 * The headline strip and the full reading now sit in one panel and are on
 * screen together, and seven quantities were printed by both at two different
 * roundings: suitable capacity at 1 and 2 decimals, plant area at 0 and 3, hub
 * speed at 2 and 4, the gross capacity factor at 1 and 3. A reader could see
 * one measurement twice, disagreeing with itself, without either number being
 * wrong.
 *
 * Each precision below is chosen from what the quantity is measured on, not
 * from what the wider of the two sites happened to print.
 */

/** Installed direct-current capacity. Two decimals: the section states it per
 *  suitability class, and the classes differ below a tenth of a megawatt. */
export const capacityMw = (v: number) => `${v.toFixed(2)} MW`

/** Annual energy at an exceedance level. Two decimals, to match the capacity
 *  it is divided by, so a reader can check the yield by hand. */
export const energyGwh = (v: number) => `${v.toFixed(2)} GWh/yr`

/** Area on the ground. One decimal, as hectares print everywhere else in the
 *  siting sections; three decimals is ten square metres on an area derived
 *  from a raster whose pixel is a hundred. */
export const areaHa = (v: number) => `${v.toFixed(1)} ha`

/** Wind speed at hub height. Two decimals. The shear table keeps four on its
 *  own field, where consecutive rows genuinely differ below a centimetre per
 *  second; this one is a single reported value. */
export const speedMs = (v: number) => `${v.toFixed(2)} m/s`

/** Gross capacity factor. One decimal: the figure travels with `gross` and
 *  `unvalidated` chips, and a third decimal asserts a precision the wake and
 *  availability losses it excludes are far larger than. */
export const capacityFactorPct = (v: number) => `${v.toFixed(1)}%`

/** Gross annual energy per turbine. Whole megawatt-hours, for the same
 *  reason. */
export const energyMwh = (v: number) => `${v.toFixed(0)} MWh`

/** Length of the reanalysis record. Two decimals, printed beside
 *  `record_window`, which carries the exact dates. */
export const recordYears = (v: number) => `${v.toFixed(2)} years`
