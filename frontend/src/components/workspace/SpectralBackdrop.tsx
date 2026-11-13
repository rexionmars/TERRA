import { useId } from "react"

import { TYPE, measureText } from "@/lib/figure"
import { ATMOSPHERIC_ABSORPTION, S2_BANDS, SPECTRAL_REGIONS } from "@/lib/s2Spectral"

/*
  WHAT LIES BEHIND A SPECTRUM, drawn under it: the regions of the axis and what
  governs reflectance in each, the two stretches where the atmosphere absorbs
  and nothing is measured, and the width each band integrates over. Under the
  data and in the faintest marks the figure has, so a curve reads first and
  this second.
*/
export function SpectralBackdrop({
  x,
  plot,
  bands,
  activeBand,
}: {
  /** Wavelength in nm to the figure's x. */
  x: (nm: number) => number
  plot: { x0: number; x1: number; y0: number; y1: number }
  /** The bands the spectrum has, whose widths are drawn. */
  bands: readonly string[]
  /** The band the pointer is on, whose width is drawn stronger. */
  activeBand?: string | null
}) {
  const hatch = `h2o-${useId().replace(/:/g, "")}`
  const clampX = (nm: number) => Math.min(plot.x1, Math.max(plot.x0, x(nm)))
  const top = plot.y0 + 2

  return (
    <g aria-hidden>
      <defs>
        <pattern
          id={hatch}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
          />
        </pattern>
      </defs>

      {/* Each band's width, as a faint column, and stronger under the pointer. */}
      {bands.map((b) => {
        const band = S2_BANDS[b]
        if (!band) return null
        const left = clampX(band.centre - band.width / 2)
        const right = clampX(band.centre + band.width / 2)
        const on = activeBand === b
        return (
          <g key={`w-${b}`}>
            <rect
              x={left}
              y={plot.y0}
              width={Math.max(1, right - left)}
              height={plot.y1 - plot.y0}
              fill="var(--foreground)"
              fillOpacity={on ? 0.08 : 0.035}
            />
            <rect
              x={left}
              y={plot.y1 - 3}
              width={Math.max(1, right - left)}
              height={3}
              fill="var(--muted-foreground)"
              fillOpacity={on ? 0.9 : 0.45}
            />
          </g>
        )
      })}

      {/* Where water vapour absorbs: hatched, since no surface is seen through it. */}
      {ATMOSPHERIC_ABSORPTION.map((w) => {
        const left = clampX(w.from)
        const right = clampX(w.to)
        const label = "H₂O"
        const fits = right - left > measureText(label, TYPE.micro) + 4
        return (
          <g key={`a-${w.from}`}>
            <rect
              x={left}
              y={plot.y0}
              width={Math.max(0, right - left)}
              height={plot.y1 - plot.y0}
              fill={`url(#${hatch})`}
              opacity={0.18}
            />
            {fits && (
              <text
                x={(left + right) / 2}
                y={top + 22}
                fontSize={TYPE.micro}
                fill="var(--muted-foreground)"
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}

      {/* The regions: a rule at each boundary and the name along the top. */}
      {SPECTRAL_REGIONS.map((r, i) => {
        const left = clampX(r.from)
        const right = clampX(r.to)
        const room = right - left
        const name = measureText(r.label, TYPE.micro) + 8 <= room ? r.label : r.short
        const fits = measureText(name, TYPE.micro) + 6 <= room
        return (
          <g key={`r-${r.from}`}>
            {i > 0 && (
              <line
                x1={left}
                x2={left}
                y1={plot.y0}
                y2={plot.y1}
                stroke="var(--hairline)"
                strokeWidth={1}
              />
            )}
            {fits && (
              <text
                x={left + 4}
                y={top}
                fontSize={TYPE.micro}
                fill="var(--muted-foreground)"
                dominantBaseline="hanging"
              >
                {name}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
