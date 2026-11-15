/*
  A PICTURE CHOSEN FROM DISK, FITTED TO WHERE IT IS DRAWN before it goes to the
  store (internal/store/pictures.go). The store keeps it as a file and sends it
  back with the account as a data URI, so every byte sent here crosses the
  bridge again at each sign-in. A cover straight from a camera is about 4000 px
  wide and several megabytes, while the banner draws it at most about 1700 CSS
  px wide, which is 3400 px on a 2x screen. A badge is drawn 32 px tall.

  A picture already inside its box and under `keepBytes` is sent as it is. A
  small PNG keeps its exact pixels that way, and an SVG badge keeps its vectors.
*/

export interface PictureFit {
  /** The largest width and height the picture is kept at, in pixels. */
  box: { width: number; height: number }
  /** What a fitted picture is written as: JPEG for a photograph, PNG to keep a logo's transparency. */
  type: "image/jpeg" | "image/png"
  /** The media types the store accepts for this picture. */
  accept: readonly string[]
  /** What the types above are called in a message. */
  acceptLabel: string
  /** The largest file sent without fitting, in bytes; under the store's cap for it. */
  keepBytes: number
  /** The largest file read at all, in bytes. */
  maxFileBytes: number
}

/** The cover of the profile's banner. The store caps it at 4 MB. */
export const COVER_FIT: PictureFit = {
  box: { width: 3200, height: 1600 },
  type: "image/jpeg",
  accept: ["image/png", "image/jpeg", "image/webp"],
  acceptLabel: "PNG, JPEG or WebP",
  keepBytes: 1_500_000,
  maxFileBytes: 50_000_000,
}

/** The badge of an institution, set above the name. The store caps it at 2 MB. */
export const BADGE_FIT: PictureFit = {
  box: { width: 1200, height: 240 },
  type: "image/png",
  accept: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  acceptLabel: "PNG, JPEG, WebP or SVG",
  keepBytes: 500_000,
  maxFileBytes: 20_000_000,
}

/** JPEG quality for a fitted cover: no banding visible in a sky at 2x. */
const JPEG_QUALITY = 0.86

/** The size a picture is drawn at to sit inside `box` without being enlarged. */
export function fitWithin(
  width: number,
  height: number,
  box: { width: number; height: number }
): { width: number; height: number } {
  const scale = Math.min(1, box.width / width, box.height / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** Reads a picture from disk as a data URI, fitted as `fit` says. */
export async function readPicture(file: File, fit: PictureFit): Promise<string> {
  if (!fit.accept.includes(file.type)) {
    throw new Error(`That file is not a ${fit.acceptLabel} image.`)
  }
  if (file.size > fit.maxFileBytes) {
    throw new Error(
      `The file is ${megabytes(file.size)}. A file up to ${megabytes(fit.maxFileBytes)} can be read.`
    )
  }
  if (file.type === "image/svg+xml") {
    // A vector has no pixel size to fit, so only its bytes are checked.
    if (file.size > fit.keepBytes) {
      throw new Error(
        `The SVG is ${megabytes(file.size)}, over ${megabytes(fit.keepBytes)}. A PNG of it is fitted to size.`
      )
    }
    return readAsDataURL(file)
  }

  const bitmap = await createImageBitmap(file)
  try {
    const size = fitWithin(bitmap.width, bitmap.height, fit.box)
    const inside = size.width === bitmap.width && size.height === bitmap.height
    if (inside && file.size <= fit.keepBytes) return await readAsDataURL(file)

    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("The picture could not be drawn to fit it.")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    return canvas.toDataURL(
      fit.type,
      fit.type === "image/jpeg" ? JPEG_QUALITY : undefined
    )
  } finally {
    bitmap.close()
  }
}

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."))
    reader.readAsDataURL(file)
  })
}
