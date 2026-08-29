/**
 * The georeferenced rasters a run puts on the map, reconciled into MapLibre.
 *
 * ONE ORDERED LIST, NOT SIX COMPONENTS. Under Leaflet each raster was an
 * ImageOverlay with a z-index, and the numbers -- 350, 358, 360, 365, 400, 450
 * -- were the whole ordering rule, spread across six call sites. MapLibre draws
 * layers in style order instead, so the order IS the list, and the caller's
 * array is the answer to which raster sits on which.
 *
 * ADDED AND REMOVED ONLY WHEN THE SET CHANGES. An image source re-fetches its
 * image when it is created, so rebuilding the stack on every opacity change
 * would flash every raster on the map each time a slider moved.
 */
import type { Map as MapLibreMap, ImageSource } from "maplibre-gl"

import type { Bounds } from "@/lib/types"

export interface OverlaySpec {
  /** Stable across renders: it is what decides update-in-place versus rebuild. */
  id: string
  url: string
  bounds: Bounds
  opacity: number
}

/** The four corners an image source takes, clockwise from the top left. */
export function extentCorners(
  b: Bounds
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [b.lon_min, b.lat_max],
    [b.lon_max, b.lat_max],
    [b.lon_max, b.lat_min],
    [b.lon_min, b.lat_min],
  ]
}

const SOURCE = (id: string) => `ov-src-${id}`
const LAYER = (id: string) => `ov-${id}`

/**
 * Brings the map's overlay stack to `specs`, in order, under `beforeId`.
 *
 * Returns the ids now present, which the caller keeps to decide next time
 * whether the set changed.
 */
export function syncOverlays(
  map: MapLibreMap,
  specs: readonly OverlaySpec[],
  previous: readonly string[],
  beforeId: string | undefined
): string[] {
  const ids = specs.map((s) => s.id)
  const sameSet =
    ids.length === previous.length && ids.every((id, i) => id === previous[i])

  if (!sameSet) {
    for (const id of previous) {
      if (map.getLayer(LAYER(id))) map.removeLayer(LAYER(id))
      if (map.getSource(SOURCE(id))) map.removeSource(SOURCE(id))
    }
    for (const spec of specs) {
      map.addSource(SOURCE(spec.id), {
        type: "image",
        url: spec.url,
        coordinates: extentCorners(spec.bounds),
      })
      map.addLayer(
        {
          id: LAYER(spec.id),
          type: "raster",
          source: SOURCE(spec.id),
          paint: {
            "raster-opacity": spec.opacity,
            /*
              Nearest, always, and this replaces a CSS class and a `load`
              handler that re-applied it. MapView's note: "Always
              nearest-neighbor: colors stay solid; curves come from the raster."
              A class raster interpolated between two class colours produces a
              colour that names no class.
            */
            "raster-resampling": "nearest",
            // The default 300 ms cross-fade is written for tiles arriving at
            // different zooms. One image has nothing to fade between, and the
            // fade reads as the overlay hesitating.
            "raster-fade-duration": 0,
          },
        },
        beforeId
      )
    }
    return ids
  }

  for (const spec of specs) {
    const src = map.getSource<ImageSource>(SOURCE(spec.id))
    if (src) {
      const corners = extentCorners(spec.bounds)
      // updateImage takes both, and passing them together avoids the frame
      // where a new image is stretched over the previous extent.
      src.updateImage({ url: spec.url, coordinates: corners })
    }
    if (map.getLayer(LAYER(spec.id))) {
      map.setPaintProperty(LAYER(spec.id), "raster-opacity", spec.opacity)
    }
  }
  return ids
}

/** Removes every overlay this module put on the map. */
export function clearOverlays(map: MapLibreMap, ids: readonly string[]): void {
  for (const id of ids) {
    if (map.getLayer(LAYER(id))) map.removeLayer(LAYER(id))
    if (map.getSource(SOURCE(id))) map.removeSource(SOURCE(id))
  }
}
