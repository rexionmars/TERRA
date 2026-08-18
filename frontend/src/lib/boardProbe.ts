/**
 * Sample a categorical board plane at a UV, for the brush probe.
 *
 * Reuses classMask's URI→index cache so moving the pointer does not re-decode
 * the PNG. Continuous rasters are refused there; this module only ever asks
 * about prediction (and other hard-colour class maps).
 */
import {
  NO_CLASS,
  classIndexFor,
  type ClassIndexMap,
  type ClassLegendEntry,
} from "@/lib/classMask"

/** Brush neighbourhood in pixels of the source PNG (0 = single texel). */
export type BrushRadiusPx = 0 | 1 | 2 | 4

/**
 * The grid a run was made on, when the run does not say.
 *
 * Sentinel-2's 10 m bands are what every classification here is built from, and
 * `class_statistics` in the sidecar has always turned a pixel count into
 * hectares at this figure. Runs saved before `pixel_size_m` was carried fall
 * back on it rather than on nothing.
 */
export const FALLBACK_PIXEL_SIZE_M = 10

/**
 * What a brush radius actually samples, on the ground.
 *
 * The radius is a disc in texels -- `dx² + dy² <= r²` -- so a radius of 2 spans
 * FIVE pixels across and covers thirteen of them, not the three the button's
 * tooltip used to claim. Stating the span in metres is the point: a reader
 * asking whether a prediction holds over a field is asking about ground, and
 * "M" answered in neither.
 */
export interface BrushFootprint {
  /** Pixels across the disc, which is 2r + 1. */
  spanPx: number
  /** The same across the ground. */
  spanM: number
  /** Texels inside the disc, which is what a majority is taken over. */
  texels: number
  /** Their area, in hectares. */
  areaHa: number
}

export function brushFootprint(
  radius: BrushRadiusPx,
  pixelSizeM = FALLBACK_PIXEL_SIZE_M
): BrushFootprint {
  let texels = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) texels++
    }
  }
  const spanPx = 2 * radius + 1
  return {
    spanPx,
    spanM: spanPx * pixelSizeM,
    texels,
    areaHa: (texels * pixelSizeM * pixelSizeM) / 10_000,
  }
}

export interface ClassProbeSample {
  /** Legend ordinal, or NO_CLASS. */
  ordinal: number
  entry: ClassLegendEntry | null
  /** How many classified neighbours voted for this class (1 when radius 0). */
  votes: number
  /** Classified neighbours examined. */
  examined: number
  /**
   * The raster the sample came from, in texels.
   *
   * Carried so the lens drawn on the plane can be the size of the disc that was
   * actually read. Sized as a fraction of the plane it was a decoration that
   * happened to sit near the pointer, and it disagreed with the sample by
   * whatever the raster's aspect ratio happened to be.
   */
  mapWidth: number
  mapHeight: number
}

/**
 * UV from three.js (origin bottom-left) → integer texel (origin top-left).
 *
 * TextureLoader defaults to flipY, so the mesh UV that paints the image top at
 * v=1 matches ImageData's row 0 at the top of the buffer.
 */
export function uvToTexel(
  u: number,
  v: number,
  width: number,
  height: number
): { x: number; y: number } {
  const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)))
  return { x, y }
}

function majorityAt(
  map: ClassIndexMap,
  cx: number,
  cy: number,
  radius: number
): { ordinal: number; votes: number; examined: number } {
  const counts = new Map<number, number>()
  let examined = 0
  const r = Math.max(0, radius)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      const ord = map.index[y * map.width + x]
      if (ord === NO_CLASS) continue
      examined++
      counts.set(ord, (counts.get(ord) ?? 0) + 1)
    }
  }
  if (!examined) return { ordinal: NO_CLASS, votes: 0, examined: 0 }
  let best = NO_CLASS
  let bestN = -1
  for (const [ord, n] of counts) {
    if (n > bestN) {
      best = ord
      bestN = n
    }
  }
  return { ordinal: best, votes: bestN, examined }
}

/**
 * Class under a board-plane UV, with an optional circular brush majority.
 */
export async function sampleClassAtUv(
  uri: string,
  legend: ReadonlyArray<ClassLegendEntry>,
  u: number,
  v: number,
  radiusPx: BrushRadiusPx = 0
): Promise<ClassProbeSample> {
  const map = await classIndexFor(uri, legend)
  const { x, y } = uvToTexel(u, v, map.width, map.height)
  const { ordinal, votes, examined } = majorityAt(map, x, y, radiusPx)
  const entry =
    ordinal === NO_CLASS || ordinal < 0 || ordinal >= legend.length
      ? null
      : legend[ordinal]
  return { ordinal, entry, votes, examined, mapWidth: map.width, mapHeight: map.height }
}

export interface ClassMapCompare {
  shared: number
  same: number
  /** Percent of shared pixels with the same class ordinal. */
  pct: number
  /** legendA ordinal → legendB ordinal counts (rows × cols). */
  transitions: number[][]
  legendA: ClassLegendEntry[]
  legendB: ClassLegendEntry[]
}

/**
 * Pixel agreement and class-transition matrix between two prediction rasters.
 *
 * Same grid required. Class ordinals are compared within each legend; when the
 * two legends share the same class ids in the same order the diagonal is
 * agreement, otherwise the matrix still shows how A’s labels map onto B’s.
 */
export async function compareClassMaps(
  uriA: string,
  legendA: ReadonlyArray<ClassLegendEntry>,
  uriB: string,
  legendB: ReadonlyArray<ClassLegendEntry>
): Promise<ClassMapCompare> {
  const [a, b] = await Promise.all([
    classIndexFor(uriA, legendA),
    classIndexFor(uriB, legendB),
  ])
  if (a.unmatched > 0 || b.unmatched > 0) {
    throw new Error(
      `A legend does not explain its raster (${a.unmatched + b.unmatched} unmatched).`
    )
  }
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Different grids: ${a.width}×${a.height} vs ${b.width}×${b.height}.`
    )
  }
  const na = legendA.length
  const nb = legendB.length
  const transitions = Array.from({ length: na }, () =>
    Array.from({ length: nb }, () => 0)
  )
  let shared = 0
  let same = 0
  for (let i = 0; i < a.index.length; i++) {
    const x = a.index[i]
    const y = b.index[i]
    if (x === NO_CLASS || y === NO_CLASS) continue
    if (x >= na || y >= nb) continue
    shared++
    transitions[x][y]++
    // Same MapBiomas / class id when both legends carry it.
    if (legendA[x].id === legendB[y].id) same++
  }
  return {
    shared,
    same,
    pct: shared ? (same / shared) * 100 : 0,
    transitions,
    legendA: [...legendA],
    legendB: [...legendB],
  }
}

