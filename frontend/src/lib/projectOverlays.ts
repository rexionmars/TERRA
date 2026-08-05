import type {
  CompositionOverlay,
  CompositeIndex,
  CompositeKind,
  ProjectOverlay,
} from "@/lib/types"

type OverlayMeta = {
  description?: string
  kind?: CompositeKind
  bands?: [string, string, string]
  index?: CompositeIndex
  presetId?: string
  sceneDate?: string
  opacity?: number
  extent?: CompositionOverlay["extent"]
  label?: string
}

/**
 * Identifying caption for a saved composition: the acquisition date and what
 * was rendered from it. A composition is identified by its scene date and band
 * triplet (or index), not by its nickname, so a browse grid that shows only the
 * title cannot distinguish two compositions of the same field.
 *
 * Returns an empty string when the overlay carries no usable metadata, which
 * happens for rows written before meta_json existed.
 */
export function compositionCaption(raw?: string): string {
  const meta = parseOverlayMeta(raw)
  const what =
    meta.kind === "index"
      ? meta.index?.toUpperCase()
      : meta.bands?.length === 3
        ? meta.bands.join("-")
        : undefined
  return [meta.sceneDate, what].filter(Boolean).join(" · ")
}

export function parseOverlayMeta(raw?: string): OverlayMeta {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as OverlayMeta
  } catch {
    return {}
  }
}

/** Map a persisted project overlay into the session CompositionOverlay shape. */
export function projectOverlayToComposition(
  o: ProjectOverlay
): CompositionOverlay | null {
  if (!o.overlay_uri) return null
  const meta = parseOverlayMeta(o.meta_json)
  const extent = meta.extent ?? {
    lon_min: 0,
    lat_min: 0,
    lon_max: 0,
    lat_max: 0,
  }
  return {
    id: o.id,
    overlay_uri: o.overlay_uri,
    extent,
    opacity: meta.opacity ?? 0.85,
    label: meta.label || o.title,
    title: o.title,
    description: meta.description,
    kind: meta.kind,
    bands: meta.bands,
    index: meta.index,
    presetId: meta.presetId,
    sceneDate: meta.sceneDate,
    raster_tif: o.raster_tif,
  }
}
