/**
 * How a flood figure reads.
 *
 * Every one of these has a null case, and none of them turns a null into a
 * zero. The payload uses null for "undefined here", and the distinction is
 * load-bearing in three places: an IoU over two empty extents is undefined
 * rather than total disagreement, a contested share over an AOI nobody calls
 * flooded is undefined rather than perfect agreement, and a `resampled` flag
 * that was not recorded is unknown rather than false. Printing 0 or "no" for
 * any of them states a measurement that was never made.
 */

/** Nulls read as an em dash, never as a number. */
const MISSING = "—"

export const iou = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : MISSING

/** Area of one extent over another. Three decimals, as the index above. */
export const ratio = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : MISSING

export const km2 = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v)
    ? `${v < 10 ? v.toFixed(3) : v.toFixed(1)} km2`
    : MISSING

export const pct = (frac: number | null | undefined): string =>
  typeof frac === "number" && Number.isFinite(frac)
    ? `${(frac * 100).toFixed(1)}%`
    : MISSING

export const metres = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} m` : MISSING

export const cells = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : MISSING

/**
 * The first sentence of the payload's qualifier, for a surface with one line
 * to give it.
 *
 * Taken from the payload rather than written here: a saved-run list and a
 * completion notice cannot carry the whole paragraph, and a summary composed
 * by hand would be a second qualifier that can disagree with the one the
 * sidecar wrote. The full text is on the reading, which is where the figures
 * are.
 */
export function qualifierHead(text: string | null | undefined): string {
  const s = (text ?? "").trim()
  if (!s) return ""
  const stop = s.indexOf(". ")
  return stop > 0 ? s.slice(0, stop + 1) : s
}
