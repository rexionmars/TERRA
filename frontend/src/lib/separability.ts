/**
 * Class separability from the per-class spectra a run already carries.
 *
 * WHAT THIS MEASURES, AND THE TWO DIFFERENT QUESTIONS IT ANSWERS.
 *
 * `class_spectra` gives a mean and a standard deviation per predicted class per
 * band, on one acquisition (see the docstring on `class_spectra` in
 * sidecar/infer.py -- it is one scene, not a seasonal mean). Two Gaussians
 * summarised that way have a closed-form overlap, so two questions can be asked
 * of the numbers already stored:
 *
 *   Within one run, between two classes -- how far apart is a class from the
 *   others AROUND it, per band. This is contrast against the surround.
 *
 *   Between two runs, for the same class -- how far the class's own signature
 *   moved between one area and the other.
 *
 * They are not the same measurement and they do not move together. A crop whose
 * own reflectance is nearly unchanged between two regions can still become
 * unclassifiable in the second, because what collapsed was its contrast against
 * everything else in the scene rather than its own signature. Reporting only
 * one of the two would make that case unreadable, which is why the panel above
 * this module draws both.
 *
 * WHAT IT DOES NOT MEASURE. Separability is a property of the measured
 * distributions, not of a model's skill, and not of any correction. A low
 * distance says the bands on this acquisition do not distinguish these classes;
 * it does not say a different model would, and it does not point at a repair.
 *
 * Every distance here is UNIVARIATE, so the set of them is a floor rather than
 * a ceiling: a classifier reading the bands jointly can separate classes that
 * no single band separates, and the gap between the two is not small. The
 * reference work on this question measured a best single-variable distance of
 * 0.059 on a scale running to 2, over data on which a random forest reached
 * macro-F1 0.81. See the panel's own note, which says so on screen.
 */
import type { ClassSpectra, ClassSpectrumPoint } from "@/lib/types"

/**
 * Bhattacharyya distance between two univariate Gaussians.
 *
 *   B = (1/8) (m1 - m2)^2 * 2/(v1 + v2) + (1/2) ln( (v1 + v2) / (2 sqrt(v1 v2)) )
 *
 * with v = sd^2. The first term is the separation of the means scaled by the
 * pooled spread; the second is the disagreement in spread alone, which is why
 * two classes with the same mean and different variances are not at zero.
 *
 * The univariate form on purpose. The full multivariate Bhattacharyya distance
 * needs the band-to-band covariance matrix, and the payload carries a marginal
 * per band and no covariance at all. Computing a multivariate figure from
 * marginals would assume the bands are independent -- they are emphatically not,
 * B08 and B8A are 32 nm apart -- and would report a single number that reads as
 * a joint measurement while being an assumption. Per band is what the stored
 * data supports, and per band is also the more useful answer: it names WHICH
 * band carries the separation.
 *
 * Returns null rather than a number when the inputs cannot support one. A
 * non-finite input, a negative sd, or a zero sd on either side is refused: the
 * variance term diverges as sd goes to zero, so a class whose pixels are all
 * bit-identical would be reported as perfectly separable from everything, which
 * is an artefact of quantisation reported as a finding.
 *
 * Refused rather than regularised, which is where this departs from the
 * reference implementations. Those add 1e-9 to each variance, and on their
 * inputs -- a continuous index over 1500 pixels -- the degenerate case does not
 * arise, so the term only guards the logarithm. Here `sd` arrives rounded to
 * six decimals over as few as thirty pixels, so it CAN be exactly zero, and
 * 1e-9 would turn that into a distance near 2: the most separable pair in the
 * panel would be the one whose data was too coarse to measure.
 */
export function bhattacharyyaGaussian(
  mean1: number,
  sd1: number,
  mean2: number,
  sd2: number
): number | null {
  if (
    !Number.isFinite(mean1) ||
    !Number.isFinite(mean2) ||
    !Number.isFinite(sd1) ||
    !Number.isFinite(sd2)
  ) {
    return null
  }
  if (sd1 <= 0 || sd2 <= 0) return null

  const v1 = sd1 * sd1
  const v2 = sd2 * sd2
  const pooled = v1 + v2
  const dm = mean1 - mean2

  const meanTerm = (dm * dm) / (4 * pooled)
  const spreadTerm = 0.5 * Math.log(pooled / (2 * sd1 * sd2))

  const b = meanTerm + spreadTerm
  return Number.isFinite(b) ? b : null
}

/**
 * Jeffries-Matusita distance, on its usual 0 to 2 scale.
 *
 *   JM = 2 (1 - e^-B)
 *
 * Used rather than the Bhattacharyya distance it derives from because B is
 * unbounded, so two well-separated pairs at B = 8 and B = 14 look far apart
 * while being equally separable in practice. JM saturates: above roughly 1.9 the
 * pair is separable and further distance changes nothing a classifier can use.
 *
 * Conventional reading, and the reason the panel bands the axis rather than
 * leaving a bare number: below about 1.0 the classes overlap substantially,
 * 1.0 to 1.9 is partial separation, and above 1.9 they are effectively
 * separable on that band.
 *
 * Null propagates from `bhattacharyyaGaussian` -- see there for what is refused
 * and why nothing is substituted for it.
 */
export function jeffriesMatusita(
  mean1: number,
  sd1: number,
  mean2: number,
  sd2: number
): number | null {
  const b = bhattacharyyaGaussian(mean1, sd1, mean2, sd2)
  if (b === null) return null
  const jm = 2 * (1 - Math.exp(-b))
  /*
    The range holds by construction and this cannot currently fire.
    `bhattacharyyaGaussian` returns B >= 0 for every input it does not refuse,
    so exp(-B) lies in (0, 1], so jm lies in [0, 2) -- and exp(-B) underflows to
    exactly 0 above B ~ 745, which lands on 2 rather than past it. Nothing here
    rounds over the top: that would need exp(-B) to come back negative.

    Kept as an invariant rather than a repair. It costs two comparisons and it
    is what fails first if the expression above is ever changed to one whose
    range is not obviously bounded, on a value that is otherwise drawn on a
    fixed 0 to 2 axis where an out-of-range point is clipped and not reported.
  */
  return Math.min(2, Math.max(0, jm))
}

/** One band's worth of separation between two named distributions. */
export interface BandSeparation {
  band: string
  wavelength_nm: number
  /** Null when the band could not be measured on one side or the other. */
  jm: number | null
  /** Why it is null, for the panel to say rather than leave a gap. */
  missing?: "absent" | "degenerate"
}

/** Two classes compared, band by band, with the bands that carry it named. */
export interface ClassPairSeparation {
  aId: number
  aName: string
  aColor: string
  bId: number
  bName: string
  bColor: string
  bands: BandSeparation[]
  /**
   * The single most separating band, which is the one a reader acts on.
   *
   * The MAXIMUM over bands rather than a mean. A mean over seven bands is
   * dragged down by the six that happen not to carry the distinction and
   * reports a separable pair as marginal; the question the panel is asked is
   * whether ANY band separates these two, and by which.
   */
  best: BandSeparation | null
  /** Bands that could be measured on both sides. */
  measured: number
}

function indexPoints(
  spectra: ClassSpectra
): Map<number, Map<string, ClassSpectrumPoint>> {
  const byClass = new Map<number, Map<string, ClassSpectrumPoint>>()
  for (const p of spectra.points) {
    let bands = byClass.get(p.class_id)
    if (!bands) {
      bands = new Map()
      byClass.set(p.class_id, bands)
    }
    // First writer wins. The sidecar emits one row per class per band, so a
    // duplicate is malformed input rather than a case to average.
    if (!bands.has(p.band)) bands.set(p.band, p)
  }
  return byClass
}

function compareBands(
  bands: readonly string[],
  a: Map<string, ClassSpectrumPoint>,
  b: Map<string, ClassSpectrumPoint>
): BandSeparation[] {
  return bands.map((band) => {
    const pa = a.get(band)
    const pb = b.get(band)
    if (!pa || !pb) {
      /*
        A band is absent for a class when fewer than SPECTRUM_MIN_PIXELS of it
        fell inside the area -- the sidecar drops the row rather than publish a
        mean over a handful of pixels. Absent is reported as absent: treating it
        as zero separation would read as "these classes are identical here",
        which is the opposite of "this was not measured".
      */
      const wl = pa?.wavelength_nm ?? pb?.wavelength_nm ?? 0
      return { band, wavelength_nm: wl, jm: null, missing: "absent" as const }
    }
    const jm = jeffriesMatusita(pa.mean, pa.sd, pb.mean, pb.sd)
    return jm === null
      ? {
          band,
          wavelength_nm: pa.wavelength_nm,
          jm: null,
          missing: "degenerate" as const,
        }
      : { band, wavelength_nm: pa.wavelength_nm, jm }
  })
}

function summarise(bands: BandSeparation[]): {
  best: BandSeparation | null
  measured: number
} {
  let best: BandSeparation | null = null
  let measured = 0
  for (const b of bands) {
    if (b.jm === null) continue
    measured += 1
    if (!best || b.jm > (best.jm ?? -1)) best = b
  }
  return { best, measured }
}

/**
 * Every class pair within one run, per band.
 *
 * This is the contrast-against-the-surround reading. Pairs are unordered and
 * emitted once each: JM is symmetric, so both orders would be the same number
 * printed twice and would double the rows a reader has to scan.
 *
 * Sorted by the most separating band ascending, so the pairs a classifier is
 * least able to tell apart are at the top. That is the direction of interest --
 * a reader opens this panel to find what is NOT separable.
 */
export function classPairSeparability(
  spectra: ClassSpectra | null | undefined
): ClassPairSeparation[] {
  if (!spectra?.points?.length) return []
  const byClass = indexPoints(spectra)
  const ids = [...byClass.keys()].sort((x, y) => x - y)
  const bands = spectra.bands?.length
    ? spectra.bands
    : [...new Set(spectra.points.map((p) => p.band))]

  const out: ClassPairSeparation[] = []
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const aBands = byClass.get(ids[i])!
      const bBands = byClass.get(ids[j])!
      const first = aBands.values().next().value as ClassSpectrumPoint
      const second = bBands.values().next().value as ClassSpectrumPoint
      const rows = compareBands(bands, aBands, bBands)
      const { best, measured } = summarise(rows)
      out.push({
        aId: ids[i],
        aName: first.name,
        aColor: first.color,
        bId: ids[j],
        bName: second.name,
        bColor: second.color,
        bands: rows,
        best,
        measured,
      })
    }
  }
  out.sort((p, q) => {
    // Unmeasurable pairs last rather than first. A null best is not "least
    // separable", it is "not known", and sorting it to the top of a list whose
    // top means "least separable" would state the one thing it does not say.
    if (p.best === null && q.best === null) return 0
    if (p.best === null) return 1
    if (q.best === null) return -1
    return (p.best.jm ?? 0) - (q.best.jm ?? 0)
  })
  return out
}

/** One class, measured in two runs, band by band. */
export interface ClassDrift {
  classId: number
  name: string
  color: string
  bands: BandSeparation[]
  best: BandSeparation | null
  measured: number
  /** Mean reflectance shift per band, signed, for direction rather than size. */
  shifts: { band: string; delta: number | null }[]
}

/**
 * The same class in two runs, band by band.
 *
 * The signature-drift reading. A LARGE distance here means the class does not
 * look the same in the two areas; a small one means it does. Read beside
 * `classPairSeparability`, because the two answer the question the pair was
 * built for: a class can be nearly unchanged in itself while the scene around
 * it stops being distinguishable from it.
 *
 * The signed mean shift is carried alongside the distance because JM is
 * unsigned: it says a band moved, not which way, and "SWIR fell" and "SWIR rose"
 * are different findings that produce the same distance.
 */
export function classDriftBetweenRuns(
  a: ClassSpectra | null | undefined,
  b: ClassSpectra | null | undefined
): ClassDrift[] {
  if (!a?.points?.length || !b?.points?.length) return []
  const byA = indexPoints(a)
  const byB = indexPoints(b)
  // Only classes both runs actually predicted. A class present in one area and
  // absent from the other has not drifted -- there is nothing to compare it to,
  // and listing it at a distance of anything would invent the comparison.
  const shared = [...byA.keys()].filter((id) => byB.has(id)).sort((x, y) => x - y)
  const bands = [
    ...new Set([...(a.bands ?? []), ...(b.bands ?? [])]),
  ]

  return shared.map((id) => {
    const aBands = byA.get(id)!
    const bBands = byB.get(id)!
    const rows = compareBands(bands, aBands, bBands)
    const { best, measured } = summarise(rows)
    const first = aBands.values().next().value as ClassSpectrumPoint
    return {
      classId: id,
      name: first.name,
      color: first.color,
      bands: rows,
      best,
      measured,
      shifts: bands.map((band) => {
        const pa = aBands.get(band)
        const pb = bBands.get(band)
        return {
          band,
          delta: pa && pb ? pb.mean - pa.mean : null,
        }
      }),
    }
  })
}

/**
 * The conventional reading of a JM value, for banding an axis.
 *
 * Thresholds are the ones in common use for JM on its 0 to 2 scale, and they
 * are a convention rather than a result: they are where the panel draws its
 * bands, not a claim that 1.0 is where a classifier begins to work.
 */
export function separabilityBand(jm: number): "overlapping" | "partial" | "separable" {
  if (jm < 1.0) return "overlapping"
  if (jm < 1.9) return "partial"
  return "separable"
}
