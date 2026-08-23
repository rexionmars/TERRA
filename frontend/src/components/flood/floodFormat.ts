/**
 * How a flood figure reads.
 *
 * Every one of these has a null case, and none of them turns a null into a
 * zero. The payload uses null for a quantity that is undefined: an IoU over
 * two empty extents, a contested share over an AOI no product calls flooded, a
 * `resampled` flag that was not recorded. Printed as 0, or as "no", each would
 * state a measurement that was never made.
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
 * Taken from the payload. A saved-run list and a completion notice have no
 * room for the whole paragraph, and a summary composed here would be a second
 * qualifier able to disagree with the one the sidecar wrote. The full text is
 * on the reading, beside the figures.
 */
export function qualifierHead(text: string | null | undefined): string {
  const s = (text ?? "").trim()
  if (!s) return ""
  const stop = s.indexOf(". ")
  return stop > 0 ? s.slice(0, stop + 1) : s
}
