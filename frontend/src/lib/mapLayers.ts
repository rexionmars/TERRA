/**
 * What is drawn over the AOI, in what order, and how solid.
 *
 * The map derived this inline: four visibility predicates and six hand-written
 * `Bounds` to Leaflet conversions, each carrying its own copy of the
 * zero-extent guard. That was tolerable while the map was the only thing
 * drawing them. The studio draws the same set with the same controls
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
  MineralAnalysis,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import {
  mineralGroupTitle,
  mineralLayerDefaultVisible,
  mineralLayerId,
} from "@/lib/mineral"

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
  /**
   * Whether the majority filter is applied before drawing.
   *
   * Here rather than at each surface because it decides WHERE A CLASS BOUNDARY
   * IS. Two surfaces disagreeing about that is not a cosmetic difference -- it
   * is two answers to one question, which is the failure this table exists to
   * prevent.
   */
  smooth: boolean
  /**
   * Whether it is currently drawn.
   *
   * The table returns layers that COULD be drawn, not only those that are, so
   * a list of them can offer the switch that turns a hidden one back on. A
   * table that omitted what is off would let the user hide something and then
   * have nowhere to find it again.
   */
  visible: boolean
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
  /** Applies to the classification alone; nothing else carries a legend. */
  smoothOverlay: boolean
  composition: CompositionOverlay | null
  showCompositionOverlay: boolean
  composeOpacity: number
  water: WaterAnalysis | null | undefined
  showWaterOverlay: boolean
  waterOpacity: number
  /**
   * The mineral map, one class raster per Tetracorder group.
   *
   * Optional where the other rasters are not: a mineral map is run against an
   * area rather than being part of a classification's output, so most callers
   * have none. The switches are per layer id, because the two groups are two
   * planes a reader turns on and off separately; a layer with no entry takes
   * mineralLayerDefaultVisible and full opacity.
   */
  mineral?: MineralAnalysis | null
  mineralLayers?: Readonly<Record<string, { visible?: boolean; opacity?: number }>>
}

/** Which of the three maps the `prediction` layer draws. */
export type PredictionSource = "classification" | "lulc" | "reference"

/**
 * Which raster the `prediction` layer draws, and where it came from.
 *
 * Exported because more than one thing has to answer this question, and when
 * two of them answered it separately they disagreed. The legend preferred the
 * MapBiomas map wherever one existed while this preferred the classification,
 * so a run carrying both drew the classification under a MapBiomas legend --
 * a plane whose purple was soybean, described as 71% sugar cane.
 *
 * The order is the layer's own and the only one: a run's own classification
 * first, then a MapBiomas map produced for it, then the reference it was
 * scored against.
 */
export function predictionSource(
  r: PredictResult | null | undefined
): { source: PredictionSource; uri: string } | null {
  if (!r) return null
  if (r.overlay_uri) return { source: "classification", uri: r.overlay_uri }
  if (r.lulc?.map_uri) return { source: "lulc", uri: r.lulc.map_uri }
  if (r.reference_uri) return { source: "reference", uri: r.reference_uri }
  return null
}

/**
 * The mineral map's class rasters as drawn layers, one per group that has one.
 *
 * Placed by the payload's `extent`, which is the box the PNG was written over.
 * Above surface water and below the classification: the class maps and the
 * occurrence raster are both rasters of the ground's surface over one area, and
 * a classification stays readable over each. Not interpolated -- a cell is one
 * reference's class, and a blend of two class colours names no mineral.
 */
export function mineralLayers(
  m: MineralAnalysis | null | undefined,
  state: Readonly<Record<string, { visible?: boolean; opacity?: number }>> = {}
): RasterLayer[] {
  if (!m || isZeroExtent(m.extent)) return []
  const out: RasterLayer[] = []
  for (const g of m.groups ?? []) {
    if (!g.class_uri) continue
    const id = mineralLayerId(g.group)
    out.push({
      id,
      title: mineralGroupTitle(g.group),
      uri: g.class_uri,
      extent: m.extent,
      opacity: state[id]?.opacity ?? 1,
      order: 361 + Math.min(Math.max(g.group, 1), 3),
      pixelated: true,
      smooth: false,
      visible: state[id]?.visible ?? mineralLayerDefaultVisible(g.group),
    })
  }
  return out
}

/**
 * Every raster this run could draw, bottom of the stack first.
 *
 * The prediction slot falls back through the classification, the MapBiomas
 * descriptive map and the reference: a run that carries no classification
 * still has something to show, and which one it is has never been the caller's
 * business.
 */
export function rasterLayers(i: VisibleLayerInput): RasterLayer[] {
  const layers: RasterLayer[] = []

  if (
    i.composition &&
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
      smooth: false,
      visible: i.showCompositionOverlay,
    })
  }

  if (i.water?.occurrence_uri && !isZeroExtent(i.water.extent)) {
    layers.push({
      id: "water",
      title: "Surface water",
      uri: i.water.occurrence_uri,
      extent: i.water.extent,
      opacity: i.waterOpacity,
      order: 360,
      pixelated: false,
      smooth: false,
      visible: i.showWaterOverlay,
    })
  }

  layers.push(...mineralLayers(i.mineral, i.mineralLayers))

  const prediction = predictionSource(i.result)
  const predictionUri = prediction?.uri
  const predictionUnderConfidence = !i.showConfidence || i.confidenceOnTop

  if (i.result && predictionUri && !isZeroExtent(i.result.extent)) {
    layers.push({
      id: "prediction",
      /*
        Named for what it IS, not for the slot it occupies. The three sources
        are three different maps with three different class sets, and calling
        the MapBiomas one "Classification" is the same mistake the legend made.
      */
      title:
        prediction?.source === "lulc"
          ? `MapBiomas ${i.result.lulc?.year ?? ""}`.trim()
          : prediction?.source === "reference"
            ? "Reference map"
            : "Classification",
      uri: predictionUri,
      extent: i.result.extent,
      opacity: i.overlayOpacity,
      order: 400,
      pixelated: true,
      smooth: i.smoothOverlay,
      // Two conditions, and the second is not the user's switch: with the
      // confidence raster on top and "keep prediction under" off, the
      // classification is withheld so the confidence can be read alone.
      visible: i.showPredictionOverlay && predictionUnderConfidence,
    })
  }

  if (i.result?.confidence_uri && !isZeroExtent(i.result.extent)) {
    layers.push({
      id: "confidence",
      title: "Confidence",
      uri: i.result.confidence_uri,
      extent: i.result.extent,
      opacity: i.overlayOpacity,
      order: 450,
      pixelated: false,
      smooth: false,
      visible: i.showConfidence,
    })
  }

  return layers.sort((a, b) => a.order - b.order)
}
