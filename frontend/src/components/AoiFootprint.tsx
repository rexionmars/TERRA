import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { geometryBounds, polygonParts } from "@/lib/geometry"
import type { GeoJSONGeometry } from "@/lib/types"

/**
 * Outline of an AOI as inline SVG.
 *
 * A catalogue entry is recognised by its shape, so the browse grid draws the
 * actual boundary rather than a type icon. Inline SVG keeps this offline and
 * free of tile requests, which matters because the hub renders one per project.
 *
 * Longitude is scaled by cos(latitude) so parcels are not stretched east-west
 * at Brazilian latitudes. Every part of a MultiPolygon is drawn, and interior
 * rings are cut out with the even-odd fill rule.
 *
 * The outline is normalised to its own bounds, so it carries shape but not
 * scale; pair it with an area figure wherever size matters.
 */
export function AoiFootprint({
  geometry,
  className,
  title,
}: {
  geometry: GeoJSONGeometry | null | undefined
  className?: string
  title?: string
}) {
  const path = useMemo(() => {
    if (!geometry) return null
    const bounds = geometryBounds(geometry)
    if (!bounds) return null
    const midLat = (bounds.latMin + bounds.latMax) / 2
    const kx = Math.cos((midLat * Math.PI) / 180) || 1

    // Work in metres-proportional units before normalising, so the aspect
    // ratio reflects ground distance rather than degrees.
    const x0 = bounds.lonMin * kx
    const x1 = bounds.lonMax * kx
    const spanX = Math.max(x1 - x0, 1e-9)
    const spanY = Math.max(bounds.latMax - bounds.latMin, 1e-9)
    const span = Math.max(spanX, spanY)

    // Centre the shorter axis inside a square viewBox.
    const padX = (span - spanX) / 2
    const padY = (span - spanY) / 2

    const project = ([lon, lat]: [number, number]): [number, number] => [
      ((lon * kx - x0 + padX) / span) * 100,
      // SVG y grows downward; latitude grows north.
      100 - ((lat - bounds.latMin + padY) / span) * 100,
    ]

    const segments: string[] = []
    for (const part of polygonParts(geometry)) {
      for (const ring of part) {
        if (!ring || ring.length < 3) continue
        const pts = ring.map(project)
        segments.push(
          `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`
        )
      }
    }
    return segments.length ? segments.join(" ") : null
  }, [geometry])

  if (!path) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-[9px] text-muted-foreground",
          className
        )}
      >
        <span
          className="flex h-10 w-14 items-center justify-center rounded-sm border border-dashed"
          style={{ borderColor: "var(--border)" }}
        >
          No AOI
        </span>
      </div>
    )
  }

  return (
    <svg
      viewBox="-4 -4 108 108"
      className={className}
      role="img"
      aria-label={title ?? "Area of interest outline"}
      preserveAspectRatio="xMidYMid meet"
    >
      {title ? <title>{title}</title> : null}
      <path
        d={path}
        fillRule="evenodd"
        fill="rgb(var(--p-accent) / 0.18)"
        stroke="rgb(var(--p-accent) / 0.85)"
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
