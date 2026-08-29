/**
 * What is drawn over the AOI, in what order, and how solid.
 *
 * The map derived this inline: four visibility predicates and six hand-written
 * `Bounds` to Leaflet conversions, each carrying its own copy of the
 * zero-extent guard. That was tolerable while the map was the only thing
 * drawing them. The whiteboard draws the same set with the same controls
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
  FloodAnalysis,
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
   * The same ground as `uri`, carrying VALUES rather than colours.
   *
   * Present only where the run wrote one. A layer that has it is painted from
   * the measurement and coloured by an expression, so the palette and which
   * values are drawn become paint properties; a layer without it is drawn as
   * the finished image it always was.
   */
  valuesUri?: string
  /** How many discrete values the scale runs to, when `valuesUri` is set. */
  classes?: number
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
   * The flood envelope, whose agreement raster is the product it ships.
   *
   * Optional where the other rasters are not, because the map screen holds no
   * flood result: the envelope is run and read on a screen of its own, and
   * that screen calls `floodAgreementLayer` for the single raster its MapView
   * takes. Passing one here draws it with the same order and the same guard
   * rather than a second set chosen elsewhere.
   */
  flood?: FloodAnalysis | null
  showFloodOverlay?: boolean
  floodOpacity?: number
  /**
   * Already-resolved solar rasters, in the order the caller wants them.
   *
   * `pixelated` is the caller's to state because only it knows which product
   * this is: the terrain raster is a continuous irradiation field and blends
   * honestly, the siting raster is five codes and a blend between two of them
   * names no class. Defaults to false, which is the terrain case.
   */
  solarOverlays?: {
    id: string
    title: string
    uri: string
    extent: Bounds
    opacity: number
    pixelated?: boolean
  }[]
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
 * The agreement count raster as a drawn layer, or null when there is nothing
 * to draw.
 *
 * PLACED BY `flood.extent` AND NEVER BY `flood.grid.bounds`. The PNG is the
 * counts clipped to the AOI bounding box; grid.bounds is the buffered window
 * the terrain chain ran over, which on one recorded run is 8.3 times the AOI's
 * area. Placing the clip on the window would stretch it over ground it does
 * not cover, which is the same mistake in pixels that reporting figures over
 * the window was in numbers.
 *
 * Above surface water and below the classification, which is the ordering the
 * rest of this table already keeps: the occurrence raster is the standing
 * water an extent is read against, and a classification stays readable over
 * both. Not interpolated, for the reason the siting raster is not -- the cell
 * values are N+1 classes and a blend of two of them names no class.
 *
 * Exported because two surfaces draw it: the table below, and the flood
 * screen, whose MapView takes one raster per prop rather than a layer list.
 */
export function floodAgreementLayer(
  flood: FloodAnalysis | null | undefined,
  visible: boolean,
  opacity: number
): RasterLayer | null {
  if (!flood?.agreement_uri || isZeroExtent(flood.extent)) return null
  return {
    id: "flood",
    title: "Flood agreement",
    uri: flood.agreement_uri,
    extent: flood.extent,
    opacity,
    order: 365,
    pixelated: true,
    smooth: false,
    visible,
    /*
      The counts, where the run produced them. The map paints from these and
      colours them with an expression; `uri` above stays as the fallback for a
      run made before this existed, or one whose values file could not be read.
      `classes` is how many products voted, which is the top of the scale.
    */
    valuesUri: flood.agreement_values_uri || undefined,
    classes: flood.products.length || undefined,
  }
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

  for (const [n, o] of (i.solarOverlays ?? []).entries()) {
    if (!o.uri || isZeroExtent(o.extent)) continue
    layers.push({
      id: `solar:${o.id}`,
      title: o.title,
      uri: o.uri,
      extent: o.extent,
      opacity: o.opacity,
      order: 358 + n,
      pixelated: o.pixelated ?? false,
      smooth: false,
      // Solar rasters are drawn by having been produced; the energy screen
      // clears them rather than hiding them.
      visible: true,
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

  const floodLayer = floodAgreementLayer(
    i.flood,
    i.showFloodOverlay ?? true,
    i.floodOpacity ?? 1
  )
  if (floodLayer) layers.push(floodLayer)

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
