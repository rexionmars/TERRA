/**
 * What a flood envelope run is asked for, and the DEM products it can name.
 *
 * The product set is the analysis, and this table names it. The study this
 * ports compared COP30, NASADEM, SRTMGL1 and COP90 from OpenTopography.
 * Planetary Computer, which TERRA already reads its DEM from with no API key,
 * does not carry SRTMGL1, so ALOS World 3D takes its place. The envelope this
 * application measures is therefore over a different product set from the
 * published one. The note below is rendered with the selector, and the
 * payload's own `qualifier` repeats it after the run.
 *
 * Mirrors sidecar/dem.py COLLECTIONS and DEFAULT_IDS. The payload echoes each
 * product's id, collection and native resolution back in `products`, so
 * everything a reading states about a product comes from the response; this
 * table exists so the set can be chosen before the response exists.
 *
 * Two parameters are omitted from the request unless asked for. The sidecar
 * derives the buffer from the AOI extent and the inset margin from the cell
 * size, per window. A fixed number sent from here would replace a value
 * computed per window with one chosen for another, so both are null until the
 * reader sets them, and null is not sent. The other two carry the study's
 * reference values, which are constants of the method.
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
 * Which product stands in for the study's fourth, and why the range measured
 * here cannot be compared with the published one. Rendered beside the
 * selector.
 */
export const FLOOD_PRODUCT_SUBSTITUTION_NOTE =
  "The study E-hand-flood-baseline compared COP30, NASADEM, SRTMGL1 and COP90 " +
  "from OpenTopography. Microsoft Planetary Computer, which this application " +
  "reads without an API key, carries no SRTMGL1, so ALOS World 3D stands in " +
  "its place. The envelope measured here is over that different product set, " +
  "and the range the study published does not apply to it."

export interface FloodParams {
  /**
   * The products to compare. The sidecar refuses fewer than two: one product
   * yields an extent with no measure of how much of it that product chose.
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
   * The ring is cut from the AOI polygon; it was once cut from the border of
   * the computed window. The request key is inset_margin_cells, and the
   * sidecar refuses the earlier edge_margin_cells by name.
   */
  insetMarginCells: number | null
}

/**
 * The reference threshold and the drainage area are sidecar/flood.py
 * REFERENCE_THRESHOLD_M and DRAINAGE_REF_KM2, the study's reference values.
 * They are restated here so the panel can show what the run will use before it
 * runs; the payload's `assumptions` block states, per run, whether each value
 * was the default or the caller's.
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
 * Nothing sends these unless the override is switched on. They are a starting
 * figure to edit from. The run reports the value it used, which is where the
 * derived one can be read.
 */
export const FLOOD_OVERRIDE_SEED = { bufferM: 2000, insetMarginCells: 30 }

/**
 * The fewest elevation products an envelope can be made from.
 *
 * Two, because an envelope IS the disagreement between products: one yields an
 * extent with no measure of how much of it follows from the choice of product.
 * Named rather than written out, because four places had the numeral -- this
 * refusal, the board's run button, the card that will not let the second
 * product be unpicked, and the wire that draws the input as absent -- and a
 * rule stated four times is a rule three of them can be wrong about.
 */
export const FLOOD_LEAST_DEMS = 2

/**
 * Why the run is not admissible yet, or null when it is.
 *
 * The sidecar refuses each of these as well, and its messages are the
 * authority. Refusing here avoids waiting through four DEM reads for a
 * request that was never admissible.
 */
export function floodRequestBlocker(
  params: FloodParams,
  hasArea: boolean
): string | null {
  if (!hasArea) return "Define an area to run over."
  if (params.demIds.length < FLOOD_LEAST_DEMS) {
    return (
      "An envelope is a disagreement between DEM products and needs at least " +
      "two. One product yields an extent with no measure of how much of it " +
      "follows from the choice of product."
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
