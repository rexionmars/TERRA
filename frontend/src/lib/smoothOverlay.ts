/**
 * Contour / isoband-style overlay smoothing.
 *
 * Desired look (ag contour maps): solid class colors, sharp edges between
 * zones, but organic curved boundaries — not pixel stair-steps and not a
 * soft RGB blend (heatmap mud).
 *
 * Pipeline: one-hot → Gaussian blur → argmax → paint solid palette color.
 * Outer AOI transparency stays binary.
 */

/**
 * Shared with lib/classMask.ts, which decodes the same rasters for a different
 * purpose. Exported rather than copied: a second decoder is a second place for
 * the WKWebView's behaviour on data URIs to be discovered.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("failed to load overlay image"))
    img.src = url
  })
}

/** One integer per colour, so a palette can be a Map rather than a scan. */
export function packRGB(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const size = radius * 2 + 1
  const k = new Float32Array(size)
  let sum = 0
  const s2 = 2 * sigma * sigma
  for (let i = 0; i < size; i++) {
    const x = i - radius
    const v = Math.exp(-(x * x) / s2)
    k[i] = v
    sum += v
  }
  for (let i = 0; i < size; i++) k[i] /= sum
  return k
}

function blurChannel(
  src: Float32Array,
  w: number,
  h: number,
  sigma: number
): Float32Array {
  const kernel = gaussianKernel(sigma)
  const radius = (kernel.length - 1) >> 1
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = 0; i < kernel.length; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i - radius))
        acc += src[row + xx] * kernel[i]
      }
      tmp[row + x] = acc
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = 0; i < kernel.length; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i - radius))
        acc += tmp[yy * w + x] * kernel[i]
      }
      out[y * w + x] = acc
    }
  }
  return out
}

/**
 * Results already computed, keyed by the source data URI.
 *
 * The transform is pure -- one image in, one image out -- and expensive: a
 * separable Gaussian over one channel per class, on the CPU, on the main
 * thread. Two surfaces now ask for the same result, the map and the
 * whiteboard, and without this the second would recompute what the first
 * already has and block the frame doing it.
 *
 * Keyed on the data URI, which IS the image: two calls with the same string
 * are the same question. Entries are held for the session; the URIs are the
 * run's own rasters and there are at most a handful.
 */
const smoothed = new Map<string, Promise<string>>()

/** Kept name for MapView import; contour-style hard class smooth. */
export async function majoritySmoothOverlay(url: string): Promise<string> {
  const hit = smoothed.get(url)
  if (hit) return hit
  // The promise is cached, not the result, so concurrent callers share one
  // computation rather than starting a second while the first is in flight.
  const run = contourSmoothOverlay(url, 1.8).catch((err) => {
    // A failure must not be remembered: the next attempt should be allowed to
    // try again rather than replaying the error for the session.
    smoothed.delete(url)
    throw err
  })
  smoothed.set(url, run)
  return run
}

/**
 * Solid isobands with curved boundaries (argmax after blur).
 */
export async function contourSmoothOverlay(
  url: string,
  sigma = 1.8
): Promise<string> {
  const img = await loadImage(url)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  // Higher res → rounder class frontiers after argmax.
  const scale = 3
  const w = srcW * scale
  const h = srcH * scale
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return url

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h)
  const d = src.data
  const n = w * h
  const blurSigma = sigma * scale

  const colorIndex = new Map<number, number>()
  const palette: { r: number; g: number; b: number; a: number }[] = []
  const mask = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (d[o + 3] < 16) continue
    mask[i] = 1
    const key = packRGB(d[o], d[o + 1], d[o + 2])
    if (!colorIndex.has(key)) {
      colorIndex.set(key, palette.length)
      palette.push({ r: d[o], g: d[o + 1], b: d[o + 2], a: d[o + 3] })
    }
  }

  if (palette.length === 0) return url

  const C = palette.length
  const channels: Float32Array[] = Array.from({ length: C }, () => new Float32Array(n))

  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    const o = i * 4
    const idx = colorIndex.get(packRGB(d[o], d[o + 1], d[o + 2]))
    if (idx === undefined) continue
    channels[idx][i] = 1
  }

  const blurred = channels.map((ch) => blurChannel(ch, w, h, blurSigma))
  const out = new Uint8ClampedArray(d.length)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (!mask[i]) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      continue
    }

    let best = 0
    let bestW = -1
    for (let c = 0; c < C; c++) {
      const wt = blurred[c][i]
      if (wt > bestW) {
        bestW = wt
        best = c
      }
    }

    const p = palette[best]
    out[o] = p.r
    out[o + 1] = p.g
    out[o + 2] = p.b
    out[o + 3] = p.a
  }

  ctx.putImageData(new ImageData(out, w, h), 0, 0)
  return canvas.toDataURL("image/png")
}
