/**
 * Which rasters' legends the map draws beside them.
 *
 * Every raster with a legend can have it drawn on the map; which are drawn
 * without being asked is a separate rule. A ramp is short and is what makes a
 * continuous raster readable at all, so it is drawn unless the reader takes it
 * off. A list of classes, a block of figures or a note runs longer and covers
 * more ground, so it waits to be asked for from the raster's menu. The card
 * keeps a class list short by showing the largest classes by share and saying
 * how many more there are (OverlayCallout's LegendBody).
 *
 * The reader's choice is kept per raster and outlives the default: a legend
 * taken off stays off, and one asked for stays on.
 */

/** The reader's choices, by raster key; a raster absent here follows its default. */
export type LegendChoice = Readonly<Record<string, boolean>>

export interface LegendState {
  key: string
  /** Whether the raster has a legend the map can draw. */
  hasLegend: boolean
  /** Whether that legend is drawn when the reader has not chosen. */
  byDefault: boolean
}

export function legendShown(choice: LegendChoice, s: LegendState): boolean {
  return s.hasLegend && (choice[s.key] ?? s.byDefault)
}

/** The choices after the reader turns one raster's legend over. */
export function toggleLegend(choice: LegendChoice, s: LegendState): LegendChoice {
  if (!s.hasLegend) return choice
  return { ...choice, [s.key]: !legendShown(choice, s) }
}
