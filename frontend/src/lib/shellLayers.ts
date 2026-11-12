/**
 * Every raster a run produced as a row of the map's layer list.
 *
 * lib/mapLayers.ts lists what the application's state draws: the classification,
 * the water, the mineral maps. A vegetation health map or a set of management
 * zones has no switch up there, and on a map they are rasters like the others, so
 * they are listed here from lib/runAssets.ts, which already knows every raster a run can produce and where
 * each one sits on the ground.
 *
 * An asset already in the layer table is left to it: two rows for one raster
 * would be two switches that disagree.
 */
import type { LayerPatch } from "@/lib/layerPatch"
import type { RasterLayer } from "@/lib/mapLayers"
import type { RunAsset } from "@/lib/runAssets"
import type {
  HealthAnalysis,
  OverlapAnalysis,
  RadarAnalysis,
  ZonesAnalysis,
} from "@/lib/types"

/** What a queued product's saved run holds, which App keeps no state for. */
export interface JobReading {
  runId: string
  label: string
  health?: HealthAnalysis | null
  overlap?: OverlapAnalysis | null
  radar?: RadarAnalysis | null
  zones?: ZonesAnalysis | null
}

/**
 * Above the field classes and below the classification, where mapLayers keeps
 * the other measurements of the ground. Imagery a run read goes under them.
 */
const ORDER_MEASURE = 370
const ORDER_IMAGERY = 340

const IMAGERY = new Set(["true-color", "ndvi", "health-ndvi", "radar-composite"])

/*
  One map per product goes on when its run is opened: the answer it was run for,
  which is the first it lists. The rest wait to be asked for. A second raster over
  the same cells would hide the one it qualifies.
*/
function shownOnOpening(assets: readonly RunAsset[]): Set<string> {
  const shown = new Set<string>()
  const first = (prefix: string) => assets.find((a) => a.id.startsWith(prefix))?.sceneId
  for (const id of [
    first("health-anomaly"),
    first("overlap-map"),
    first("radar-composite"),
    first("zones-"),
  ]) {
    if (id) shown.add(id)
  }
  return shown
}

export function withAssetLayers(
  layers: readonly RasterLayer[],
  assets: readonly RunAsset[],
  state: Readonly<Record<string, LayerPatch>> = {}
): RasterLayer[] {
  const listed = new Set(layers.map((l) => l.id))
  const shown = shownOnOpening(assets)
  const extra: RasterLayer[] = []
  for (const a of assets) {
    // A composition of the gallery is chosen in the Compositions panel.
    if (listed.has(a.sceneId) || a.selectId || !a.extent) continue
    extra.push({
      id: a.sceneId,
      title: a.title,
      uri: a.previewUri,
      extent: a.extent,
      opacity: state[a.sceneId]?.opacity ?? 1,
      order: IMAGERY.has(a.id) ? ORDER_IMAGERY : ORDER_MEASURE,
      pixelated: a.pixelated,
      smooth: false,
      visible: state[a.sceneId]?.visible ?? shown.has(a.sceneId),
    })
  }
  return [...layers, ...extra].sort((a, b) => a.order - b.order)
}

/** The product a queued run measured, or null where it holds none of them. */
export function jobReadingOf(
  runId: string,
  label: string,
  r: {
    health?: HealthAnalysis | null
    overlap?: OverlapAnalysis | null
    radar?: RadarAnalysis | null
    zones?: ZonesAnalysis | null
  } | null
): JobReading | null {
  if (!r || !(r.health || r.overlap || r.radar || r.zones)) return null
  return {
    runId,
    label,
    health: r.health,
    overlap: r.overlap,
    radar: r.radar,
    zones: r.zones,
  }
}
