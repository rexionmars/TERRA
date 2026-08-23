/**
 * The agreement raster as a small set of named classes, with the colour the
 * renderer gave each one.
 *
 * THE LEGEND IS DISCRETE BECAUSE THE QUANTITY IS. "Three of four products"
 * is not a position on a ramp: there is no cell between three and four, and a
 * gradient bar with two end labels invites the reader to interpolate one. The
 * raster is drawn from a continuous ramp only because that is what makes the
 * ordering legible; what it encodes is N+1 classes, and this module turns the
 * payload's `counts` array into exactly those classes.
 *
 * THE SWATCH IS THE PIXEL. sidecar/infer.py agreement_rgba colours a cell by
 * t = count / n_products through composite._BLUES, and leaves count 0
 * transparent. The same t through the same stops is computed here, so a swatch
 * in the legend is the colour of the cells it names rather than an
 * approximation of them. lib/palettes.ts is generated from those stops for
 * this reason; a hand-picked blue would be a legend that disagrees with its
 * raster, which is the defect that file records.
 *
 * With the four-product default the arithmetic is exact in both directions:
 * `blues` has five stops, so t = k/4 lands on stop k and no interpolation
 * happens at all. For any other product count the value is interpolated, and
 * the two sides can differ by one part in 255 -- the renderer interpolates the
 * float stops and truncates once, this interpolates stops that were already
 * truncated. That is below a visible difference and is not worth a second
 * palette file to remove.
 */
import { PALETTE_STOPS } from "@/lib/palettes"
import type { FloodAgreement, FloodCellSize } from "@/lib/types"

/** Where a cell stands: which of terrain or DEM choice decided it. */
export type AgreementStanding = "dry" | "contested" | "unanimous"

export interface AgreementLevel {
  /** How many products call the cell flooded. */
  count: number
  /** Products in the run, so a level can name itself "2 of 4". */
  of: number
  cells: number
  areaKm2: number
  /** Share of the measured window, 0..1. Not a share of the AOI. */
  frac: number
  /**
   * The colour the raster gives these cells, or null for the cells no product
   * calls flooded -- those are transparent in the rendering, and giving them a
   * swatch would put a colour in the legend that appears nowhere on the map.
   */
  color: string | null
  standing: AgreementStanding
}

/**
 * Mirror of composite._lerp_cmap for one scalar.
 *
 * The index rule is the renderer's, including the clamp of the segment index
 * at n-1 so that t = 1 reads the last segment at f = 1 rather than running off
 * the end of the stop list.
 */
function rampColor(t: number, stops: string[]): string {
  const clamped = Math.min(1, Math.max(0, t))
  const segments = stops.length - 1
  const idx = Math.min(Math.floor(clamped * segments), segments - 1)
  const f = clamped * segments - idx
  const byte = (hex: string, at: number) =>
    parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16)
  const channel = (at: number) => {
    const a = byte(stops[idx], at)
    const b = byte(stops[idx + 1], at)
    // Truncation, not rounding: the renderer casts a float to uint8, which
    // drops the fraction.
    return Math.trunc(a + (b - a) * f)
  }
  const hex = (v: number) => v.toString(16).padStart(2, "0")
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`
}

/** The colour sidecar/infer.py agreement_rgba gives a cell at this count. */
export function agreementColor(count: number, of: number): string | null {
  if (count <= 0) return null
  return rampColor(count / Math.max(of, 1), PALETTE_STOPS.blues)
}

/**
 * One row per agreement level, dry level first.
 *
 * The area of a level is its cell count times the cell size, which is how
 * every area in this payload is derived (see FloodAssumptions.cell_size). It
 * is recomputed here rather than read from the payload because the payload
 * carries only three aggregates -- unanimous wet, contested, unanimous dry --
 * and the point of the raster is the levels between them.
 */
export function agreementLevels(
  agreement: FloodAgreement,
  cell: FloodCellSize
): AgreementLevel[] {
  const counts = agreement.counts ?? []
  const of = Math.max(counts.length - 1, 0)
  const total = counts.reduce((sum, n) => sum + n, 0)
  const cellKm2 = (cell.x * cell.y) / 1e6
  return counts.map((cells, count) => ({
    count,
    of,
    cells,
    areaKm2: cells * cellKm2,
    frac: total > 0 ? cells / total : 0,
    color: agreementColor(count, of),
    standing:
      count === 0 ? "dry" : count === of ? "unanimous" : "contested",
  }))
}

/** "0 of 4", "3 of 4" — the class name, never a range. */
export function agreementLevelLabel(level: AgreementLevel): string {
  return `${level.count} of ${level.of}`
}

/**
 * What the level means, in the terms the analysis is about: where the terrain
 * decides the extent and where the choice of DEM decides it.
 */
export function agreementStandingLabel(level: AgreementLevel): string {
  if (level.standing === "dry") return "no product calls it flooded"
  if (level.standing === "unanimous") return "every product agrees, terrain decides"
  return "products disagree, the DEM decides"
}
