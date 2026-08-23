/**
 * What a flood envelope run is asked for, and the DEM products it can name.
 *
 * THE PRODUCT SET IS THE ANALYSIS, so it is spelled out here rather than left
 * to the sidecar's default. The study this ports compared COP30, NASADEM,
 * SRTMGL1 and COP90 from OpenTopography; Planetary Computer, which TERRA
 * already reads its DEM from with no API key, does not carry SRTMGL1, so ALOS
 * World 3D takes its place. A reader who is not shown the set cannot know that
 * substitution happened, and the envelope this application measures is not the
 * one the study published. The note below travels with the selector for that
 * reason, and the payload's own `qualifier` repeats it after the run.
 *
 * Mirrors sidecar/dem.py COLLECTIONS and DEFAULT_IDS. The payload echoes each
 * product's id, collection and native resolution back in `products`, so
 * everything a reading states about a product comes from the response; this
 * table exists only so the set can be chosen before the response exists.
 *
 * WHAT IS SENT AND WHAT IS OMITTED. Two of these parameters are derived by the
 * sidecar from the AOI when the request leaves them out -- the buffer from the
 * AOI extent, the inset margin from the cell size -- and a fixed number sent
 * from here would replace a value computed per window with one chosen for
 * another. So they are null until the reader asks to set them, and null is not
 * sent. The other two carry the study's reference values, which are constants
 * of the method rather than of the window.
 */

/** One DEM product the envelope can be measured over. */
export interface FloodDemProduct {
  /** The id the request names and the payload echoes. */
  id: string
  /** The Planetary Computer collection behind it. */
  collection: string
  label: string
  nativeResolutionM: number
}

export const FLOOD_DEM_PRODUCTS: readonly FloodDemProduct[] = [
  {
    id: "cop30",
    collection: "cop-dem-glo-30",
    label: "Copernicus GLO-30",
    nativeResolutionM: 30,
  },
  {
    id: "nasadem",
    collection: "nasadem",
    label: "NASADEM",
    nativeResolutionM: 30,
  },
  {
    id: "alos",
    collection: "alos-dem",
    label: "ALOS World 3D",
    nativeResolutionM: 30,
  },
  {
    id: "cop90",
    collection: "cop-dem-glo-90",
    label: "Copernicus GLO-90",
    nativeResolutionM: 90,
  },
]

/**
 * Why the fourth product is not the study's fourth product. Rendered beside
 * the selector, not folded into a tooltip: it is the reason the range measured
 * here cannot be compared with the published one.
 */
export const FLOOD_PRODUCT_SUBSTITUTION_NOTE =
  "The study compared COP30, NASADEM, SRTMGL1 and COP90 from OpenTopography. " +
  "Microsoft Planetary Computer, which this application reads without an API " +
  "key, carries no SRTMGL1, so ALOS World 3D stands in its place. The " +
  "envelope measured here is therefore TERRA's own over its own product set " +
  "and is not the range the study published."

export interface FloodParams {
  /**
   * The products to compare. Fewer than two is refused by the sidecar: one
   * product yields an extent with no measure of how much of it that product
   * chose, which is the shape this analysis exists not to ship.
   */
  demIds: string[]
  /** Where the agreement raster is built. Need not be one of the swept values. */
  referenceThresholdM: number
  /** Contributing area above which a cell counts as drainage. */
  drainageKm2: number
  /** Metres beyond the AOI to read. Null leaves the sizing to the sidecar. */
  bufferM: number | null
  /**
   * Ring cut from inside the AOI polygon for the inset statistics. Null leaves
   * the width to the sidecar.
   *
   * Named for the AOI and not for an edge, because the ring is no longer taken
   * off the computed window: the buffer already puts the window outside every
   * figure reported. The request key moved with it, and the sidecar refuses
   * the old edge_margin_cells by name.
   */
  insetMarginCells: number | null
}

/**
 * The reference threshold and the drainage area are sidecar/flood.py
 * REFERENCE_THRESHOLD_M and DRAINAGE_REF_KM2, which are the study's reference
 * values. They are restated here so the panel can show what the run will use
 * before it runs; the payload's `assumptions` block states, per run, whether
 * each value was the default or the caller's.
 */
export const FLOOD_DEFAULT_PARAMS: FloodParams = {
  demIds: FLOOD_DEM_PRODUCTS.map((p) => p.id),
  referenceThresholdM: 1.0,
  drainageKm2: 0.5,
  bufferM: null,
  insetMarginCells: null,
}

/**
 * Seeds for the two derived parameters at the moment a reader takes them over.
 *
 * Not defaults: nothing sends these unless the override is switched on. They
 * are a starting figure to edit from, and the run reports the value that was
 * actually used, which is where the derived one can be read.
 */
export const FLOOD_OVERRIDE_SEED = { bufferM: 2000, insetMarginCells: 30 }

/**
 * Why the run is not admissible yet, or null when it is.
 *
 * The sidecar refuses each of these too, and its messages are the authority.
 * Refusing here as well is what keeps a reader from waiting through four DEM
 * reads to be told the request was never admissible.
 */
export function floodRequestBlocker(
  params: FloodParams,
  hasArea: boolean
): string | null {
  if (!hasArea) return "Define an area to run over."
  if (params.demIds.length < 2) {
    return (
      "An envelope is a disagreement between DEM products and needs at least " +
      "two. One product yields an extent with no measure of how much of it " +
      "that product chose."
    )
  }
  if (!(params.referenceThresholdM >= 0)) {
    return "The reference threshold is a height above the drainage and cannot be negative."
  }
  if (!(params.drainageKm2 > 0)) {
    return (
      "The drainage area must be above zero. At zero every cell is drainage, " +
      "HAND is zero everywhere and the extent is the whole AOI at every " +
      "threshold."
    )
  }
  if (params.bufferM !== null && !(params.bufferM >= 0)) {
    return "The buffer is a distance beyond the AOI and cannot be negative."
  }
  if (params.insetMarginCells !== null && !(params.insetMarginCells >= 0)) {
    return "The inset margin is a ring width and cannot be negative."
  }
  return null
}
