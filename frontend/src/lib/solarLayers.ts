/**
 * Which solar rasters are drawn, derived once.
 *
 * The energy screen built this list inline to hand to its MapView. The board
 * needs the SAME list, from the same store, and a second derivation would
 * disagree with the first within a release -- silently, because both would look
 * plausible. It is the reason lib/mapLayers.ts and lib/runAssets.ts exist, and
 * the reason there must not be a third shape called `solarOverlays`.
 *
 * Only two of the four solar products produce a raster; the other two produce
 * figures. That fact is declared per product in components/energy/solarProducts.ts
 * and is why this file knows about exactly two.
 */
import type {
  Bounds,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
} from "@/lib/types"

/**
 * One drawn solar raster.
 *
 * The id is the literal pair rather than a string because MapView's own prop
 * narrows it that way, and the two products are a closed set -- a third would
 * be a new sidecar action, not a new string. Widening it here would push the
 * narrowing onto every caller.
 *
 * `title` and `pixelated` are surplus to MapView and required by rasterLayers.
 * Carrying both in one shape is the point: this is the ONE list, and a second
 * one shaped for each consumer is how three things called `solarOverlays` came
 * to mean three different things.
 */
export interface SolarOverlay {
  id: "terrain" | "siting"
  title: string
  uri: string
  extent: Bounds
  opacity: number
  pixelated: boolean
}

export type SolarOverlayList = SolarOverlay[]

export interface SolarLayerState {
  terrain: SolarTerrainAnalysis | null | undefined
  siting: SolarSitingAnalysis | null | undefined
  showTerrain: boolean
  showSiting: boolean
  terrainOpacity: number
  sitingOpacity: number
}

export function solarOverlayList(s: SolarLayerState): SolarOverlayList {
  const list: SolarOverlayList = []
  /*
    Terrain first so siting draws over it: the suitability classes are what a
    siting decision reads, and the irradiation underneath is the continuous
    field they were cut from. Both are drawn when both were run.
  */
  if (s.terrain?.overlay_uri && s.showTerrain) {
    list.push({
      id: "terrain",
      title: "Solar irradiation",
      uri: s.terrain.overlay_uri,
      extent: s.terrain.extent,
      opacity: s.terrainOpacity,
      // A continuous field: a value between two irradiation values is an
      // irradiation value, which is the one case where blending is honest.
      pixelated: false,
    })
  }
  if (s.siting?.overlay_uri && s.showSiting) {
    list.push({
      id: "siting",
      title: "Solar siting suitability",
      uri: s.siting.overlay_uri,
      extent: s.siting.extent,
      opacity: s.sitingOpacity,
      // Five codes, not a ramp -- the same rule as the classification and the
      // water mask. A blend of two class colours names no class.
      pixelated: true,
    })
  }
  return list
}
