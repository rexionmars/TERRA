/**
 * What is drawn over the AOI, in what order, and how solid.
 *
 * The map derived this inline: four visibility predicates and six hand-written
 * `Bounds` to Leaflet conversions, each carrying its own copy of the
 * zero-extent guard. That was tolerable while the map was the only thing
 * drawing them. The isolate board draws the same set with the same controls
 * governing it, and a second derivation would disagree with the first within a
 * release -- silently, because both would look plausible.
 *
 * The layer is described here without saying how it is drawn. The map turns it
 * into an ImageOverlay positioned by latitude and longitude; the board turns it
 * into a textured plane with no coordinates at all. Neither belongs in a table
 * about which rasters exist.
 */
import type {
  Bounds,
  CompositionOverlay,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"

export interface RasterLayer {
  /** Stable across renders, so a consumer can key on it. */
  id: string
  /** Named for a reader, not for the payload field it came from. */
  title: string
  uri: string
  extent: Bounds
  opacity: number
  /**
   * Where it sits in the stack. The map's existing z-indices, kept as the
   * ordering because they already encode a decision: a classification stays
   * readable over surface water, and confidence reads over the classification.
   */
  order: number
  /** Class rasters must not be interpolated; continuous ones may be. */
  pixelated: boolean
}

/**
 * A zero box is what the sidecar returns when it resolved no window.
 *
 * Drawn, it stretches the raster across the null island off the coast of
 * Ghana. Six call sites each carried their own copy of this test; it is one
 * function now, and the comment that used to be repeated with it lives here.
 */
export function isZeroExtent(e: Bounds | null | undefined): boolean {
  return (
    !e ||
    (e.lon_min === 0 && e.lon_max === 0 && e.lat_min === 0 && e.lat_max === 0)
  )
}

/** `Bounds` as Leaflet wants them, or null where there is nothing to draw. */
export function boundsToLatLng(
  e: Bounds | null | undefined
): [[number, number], [number, number]] | null {
  if (isZeroExtent(e)) return null
  const b = e as Bounds
  return [
    [b.lat_min, b.lon_min],
    [b.lat_max, b.lon_max],
  ]
}

export interface VisibleLayerInput {
  result: PredictResult | null
  showPredictionOverlay: boolean
  overlayOpacity: number
  showConfidence: boolean
  /**
   * Whether the prediction stays under the confidence raster.
   *
   * Confidence is semi-transparent, so the prediction shows through it. With
   * this off, confidence is shown alone -- which is the only way to read it
   * without the classification's colours underneath.
   */
  confidenceOnTop: boolean
  composition: CompositionOverlay | null
  showCompositionOverlay: boolean
  composeOpacity: number
  water: WaterAnalysis | null | undefined
  showWaterOverlay: boolean
  waterOpacity: number
  /** Already-resolved solar rasters, in the order the caller wants them. */
  solarOverlays?: { id: string; title: string; uri: string; extent: Bounds; opacity: number }[]
}

/**
 * The rasters currently drawn, bottom of the stack first.
 *
 * The prediction slot falls back through the classification, the MapBiomas
 * descriptive map and the reference: a run that carries no classification
 * still has something to show, and which one it is has never been the caller's
 * business.
 */
export function visibleRasterLayers(i: VisibleLayerInput): RasterLayer[] {
  const layers: RasterLayer[] = []

  if (
    i.composition &&
    i.showCompositionOverlay &&
    i.composition.overlay_uri &&
    !isZeroExtent(i.composition.extent)
  ) {
    layers.push({
      id: "composition",
      title: i.composition.title || "Composition",
      uri: i.composition.overlay_uri,
      extent: i.composition.extent,
      opacity: i.composeOpacity,
      order: 350,
      // A composite is continuous colour, not classes.
      pixelated: false,
    })
  }

  for (const [n, o] of (i.solarOverlays ?? []).entries()) {
    if (!o.uri || isZeroExtent(o.extent)) continue
    layers.push({
      id: `solar:${o.id}`,
      title: o.title,
      uri: o.uri,
      extent: o.extent,
      opacity: o.opacity,
      order: 358 + n,
      pixelated: false,
    })
  }

  if (
    i.water?.occurrence_uri &&
    i.showWaterOverlay &&
    !isZeroExtent(i.water.extent)
  ) {
    layers.push({
      id: "water",
      title: "Surface water",
      uri: i.water.occurrence_uri,
      extent: i.water.extent,
      opacity: i.waterOpacity,
      order: 360,
      pixelated: false,
    })
  }

  const predictionUri =
    i.result?.overlay_uri || i.result?.lulc?.map_uri || i.result?.reference_uri
  const predictionUnderConfidence = !i.showConfidence || i.confidenceOnTop

  if (
    i.result &&
    predictionUri &&
    i.showPredictionOverlay &&
    predictionUnderConfidence &&
    !isZeroExtent(i.result.extent)
  ) {
    layers.push({
      id: "prediction",
      title: "Classification",
      uri: predictionUri,
      extent: i.result.extent,
      opacity: i.overlayOpacity,
      order: 400,
      pixelated: true,
    })
  }

  if (
    i.result?.confidence_uri &&
    i.showConfidence &&
    !isZeroExtent(i.result.extent)
  ) {
    layers.push({
      id: "confidence",
      title: "Confidence",
      uri: i.result.confidence_uri,
      extent: i.result.extent,
      opacity: i.overlayOpacity,
      order: 450,
      pixelated: false,
    })
  }

  return layers.sort((a, b) => a.order - b.order)
}
