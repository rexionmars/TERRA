/**
 * The two overlay ramps the sidecar computes rather than tabulates.
 *
 * lib/palettes.ts covers the ramps declared as STOPS, generated from
 * sidecar/composite.py so a swatch and its pixel are the same byte. These two
 * are not stops: confidence and NDVI mean are painted by a closed-form
 * expression per channel, so there is nothing to tabulate and nothing was.
 *
 * That is why the board refused to draw them at first, and the refusal was
 * half right. Transcribing a ramp by eye is what made the NDVI legend disagree
 * with its raster by up to 40 of 255. But applying the SAME ARITHMETIC is not
 * transcription: these functions are the sidecar's three lines, in the same
 * order, with the same clamps and the same truncation, so they agree with the
 * raster by construction rather than by care.
 *
 * WHAT IS STILL MISSING, and it is the guard the stop tables have: nothing
 * fails if sidecar/infer.py changes one of these coefficients. palettes.ts has
 * sidecar/tests/test_palette_sync.py; these have a comment. Extending the
 * generator to sample these two into stops would close it.
 *
 * Mirrors sidecar/infer.py write_confidence_png and write_ndvi_mean_png.
 */

/** numpy's `(x * 255).astype(np.uint8)` on a clamped float: truncation. */
const byte = (x: number) => Math.floor(Math.min(Math.max(x, 0), 1) * 255)

const clip01 = (x: number) => Math.min(Math.max(x, 0), 1)

/**
 * Confidence, blue to cyan to yellow.
 *
 * Note the green channel saturates at conf = 1/1.2 = 0.833: above that the
 * colour stops changing in g, which is why a value cannot be read back out of
 * this ramp and why the board answers no question about confidence thresholds.
 */
export function confidenceRGB(conf: number): [number, number, number] {
  const c = clip01(conf)
  return [
    byte(clip01((c - 0.5) * 2.0)),
    byte(clip01(c * 1.2)),
    byte(clip01(1.0 - c * 0.5)),
  ]
}

/** Temporal-mean NDVI, pale yellow to dark green. */
export function ndviMeanRGB(v: number): [number, number, number] {
  const t = clip01(v)
  return [
    byte(clip01(1.0 - t * 0.85)),
    byte(clip01(0.8 + t * 0.15)),
    byte(clip01(0.45 * (1.0 - t))),
  ]
}

/**
 * A CSS gradient by evaluating the formula, not by naming colours.
 *
 * Enough samples that a linear interpolation between them is indistinguishable
 * from the curve: these are piecewise linear per channel with at most one knee
 * each, so nine is generous and cheap.
 */
export function formulaGradient(
  rgbAt: (t: number) => [number, number, number],
  samples = 9
): string {
  const n = samples - 1
  const stops = Array.from({ length: samples }, (_, i) => {
    const t = i / n
    const [r, g, b] = rgbAt(t)
    return `rgb(${r} ${g} ${b}) ${((i / n) * 100).toFixed(2)}%`
  })
  return `linear-gradient(to right, ${stops.join(", ")})`
}
