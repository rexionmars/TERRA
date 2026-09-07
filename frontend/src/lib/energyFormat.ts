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

/*
  THE WIND PANEL'S OWN QUANTITIES, added when its body was brought here.

  The module's opening states the defect it was made for -- one measurement
  printed twice at two roundings -- and names hub speed and the gross capacity
  factor as two of the seven. The headline was converted then and the panel's
  body was not, so the same panel went on printing the 50 m speed at four
  decimals beside a hub speed at two, and the operating regime's three
  reference speeds at 1, 4 and 1 inside a single string.

  The precisions below are chosen from what each quantity resolves to on a
  screening run over a reanalysis record, not from what the widest of its
  printings happened to use.
*/

/** Wind power density. Whole watts per square metre: it runs in the hundreds,
 *  and a hundredth of a watt is four orders below anything the record settles. */
export const powerDensityWm2 = (v: number) => `${v.toFixed(0)} W/m2`

/** Weibull shape. Two decimals: k moves between about 1.5 and 3 across a
 *  continent, and the second decimal is where two sites start to differ. */
export const weibullK = (v: number) => v.toFixed(2)

/** Air density. Three decimals, because the whole range this reports is
 *  1.05 to 1.25 and the differences that matter live in the third. */
export const airDensityKgM3 = (v: number) => `${v.toFixed(3)} kg/m3`

/** A share of the record's hours. One decimal, for the reason the capacity
 *  factor gives: it is a screening figure and a thousandth of a per cent is a
 *  precision the record does not have. */
export const sharePct = (v: number) => `${v.toFixed(1)}%`

/** How far a fitted distribution sits from the record it was fitted to. Two
 *  decimals rather than one, since this one is commonly under a per cent and
 *  is read as a check rather than as a measurement. */
export const fitErrorPct = (v: number) => `${v.toFixed(2)}%`

/** The power-law shear exponent. Three decimals: 0.143 is the classical open
 *  -country value and the third decimal is where a site departs from it. The
 *  sensitivity sweep keeps four on its own column, where consecutive rows are
 *  chosen to differ there. */
export const shearExponent = (v: number) => v.toFixed(3)

/** Energy pattern factor. Two decimals: it sits near 1.9 for a Rayleigh wind
 *  and a hundredth is the useful step away from it. */
export const patternFactor = (v: number) => v.toFixed(2)

/** Mean of the cube of the speed. One decimal, on a figure in the hundreds
 *  that exists to be compared with the fitted one beside it. */
export const meanCubeM3S3 = (v: number) => `${v.toFixed(1)} m3/s3`
