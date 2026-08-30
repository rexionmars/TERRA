/**
 * Cuts an overlay image at a meridian, leaving the east half.
 *
 * WHY THE CUT IS IN THE IMAGE AND NOT ON THE SCREEN. Leaflet clipped each
 * ImageOverlay's DOM element with `clip-path: inset(...)`, measured in screen
 * pixels against the map container. MapLibre draws its layers into one canvas
 * and has no clip: its layer list carries no `clip` type, and paint properties
 * cannot vary with screen position.
 *
 * Two maps stacked with the top one CSS-clipped is the usual answer and does
 * not fit here. The AOI outline has to sit ABOVE the rasters and be visible
 * across the whole map; on the clipped map it would be cut with them, and on
 * the unclipped one it would be buried under them. There is no third place for
 * it.
 *
 * So the cut moves into the raster. That makes it FIXED TO THE GROUND rather
 * than to the viewport: pan, and the seam stays on the same feature instead of
 * staying under the handle. For comparing a prediction against the imagery
 * beneath it that is the more useful of the two, and it costs one canvas pass
 * per drag of the handle rather than one per frame of every pan.
 */
import type { Bounds } from "@/lib/types"

const cache = new Map<string, string>()

/**
 * `url` with everything west of `cutLon` made transparent.
 *
 * Returns the original url when the cut falls outside the image, and null when
 * the cut covers all of it -- the caller drops the layer rather than drawing a
 * fully transparent raster.
 */
export async function cropWestOf(
  url: string,
  bounds: Bounds,
  cutLon: number
): Promise<string | null> {
  const span = bounds.lon_max - bounds.lon_min
  if (span <= 0) return url
  if (cutLon <= bounds.lon_min) return url
  if (cutLon >= bounds.lon_max) return null

  const fraction = (cutLon - bounds.lon_min) / span
  // Quantised, so a slow drag does not produce a new canvas per sub-pixel and
  // a new cache entry with it.
  const key = `${url.length}:${url.slice(-64)}:${fraction.toFixed(4)}`
  const hit = cache.get(key)
  if (hit) return hit

  const img = await loadImage(url)
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return url
  ctx.drawImage(img, 0, 0)
  // clearRect rather than a composite: the west half must show the basemap
  // through it, so it has to become transparent and not any colour.
  ctx.clearRect(0, 0, Math.round(fraction * canvas.width), canvas.height)
  const out = canvas.toDataURL("image/png")

  // Bounded, because these are whole PNGs and a drag produces one per step.
  if (cache.size > 24) cache.clear()
  cache.set(key, out)
  return out
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Data URIs are same-origin, and the run rasters are data URIs; this is
    // for the case where one is ever served over http.
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("overlay image did not load"))
    img.src = url
  })
}
