import type {
  Bounds,
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
    runId: o.run_id || undefined,
  }
}

/** Do two geographic boxes overlap at all? */
function boxesIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.lon_max < b.lon_min ||
    b.lon_max < a.lon_min ||
    a.lat_max < b.lat_min ||
    b.lat_max < a.lat_min
  )
}

/**
 * The compositions that belong with what is on screen.
 *
 * Compositions were scoped to the project alone, and a project spans fields: a
 * real one here held 13 compositions across three locations up to 100 km
 * apart, every one of them listed whichever run was open. Applying one put a
 * raster off the edge of the area being looked at.
 *
 * Three cases, and the third is why an extent test survives alongside the run
 * association:
 *
 *   - made under this run          -> shown
 *   - made under a different run   -> hidden, it belongs to that one
 *   - made under no run at all     -> shown when it covers the area in view
 *
 * The last case is not a leftover. A composition needs no classification --
 * browsing scenes produces one -- so it belongs to the project rather than to
 * any run, and the only thing that says whether it belongs *here* is where it
 * is. Every row written before the association existed is in that case too.
 *
 * With no run open, the run test has nothing to compare against and the extent
 * carries the whole decision.
 */
export function scopeCompositionsToView(
  gallery: CompositionOverlay[],
  runId: string | null,
  view: Bounds | null
): CompositionOverlay[] {
  return gallery.filter((c) => {
    if (c.runId) return c.runId === runId
    if (!view) return true
    // A composition saved before extents were recorded reads as the zero box.
    // Excluding it on that basis would hide it everywhere, so it is kept.
    const e = c.extent
    if (!e || (!e.lon_min && !e.lon_max && !e.lat_min && !e.lat_max)) return true
    return boxesIntersect(e, view)
  })
}
