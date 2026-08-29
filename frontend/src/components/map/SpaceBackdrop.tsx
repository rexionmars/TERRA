/**
 * What is behind the planet.
 *
 * The globe was drawn against `--p-ink`, the chassis colour, which made it
 * read as an object ON a panel rather than as a view THROUGH one. Space is not
 * the same surface as the interface around it, and saying so is most of what
 * this does.
 *
 * DARK IN BOTH THEMES, unlike everything else in this application. The light
 * palette is a choice about a working surface; the space behind a planet is a
 * fact about the subject. A pale field here would not read as a lit room, it
 * would read as a missing texture.
 *
 * DRAWN ONCE, into a canvas, and only when the element's size changes. The
 * alternative -- a few hundred positioned elements, or a repeating tile --
 * costs either layout or a visible period across a 1200 px viewport. The
 * positions come from a seeded generator so a resize redraws the same sky
 * rather than a new one, which would read as the stars jumping.
 *
 * FIXED, NOT TURNING WITH THE CAMERA. Real stars would move, and moving them
 * would tie this to the map's bearing and pitch for an effect a reader is not
 * looking at while they work. A still backdrop reads as depth; a moving one
 * would ask to be looked at.
 */
import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/** Deep blue rather than black: black reads as an unpainted hole. */
const SPACE = "#060a14"

/** One star per this many square pixels, which is about 150 on a full screen. */
const AREA_PER_STAR = 6000

/**
 * Deterministic from a fixed seed, so the same sky is drawn every time.
 * Math.random would give a different one on every resize.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function SpaceBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const paint = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const w = parent.clientWidth
      const h = parent.clientHeight
      if (w <= 0 || h <= 0) return
      // Capped at 2: past it the stars are sub-pixel and the buffer is four
      // times the area for nothing a reader can see.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      ctx.fillStyle = SPACE
      ctx.fillRect(0, 0, w, h)

      /*
        A faint wash toward the middle, where the planet sits. Not a glow
        around the globe -- MapLibre draws that itself, in the sky's atmosphere
        -- but the sense that the field is not uniform, which is what keeps a
        flat fill from reading as a flat fill.
      */
      const glow = ctx.createRadialGradient(
        w / 2,
        h / 2,
        0,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.62
      )
      glow.addColorStop(0, "rgba(70, 110, 170, 0.16)")
      glow.addColorStop(0.55, "rgba(40, 66, 110, 0.06)")
      glow.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      const rand = mulberry32(0x5eed)
      const count = Math.round((w * h) / AREA_PER_STAR)
      for (let i = 0; i < count; i++) {
        const x = rand() * w
        const y = rand() * h
        /*
          Cubed, so most stars are near the floor brightness and a few are
          well above it. A uniform distribution gives a field of identical
          dots, which reads as noise rather than as a sky.
        */
        const t = rand()
        const bright = t * t * t
        const radius = 0.35 + bright * 1.15
        const alpha = 0.18 + bright * 0.62
        // A cool cast on the brighter ones, which is the only colour here.
        const tint = 226 + Math.round(bright * 24)
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${tint}, ${tint}, 255, ${alpha.toFixed(3)})`
        ctx.fill()
      }
    }

    paint()
    // The element is sized by its parent, so the parent is what to watch.
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(paint)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    />
  )
}
