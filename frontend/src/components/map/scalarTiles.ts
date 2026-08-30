/**
 * Serving a run's scalar raster as terrain tiles, so a palette can be a paint
 * property instead of a decision baked into a PNG.
 *
 * WHAT THIS BUYS. A coloured overlay is finished: its palette, its thresholds
 * and which classes are drawn were decided by whoever wrote the image, and
 * changing any of them means running the analysis again. MapLibre has no
 * `raster-color` -- a raster layer's paint properties are opacity, brightness,
 * contrast, saturation and hue-rotate, and none of them is a palette lookup --
 * so a coloured image cannot be recoloured on the GPU.
 *
 * A `color-relief` layer can. Its `color-relief-color` is an EXPRESSION over
 * the value in a `raster-dem` source, which is exactly a palette lookup on a
 * scalar field. The layer is named for elevation and this is not elevation;
 * that reuse is deliberate and is the point. `raster-dem` also takes
 * `encoding: "custom"` with red/green/blue factors and a base shift, so the
 * scalar is whatever we pack, decoded by whatever factors we declare.
 *
 * WHAT IT COSTS. A `raster-dem` source reads TILES on the Web Mercator grid,
 * and a run's product is one image over one area. `addProtocol` closes that
 * gap without a server: MapLibre asks this module for {z}/{x}/{y}, and it
 * resamples the area's raster into that tile.
 *
 * THE RESAMPLING IS THE HONEST PART. The source is treated as axis-aligned in
 * longitude and latitude, which is the same assumption the image overlay it
 * replaces already makes -- `extent_from_profile` reports lon/lat bounds and
 * the overlay is placed on them. Mercator's y is not linear in latitude, so a
 * row of the tile is not a row of the source; the mapping is computed per row
 * rather than per pixel, which is exact for this projection and costs 256
 * arctangents instead of 65536.
 */
import { addProtocol } from "maplibre-gl"

import type { Bounds } from "@/lib/types"

export const SCALAR_PROTOCOL = "terra-scalar"

/**
 * A discrete palette as `color-relief-color` accepts one.
 *
 * `step` DOES NOT RENDER in this property, and fails silently: the layer
 * exists, the source loads, tiles are served, and nothing is painted. MapLibre
 * builds a colour ramp texture from the expression's stops and evidently walks
 * it as an interpolation, so the stops have to be interpolation stops.
 *
 * A flat band per value is therefore written as a pair -- the colour at
 * `k - epsilon` and again at `k` -- which makes each segment constant and the
 * boundary between two values a step rather than a blend. For a count or a
 * class index that is the only correct reading: a colour halfway between two
 * classes names neither.
 */
export function discretePalette(
  colours: readonly string[],
  transparentBelow = 1
): unknown[] {
  const out: unknown[] = ["interpolate", ["linear"], ["elevation"]]
  out.push(0, "rgba(0,0,0,0)")
  out.push(transparentBelow - 0.01, "rgba(0,0,0,0)")
  colours.forEach((colour, i) => {
    const value = transparentBelow + i
    out.push(value, colour)
    if (i < colours.length - 1) out.push(value + 0.99, colour)
  })
  return out
}

/** Registered rasters, by the id their tile URLs name. */
const registry = new Map<string, { image: ImageBitmap; bounds: Bounds }>()

/**
 * The value the decoder returns for a cell the raster does not cover.
 *
 * 0 rather than a sentinel, because the products this carries all treat 0 as
 * "nothing here" -- no product calls the cell flooded, no water, no class --
 * and every palette below already has to paint 0 as nothing. A separate
 * sentinel would be a second rule saying the same thing.
 */
const OUTSIDE = 0

/**
 * Positional base-256: red is the integer part, green and blue are its 256ths
 * and 65536ths. A product of small integers writes the value into red and
 * leaves the other two at zero, and reads back exactly.
 *
 * THE OTHER TWO FACTORS CANNOT BE ZERO, and that is not a style choice. The
 * expression's own stops are packed into RGB with these same factors before
 * they reach the shader, through
 *
 *     minScale = Math.min(redFactor, greenFactor, blueFactor)
 *     vScaled  = Math.round((v + baseShift) / minScale)
 *
 * so a zero factor makes minScale zero, every stop packs to NaN, and every
 * pixel falls into the last segment of the ramp. Measured, not reasoned about:
 * with red alone the tiles carried values 0 to 4 and the whole area painted
 * the colour of 4.
 *
 * The fraction channels also make the encoding usable by a continuous product
 * later -- a confidence in [0,1] has somewhere to go -- without a second
 * scheme beside this one.
 */
export const SCALAR_ENCODING = {
  encoding: "custom" as const,
  redFactor: 1,
  greenFactor: 1 / 256,
  blueFactor: 1 / 65536,
  baseShift: 0,
}

/** Web Mercator y to latitude, in degrees. */
function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Registers a raster and returns the tile URL template to point a source at. */
export async function registerScalarRaster(
  id: string,
  url: string,
  bounds: Bounds
): Promise<string> {
  const response = await fetch(url)
  const blob = await response.blob()
  const image = await createImageBitmap(blob)
  registry.get(id)?.image.close()
  registry.set(id, { image, bounds })
  return `${SCALAR_PROTOCOL}://${id}/{z}/{x}/{y}`
}

/** Releases a raster's decoded image. */
export function unregisterScalarRaster(id: string): void {
  registry.get(id)?.image.close()
  registry.delete(id)
}

let installed = false

/**
 * Installs the protocol. Idempotent, and called before any map is built:
 * `addProtocol` is global to MapLibre, not per map.
 */
export function installScalarProtocol(): void {
  if (installed) return
  installed = true

  addProtocol(SCALAR_PROTOCOL, async (params) => {
    // terra-scalar://<id>/<z>/<x>/<y>
    const rest = params.url.slice(`${SCALAR_PROTOCOL}://`.length)
    const parts = rest.split("/")
    const id = parts[0]
    const z = Number(parts[1])
    const x = Number(parts[2])
    const y = Number(parts[3])
    const entry = registry.get(id)
    if (!entry || !Number.isFinite(z)) {
      throw new Error(`no scalar raster registered as ${id}`)
    }

    const size = 256
    const out = new Uint8ClampedArray(size * size * 4)

    // The source, read once into a buffer we can index.
    const src = readSource(entry.image)
    const { bounds } = entry
    const lonSpan = bounds.lon_max - bounds.lon_min
    const latSpan = bounds.lat_max - bounds.lat_min

    /*
      Per row and per column rather than per pixel. Longitude is linear in the
      tile's x, latitude is not linear in its y, and both are constant along
      their own axis -- so this is 512 computations for a tile instead of
      65536, and identical output.
    */
    const cols = new Int32Array(size)
    for (let px = 0; px < size; px++) {
      const lon = ((x + (px + 0.5) / size) / Math.pow(2, z)) * 360 - 180
      cols[px] =
        lonSpan > 0
          ? Math.floor(((lon - bounds.lon_min) / lonSpan) * src.width)
          : -1
    }
    const rows = new Int32Array(size)
    for (let py = 0; py < size; py++) {
      const lat = tileYToLat(y + (py + 0.5) / size, z)
      rows[py] =
        latSpan > 0
          ? // The image's first row is the north edge, so latitude runs down it.
            Math.floor(((bounds.lat_max - lat) / latSpan) * src.height)
          : -1
    }

    for (let py = 0; py < size; py++) {
      const sy = rows[py]
      const rowInside = sy >= 0 && sy < src.height
      for (let px = 0; px < size; px++) {
        const sx = cols[px]
        const o = (py * size + px) * 4
        let value = OUTSIDE
        if (rowInside && sx >= 0 && sx < src.width) {
          const s = (sy * src.width + sx) * 4
          // Transparent in the source means the run did not cover the cell,
          // which is not the same as a value of zero being measured there --
          // but both are drawn as nothing, so they collapse here.
          value = src.data[s + 3] === 0 ? OUTSIDE : src.data[s]
        }
        out[o] = value
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 255
      }
    }

    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d context for a scalar tile")
    ctx.putImageData(new ImageData(out, size, size), 0, 0)
    const png = await canvas.convertToBlob({ type: "image/png" })
    return { data: await png.arrayBuffer() }
  })
}

/** The decoded source pixels, cached per image so a pan re-reads nothing. */
const pixels = new WeakMap<
  ImageBitmap,
  { data: Uint8ClampedArray; width: number; height: number }
>()

function readSource(image: ImageBitmap) {
  const hit = pixels.get(image)
  if (hit) return hit
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("no 2d context for a scalar raster")
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  const entry = { data, width: image.width, height: image.height }
  pixels.set(image, entry)
  return entry
}
