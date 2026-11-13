/**
 * What a Sentinel-2 spectrum is, as reflectance spectroscopy reads it.
 *
 * The readings drew a class's spectrum as seven dots joined by straight lines
 * on a wavelength axis. Three things a spectroscopist reads into such a figure
 * were missing, and one was wrong:
 *
 *   - A BAND IS A WIDTH, NOT A WAVELENGTH. B08 integrates 106 nm and B8A 21 nm
 *     over almost the same place; the dot at each centre hides that one is five
 *     times the other.
 *   - THE AXIS HAS REGIONS that say what governs reflectance there: pigments
 *     absorb in the visible, the red edge is the rise out of chlorophyll
 *     absorption, leaf structure scatters on the NIR plateau, and water absorbs
 *     in the short-wave infrared.
 *   - THE ATMOSPHERE IS OPAQUE IN TWO STRETCHES of the SWIR, where water vapour
 *     absorbs, and no surface reflectance is measured there by any sensor.
 *   - AND THE LINE FROM B8A TO B11 CROSSED 750 nm WITH NO MEASUREMENT, one of
 *     those stretches included, drawing a spectrum where there is none.
 *
 * This module holds the band table and the arithmetic; the figures draw from it.
 */

/**
 * The Sentinel-2A MSI bands: centre wavelength and bandwidth in nm, and native
 * resolution in m, from ESA's spectral response functions (S2-SRF, v3.0). The
 * centres are the ones the sidecar reports (terra/landcover/spectra.py).
 */
export const S2_BANDS: Record<string, { centre: number; width: number; res: number }> =
  {
    B01: { centre: 442.7, width: 21, res: 60 },
    B02: { centre: 492.4, width: 66, res: 10 },
    B03: { centre: 559.8, width: 36, res: 10 },
    B04: { centre: 664.6, width: 31, res: 10 },
    B05: { centre: 704.1, width: 15, res: 20 },
    B06: { centre: 740.5, width: 15, res: 20 },
    B07: { centre: 782.8, width: 20, res: 20 },
    B08: { centre: 832.8, width: 106, res: 10 },
    B8A: { centre: 864.7, width: 21, res: 20 },
    B09: { centre: 945.1, width: 20, res: 60 },
    B11: { centre: 1613.7, width: 91, res: 20 },
    B12: { centre: 2202.4, width: 175, res: 20 },
  }

/** What governs reflectance in each stretch of the axis, for vegetated ground. */
export const SPECTRAL_REGIONS: {
  from: number
  to: number
  label: string
  short: string
}[] = [
  { from: 400, to: 700, label: "Visible: pigment absorption", short: "Visible" },
  { from: 700, to: 750, label: "Red edge", short: "Edge" },
  { from: 750, to: 1300, label: "NIR plateau: leaf structure", short: "NIR" },
  { from: 1300, to: 2300, label: "SWIR: water and dry matter", short: "SWIR" },
]

/** Where water vapour makes the atmosphere opaque: nothing is measured there. */
export const ATMOSPHERIC_ABSORPTION: { from: number; to: number }[] = [
  { from: 1350, to: 1450 },
  { from: 1800, to: 1950 },
]

/**
 * Two neighbouring bands further apart than this are not joined by a line.
 * The widest gap Sentinel-2 leaves inside one region is about 120 nm; the one
 * from B8A to B11 is 749 nm and crosses an absorption stretch.
 */
export const UNMEASURED_GAP_NM = 300

/** Runs of consecutive samples that may be joined, split at unmeasured gaps. */
export function measuredRuns<T extends { wavelength_nm: number }>(
  points: readonly T[]
): T[][] {
  const sorted = [...points].sort((a, b) => a.wavelength_nm - b.wavelength_nm)
  const runs: T[][] = []
  for (const p of sorted) {
    const run = runs.at(-1)
    const last = run?.at(-1)
    if (run && last && p.wavelength_nm - last.wavelength_nm <= UNMEASURED_GAP_NM) {
      run.push(p)
    } else {
      runs.push([p])
    }
  }
  return runs
}

const nd = (a: number, b: number) => (a + b > 0 ? (a - b) / (a + b) : null)

/** The features a vegetation spectroscopist reads off a class's mean spectrum. */
export interface SpectralFeatures {
  /** (B08 − B04) / (B08 + B04): how much more the canopy scatters NIR than it absorbs red. */
  ndvi: number | null
  /**
   * Depth of the red chlorophyll absorption after continuum removal: one minus
   * B04 over the straight line from the green peak (B03) to the NIR shoulder
   * (B08), evaluated at 665 nm. Zero is no absorption; bare soil sits near it.
   */
  redDepth: number | null
  /** (B8A − B11) / (B8A + B11): canopy water, as SWIR absorption against NIR. */
  ndmi: number | null
}

export function spectralFeatures(
  byBand: Record<string, number | undefined>
): SpectralFeatures {
  const r = (b: string) => {
    const v = byBand[b]
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null
  }
  const b03 = r("B03")
  const b04 = r("B04")
  const b08 = r("B08")
  const b8a = r("B8A")
  const b11 = r("B11")
  let redDepth: number | null = null
  if (b03 !== null && b04 !== null && b08 !== null) {
    const { centre: l3 } = S2_BANDS.B03
    const { centre: l4 } = S2_BANDS.B04
    const { centre: l8 } = S2_BANDS.B08
    const continuum = b03 + ((b08 - b03) * (l4 - l3)) / (l8 - l3)
    redDepth = continuum > 0 ? 1 - b04 / continuum : null
  }
  return {
    ndvi: b08 !== null && b04 !== null ? nd(b08, b04) : null,
    redDepth,
    ndmi: b8a !== null && b11 !== null ? nd(b8a, b11) : null,
  }
}

/** A measurement no surface could have produced, and why. */
export interface SpectralCheck {
  bands: string[]
  text: string
}

/** Below this a mean reflectance is not explained by the baseline offset over dark ground. */
const NEGATIVE_FLOOR = -0.01

/**
 * The checks a spectrum must pass to be read as a surface's reflectance.
 *
 * NO NEGATIVE MEAN. The baseline 04.00 offset takes single dark pixels slightly
 * below zero, which is why the axis is not clamped; a class's mean below about
 * −0.01 is not a surface and points at the measurement.
 *
 * B08 AND B8A AGREE where the surface is bright in the NIR. Both sample the
 * NIR plateau, 32 nm apart, and over vegetation they read within a few per
 * cent; one a fraction of the other is not a property of the ground.
 */
export function spectralChecks(
  byBand: Record<string, number | undefined>
): SpectralCheck[] {
  const out: SpectralCheck[] = []
  const negative = Object.entries(byBand)
    .filter(([, v]) => typeof v === "number" && v < NEGATIVE_FLOOR)
    .map(([b]) => b)
    .sort((a, b) => (S2_BANDS[a]?.centre ?? 0) - (S2_BANDS[b]?.centre ?? 0))
  if (negative.length) {
    out.push({
      bands: negative,
      text: `Mean reflectance below zero at ${listBands(negative)}, which no surface reflects.`,
    })
  }
  const b08 = byBand.B08
  const b8a = byBand.B8A
  if (typeof b08 === "number" && typeof b8a === "number") {
    const hi = Math.max(b08, b8a)
    const lo = Math.min(b08, b8a)
    if (hi > 0.15 && (hi - lo) / hi > 0.35) {
      out.push({
        bands: ["B08", "B8A"],
        text: `B08 reads ${b08.toFixed(3)} and B8A ${b8a.toFixed(3)}. Both sample the NIR plateau, 32 nm apart, and agree within a few per cent over any vegetated surface.`,
      })
    }
  }
  return out
}

function listBands(bands: string[]): string {
  return bands.length <= 1
    ? (bands[0] ?? "")
    : `${bands.slice(0, -1).join(", ")} and ${bands.at(-1)}`
}

/**
 * The Bhattacharyya bound on the error of telling two classes apart, from
 * their Jeffries-Matusita distance, for two equally likely classes.
 *
 * JM = 2(1 − e^−B), so e^−B = 1 − JM/2, and the Bayes error of a two-class
 * problem with equal priors is at most ½·e^−B. A JM of 2 bounds the error at
 * zero, a JM of 0 at a half: a coin toss. An upper bound under the normal
 * assumption the distance is computed under, not an estimate.
 */
export function jmErrorBound(jm: number): number {
  return 0.5 * Math.max(0, 1 - jm / 2)
}
