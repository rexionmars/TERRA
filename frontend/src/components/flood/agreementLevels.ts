/**
 * The agreement raster as a small set of named classes, with the colour the
 * renderer gave each one.
 *
 * THE LEGEND IS DISCRETE BECAUSE THE QUANTITY IS. "Three of four products"
 * is not a position on a ramp: there is no cell between three and four, and a
 * gradient bar with two end labels invites the reader to interpolate one. The
 * raster is drawn from a continuous ramp only because that is what makes the
 * ordering legible; what it encodes is N classes, and this module turns the
 * payload's `counts` array into exactly those classes.
 *
 * "0 OF 4" IS NOT ONE OF THEM. counts[0] is every AOI cell no product calls
 * flooded, which on the recorded run is 4818 of 5256 cells, 91.7 percent of
 * the area. That a cell is called dry by everybody says nothing about how far
 * the products agree WITH EACH OTHER, which is the one thing this analysis
 * measures, and a list whose subject is disagreement is dominated by it.
 * `agreementLevels` therefore starts at one product and the dry remainder
 * comes back from `agreementDry`, which the reading prints as a figure and not
 * as a class: the raster leaves those cells transparent, so a swatch matching
 * the others would put a colour in the legend that appears nowhere on the map.
 *
 * THE COUNT IS NOT A CONFIDENCE SCALE, and the ramp reads like one. Darkening
 * blue from 1 of 4 to 4 of 4 orders the classes correctly and still invites
 * "1 of 4 is a shallow flood, 4 of 4 is a deep one". Neither is a depth: 4 of
 * 4 is where the terrain decides the extent and 1 of 4 is the widest
 * disagreement the product set can produce. `agreementStandingLabel` says
 * which, per class, in those words.
 *
 * THE SWATCH IS THE PIXEL. sidecar/infer.py agreement_rgba colours a cell by
 * t = count / n_products through composite._BLUES, and leaves count 0
 * transparent. The same t through the same stops is computed here, so a swatch
 * in the legend is the colour of the cells it names rather than an
 * approximation of them. lib/palettes.ts is generated from those stops for
 * this reason; a hand-picked blue would be a legend that disagrees with its
 * raster, which is the defect that file records. It is also why these colours
 * are not tokens in index.css: a token is a colour this interface chooses, and
 * these are colours it reads off the renderer.
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

/** Which of terrain or DEM choice decided the cell. */
export type AgreementStanding = "contested" | "unanimous"

export interface AgreementLevel {
  /** How many products call the cell flooded. At least one. */
  count: number
  /** Products in the run, so a level can name itself "2 of 4". */
  of: number
  cells: number
  areaKm2: number
  /**
   * Share of the AOI, 0..1. The counts sum to the cells inside the AOI
   * polygon, so this is a share of the ground the reader drew and not of the
   * buffered window the terrain chain ran over.
   */
  frac: number
  /** The colour the raster gives these cells. */
  color: string
  standing: AgreementStanding
}

/** The AOI cells no product calls flooded: the remainder, not a class. */
export interface AgreementDry {
  cells: number
  areaKm2: number
  /** Share of the AOI, 0..1. */
  frac: number
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

/** The colour of a cell the raster draws, which is a cell at count >= 1. */
function wetColor(count: number, of: number): string {
  return rampColor(count / Math.max(of, 1), PALETTE_STOPS.blues)
}

/**
 * The colour sidecar/infer.py agreement_rgba gives a cell at this count, null
 * where it draws nothing. The null is the renderer's transparency rule and is
 * why the dry remainder is reported without a swatch.
 */
export function agreementColor(count: number, of: number): string | null {
  if (count <= 0) return null
  return wetColor(count, of)
}

/** Cell area in km2, the way every area in this payload is derived. */
function cellKm2(cell: FloodCellSize): number {
  return (cell.x * cell.y) / 1e6
}

/**
 * One row per agreement class, from one product up to all of them.
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
  const km2 = cellKm2(cell)
  return counts
    .map((cells, count) => ({
      count,
      of,
      cells,
      areaKm2: cells * km2,
      frac: total > 0 ? cells / total : 0,
      color: wetColor(count, of),
      standing: (count === of ? "unanimous" : "contested") as AgreementStanding,
    }))
    .slice(1)
}

/**
 * The dry remainder of the AOI: counts[0], as an area and a share.
 *
 * Computed from the same counts and the same cell size as the classes rather
 * than read from agreement.unanimous_dry_km2, so the figure a reader sums the
 * legend against is derived the way the legend is. The two agree to the
 * payload's four decimal places.
 */
export function agreementDry(
  agreement: FloodAgreement,
  cell: FloodCellSize
): AgreementDry {
  const counts = agreement.counts ?? []
  const total = counts.reduce((sum, n) => sum + n, 0)
  const cells = counts[0] ?? 0
  return {
    cells,
    areaKm2: cells * cellKm2(cell),
    frac: total > 0 ? cells / total : 0,
  }
}

/** "All 4 products", "3 of 4" — the class name, never a range. */
export function agreementLevelLabel(level: AgreementLevel): string {
  return level.count === level.of
    ? `All ${level.of} products`
    : `${level.count} of ${level.of}`
}

/**
 * What the level means, in the terms the analysis is about: where the terrain
 * decides the extent and where the choice of DEM decides it.
 *
 * The contested classes are named by how many products call the cell DRY, not
 * only by how many call it wet. "1 of 4" beside "4 of 4" reads as less flood;
 * "three of four call it dry" reads as what it is, which is the widest split
 * the four products can produce.
 */
export function agreementStandingLabel(level: AgreementLevel): string {
  if (level.standing === "unanimous") {
    return "every product agrees, the terrain decides the extent"
  }
  const dry = level.of - level.count
  const widest = level.count === 1 && level.of > 1
  return (
    `${dry} of ${level.of} call it dry` +
    (widest ? ", the widest disagreement this product set can reach" : "")
  )
}
