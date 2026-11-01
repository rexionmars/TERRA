/**
 * Turns a change to one row of a layer list back into the state it came from.
 *
 * The table in lib/mapLayers.ts describes what exists; the switches that govern
 * it live with the surface, one per product. Routing through this rather than
 * giving each layer its own callback keeps that table free of behaviour.
 *
 * Prediction and confidence share one opacity, so moving either moves both. The
 * map's own panel had one slider for the pair, and the state still does.
 */
import { isFieldLayer } from "@/lib/fields"
import { isMineralLayer } from "@/lib/mineral"

export interface LayerPatch {
  visible?: boolean
  opacity?: number
}

export interface LayerSwitches {
  setCompositionVisible: (v: boolean) => void
  setCompositionOpacity: (v: number) => void
  setWaterVisible: (v: boolean) => void
  setWaterOpacity: (v: number) => void
  setConfidenceVisible: (v: boolean) => void
  setPredictionVisible: (v: boolean) => void
  /** The opacity prediction and confidence share. */
  setOverlayOpacity: (v: number) => void
  patchFieldLayer: (id: string, patch: LayerPatch) => void
  patchMineralLayer: (id: string, patch: LayerPatch) => void
  /** Any other raster of a run, where the surface draws those at all. */
  patchAssetLayer?: (id: string, patch: LayerPatch) => void
}

export function applyLayerPatch(id: string, patch: LayerPatch, to: LayerSwitches): void {
  const send = (visible: (v: boolean) => void, opacity: (v: number) => void) => {
    if (patch.visible !== undefined) visible(patch.visible)
    if (patch.opacity !== undefined) opacity(patch.opacity)
  }
  if (id === "composition") send(to.setCompositionVisible, to.setCompositionOpacity)
  else if (id === "water") send(to.setWaterVisible, to.setWaterOpacity)
  else if (isFieldLayer(id)) to.patchFieldLayer(id, patch)
  else if (isMineralLayer(id)) to.patchMineralLayer(id, patch)
  else if (id === "confidence") send(to.setConfidenceVisible, to.setOverlayOpacity)
  else if (id === "prediction") send(to.setPredictionVisible, to.setOverlayOpacity)
  else to.patchAssetLayer?.(id, patch)
}

/** One entry per layer, merged so a patch naming only the opacity leaves the switch alone. */
export function mergeLayerPatch(
  held: Record<string, LayerPatch>,
  id: string,
  patch: LayerPatch
): Record<string, LayerPatch> {
  return {
    ...held,
    [id]: {
      ...held[id],
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
      ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    },
  }
}
