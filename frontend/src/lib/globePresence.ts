/**
 * Whether a plane's raster is on the globe, whichever way it got there.
 *
 * Two things put a raster on the globe: the outliner's "Show on the globe",
 * which sends a PLANE, and a compositor Globe node, which sends whatever
 * reaches its layers. When that is a run's raster passed through Viewers alone
 * it is the plane's raster exactly, and counting the two apart had the
 * outliner say the plane was not on the globe while it was -- so "Show on the
 * globe" drew a second copy over the first.
 *
 * The rule here: a plane is on the globe when it was sent, or when a visible
 * compositor layer draws it unchanged; toggling it acts on whichever of the
 * two is drawing it, and sends the plane itself only where nothing is.
 */

/** A compositor layer, as far as this question needs one. */
export interface CompositorLayerRef {
  key: string
  /** The plane key of the run raster it draws unchanged, or null. */
  sourceKey: string | null
}

/** The compositor layers that draw each plane unchanged, by plane key. */
export function layersBySource(layers: readonly CompositorLayerRef[]): Map<string, string[]> {
  const bySource = new Map<string, string[]>()
  for (const l of layers) {
    if (!l.sourceKey) continue
    bySource.set(l.sourceKey, [...(bySource.get(l.sourceKey) ?? []), l.key])
  }
  return bySource
}

/** Every plane key that is on the globe: sent, or drawn by a visible compositor layer. */
export function planesOnGlobe(
  sent: ReadonlySet<string>,
  bySource: ReadonlyMap<string, readonly string[]>,
  hidden: ReadonlySet<string>
): Set<string> {
  const on = new Set(sent)
  for (const [plane, layers] of bySource) {
    if (layers.some((k) => !hidden.has(k))) on.add(plane)
  }
  return on
}

/** What toggling one plane on the globe changes. */
export interface GlobeToggle {
  /** Whether the plane key is added to the sent set, taken out of it, or left. */
  sent: "add" | "remove" | "keep"
  /** Compositor layer keys to hide, and to show again. */
  hide: string[]
  show: string[]
}

export function toggleOnGlobe(
  plane: string,
  onGlobe: ReadonlySet<string>,
  bySource: ReadonlyMap<string, readonly string[]>
): GlobeToggle {
  const via = [...(bySource.get(plane) ?? [])]
  if (onGlobe.has(plane)) return { sent: "remove", hide: via, show: [] }
  if (via.length) return { sent: "keep", hide: [], show: via }
  return { sent: "add", hide: [], show: [] }
}

/**
 * Whether a sent plane is drawn by the compositor already, in which case it is
 * drawn once, as the compositor's layer.
 */
export function drawnByCompositor(
  plane: string,
  bySource: ReadonlyMap<string, readonly string[]>,
  hidden: ReadonlySet<string>
): boolean {
  return (bySource.get(plane) ?? []).some((k) => !hidden.has(k))
}
