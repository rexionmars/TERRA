/**
 * The mineral map's names and colours, stated once for every surface that
 * draws it.
 *
 * The layer table, the asset table, the legend and the reading all refer to a
 * group's raster, and each needs the same id, the same title and the same two
 * greys. Written in four places they would be four copies that can disagree
 * -- the failure lib/mapLayers.ts exists to prevent for the rasters in general.
 *
 * Nothing here decides a colour for a class. The class colours travel in the
 * payload's `legend`, which the sidecar drew the PNGs with, and are read from
 * there.
 */
import type { MineralAnalysis, MineralGroup, MineralLayer } from "@/lib/types"

/**
 * The prefix every mineral layer id carries. The map has one layer per group,
 * and the prefix is what marks an id as one of them.
 */
export const MINERAL_LAYER_PREFIX = "mineral:"

/** The layer id of one group's class map. */
export function mineralLayerId(group: number): string {
  return `${MINERAL_LAYER_PREFIX}${group}`
}

/**
 * The layer id of one derived raster (a MineralLayer: the pass used, the
 * exposure, a band position, a fit margin, an agreement with L2B).
 *
 * Under the same prefix as the group maps, so one switch table governs every
 * plane the mineral map draws; mineralGroupOfLayer still answers null for
 * these, whose names are not numbers.
 */
export function mineralDerivedLayerId(id: string): string {
  return `${MINERAL_LAYER_PREFIX}${id}`
}

/** Whether a layer id is any of the mineral map's planes. */
export function isMineralLayer(layerId: string): boolean {
  return layerId.startsWith(MINERAL_LAYER_PREFIX)
}

/** The derived raster a layer id names, or null. */
export function mineralDerivedLayer(
  m: MineralAnalysis | null | undefined,
  layerId: string
): MineralLayer | null {
  if (!m || !isMineralLayer(layerId) || mineralGroupOfLayer(layerId) !== null) return null
  const id = layerId.slice(MINERAL_LAYER_PREFIX.length)
  return m.layers?.find((l) => l.id === id) ?? null
}

/**
 * The passes that answered for some cell.
 *
 * A run made since the passes were compared per cell lists every pass it
 * compared in `scenes`, including those no cell was taken from; one made
 * before listed only the passes it used.
 */
export function mineralPassesUsed(m: MineralAnalysis): number {
  return m.selection ? m.selection.contributing_passes : m.scenes.length
}

/**
 * A continuous layer's ramp as a CSS gradient, from the stops the sidecar
 * painted it with (MineralRamp.colors, evenly spaced from min to max).
 */
export function mineralRampGradient(colors: readonly string[]): string {
  if (colors.length === 0) return "transparent"
  if (colors.length === 1) return colors[0]
  const stops = colors.map((c, i) => `${c} ${((i / (colors.length - 1)) * 100).toFixed(1)}%`)
  return `linear-gradient(to right, ${stops.join(", ")})`
}

/** What the next mineral run is asked to do beyond the area and the period. */
export interface MineralRunOptions {
  /** Passes compared per cell, 1 to 10. */
  passes: number
  /** Uncertainty draws, 0 to 50; 0 skips them. */
  draws: number
}

/**
 * Six passes: EMIT observes a place on few, irregular passes (4 to 16 over
 * 2022-2026 at four Brazilian sites), so six usually compares every pass of a
 * year, and each is one read of the area. No draws: each costs a full
 * classification, and the uncertainty is a second cube as large as the
 * reflectance.
 */
export const DEFAULT_MINERAL_RUN_OPTIONS: MineralRunOptions = { passes: 6, draws: 0 }

/** The group a layer id names, or null when it is not a mineral layer. */
export function mineralGroupOfLayer(layerId: string): number | null {
  if (!layerId.startsWith(MINERAL_LAYER_PREFIX)) return null
  const n = Number(layerId.slice(MINERAL_LAYER_PREFIX.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * A group's raster, named by the wavelength region it reads.
 *
 * By region rather than by "group 1" and "group 2", which are Tetracorder's
 * internal numbering and say nothing to a reader choosing which plane to look
 * at. A group the table does not know is still named, by its number.
 */
export function mineralGroupTitle(group: number): string {
  if (group === 1) return "Minerals 0.4-1.3 um (Fe)"
  if (group === 2) return "Minerals 2.0-2.5 um"
  return `Minerals, group ${group}`
}

/**
 * Whether a group's layer is drawn before the reader chooses.
 *
 * ONE GROUP AT A TIME, because the two maps cover the same cells: every cell
 * carries one answer from each group, so drawing both puts the upper map over
 * the lower and the lower is not visible anywhere they overlap. Group 2 is the
 * default because it separates the clays, carbonates and micas, which is the
 * mineralogy most areas are asked about, and it is the map the saved run's
 * thumbnail is taken from (persistMineralRun), so the board and the run list
 * show the same picture. Group 1 is one switch away.
 */
export function mineralLayerDefaultVisible(group: number): boolean {
  return group === 2
}

/*
  The two states the class maps draw in grey, and which the payload does not
  carry.

  COPIED FROM sidecar/terra/mineral/mapping.py, NO_ANSWER_RGBA (200, 200, 200,
  90) and MASKED_RGBA (90, 90, 90, 140), with the alpha divided by 255. A hand
  copy is the thing lib/layerLegend.ts warns about, and it is taken here only
  because these two values are not in `legend`; the day they are, this pair
  should be read from the payload and removed.
*/
export const MINERAL_NO_ANSWER_COLOR = "rgba(200, 200, 200, 0.353)"
export const MINERAL_MASKED_COLOR = "rgba(90, 90, 90, 0.549)"

/** One output cell's area in hectares, or null where the area has no cells. */
export function mineralCellAreaHa(m: MineralAnalysis): number | null {
  return m.aoi_cells > 0 ? m.aoi_area_ha / m.aoi_cells : null
}

/**
 * The colour a class was drawn with.
 *
 * The payload's legend first, since it is the table the PNG was painted from;
 * the class row's own colour where the legend does not name the class.
 */
export function mineralClassColor(
  m: MineralAnalysis,
  cls: string,
  fallback = ""
): string {
  return m.legend.find((l) => l.class === cls)?.color || fallback
}

/**
 * Observed cells in one group that carry no mineral answer, in hectares.
 *
 * The observed area less what the group identified. Vegetation, water and
 * cloud edges fall here, as do surfaces whose absorptions no reference in the
 * group matched within its constraints. Clamped at zero so a rounding
 * difference between the two figures cannot report a negative area.
 */
export function mineralNoAnswerHa(m: MineralAnalysis, g: MineralGroup): number {
  return Math.max(0, m.observed_area_ha - g.detected_area_ha)
}
