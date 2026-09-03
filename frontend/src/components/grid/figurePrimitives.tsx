/**
 * The marks a ported research figure is drawn from.
 *
 * WHY NOT RECHARTS. Two defaults this series cannot have, both recorded in
 * SpectraEditor.tsx when the same choice was made for the spectral figure: a
 * plot that stretches while its type does not, so the figure has no
 * proportions of its own; and a tick layout that drops a colliding label
 * silently, so a panel of seven measurements draws six.
 *
 * WHY NOT THE PUBLISHED PNG. The series is 183 mm at 7 pt. lib/figure.ts
 * measures what that becomes on a screen -- about 7.3 px in a 540 px panel,
 * under the 9 px floor this interface holds in twenty-one places -- and says
 * the discipline is borrowed while the measurements are not.
 *
 * So: lib/figure.ts holds the coordinate system, and everything here is marks
 * placed in it, at the interface's own type scale.
 */
import { useMemo } from "react"

import {
  STROKE,
  TYPE,
  layoutFigure,
  linearScale,
  niceTicks,
} from "@/lib/figure"

export interface Series {
  id: string
  label: string
  color: string
  /** [x, y] in data space. A null y breaks the line rather than joining across. */
  points: [number, number | null][]
}

function path(
  points: [number, number | null][],
  sx: (v: number) => number,
  sy: (v: number) => number
): string {
  let out = ""
  let pen = false
  for (const [x, y] of points) {
    if (y === null || !Number.isFinite(y)) {
      pen = false
      continue
    }
    out += `${pen ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`
    pen = true
  }
  return out
}

/**
 * A line or area figure over a numeric x.
 *
 * `stack` fills between consecutive series rather than to zero, which is how
 * the diurnal panel says that the cut sits ON TOP of what was generated: the
 * upper bound is what the plant could have delivered, and the gap between the
 * two IS the loss. Drawn as two independent areas the same numbers read as two
 * unrelated quantities that happen to share an axis.
 */
export function LineFigure({
  width,
  series,
  yFormat,
  xFormat,
  xTitle,
  yTitle,
  stack = false,
  height,
}: {
  width: number
  series: Series[]
  yFormat: (v: number) => string
  xFormat: (v: number) => string
  xTitle?: string
  yTitle?: string
  stack?: boolean
  height?: number
}) {
  const geom = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map(([x]) => x))
    const ys = series.flatMap((s) =>
      s.points.map(([, y]) => y).filter((y): y is number => y !== null)
    )
    if (!xs.length || !ys.length) return null

    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    // Stacked, the top of the drawing is the sum and not the largest series.
    const yTop = stack
      ? Math.max(
          ...series[0].points.map(([, y], i) =>
            series.reduce(
              (sum, s) => sum + (s.points[i]?.[1] ?? 0),
              0 - (series[0].points[i]?.[1] ?? 0) + (y ?? 0)
            )
          )
        )
      : Math.max(...ys)
    const ticks = niceTicks(0, yTop, 4)
    const layout = layoutFigure({
      width,
      plotHeight: height,
      yLabels: ticks.map(yFormat),
      xTitle: !!xTitle,
      yTitle: !!yTitle,
      lastXLabel: xFormat(xMax),
      legendRows: series.length > 1 ? 1 : 0,
    })
    const sx = linearScale([xMin, xMax], [layout.plot.x0, layout.plot.x1])
    const sy = linearScale(
      [0, ticks[ticks.length - 1]],
      [layout.plot.y1, layout.plot.y0]
    )
    return { layout, sx, sy, ticks, xMin, xMax }
  }, [width, series, yFormat, xFormat, xTitle, yTitle, stack, height])

  if (!geom) return null
  const { layout, sx, sy, ticks, xMin, xMax } = geom
  const xTicks = niceTicks(xMin, xMax, 5).filter((t) => t >= xMin && t <= xMax)

  // Running totals, so a stacked band sits on the one below it.
  const bases = series.map((_, i) =>
    series[0].points.map((_, j) =>
      series.slice(0, i).reduce((sum, s) => sum + (s.points[j]?.[1] ?? 0), 0)
    )
  )

  return (
    <svg
      width={layout.width}
      height={layout.height}
      className="block"
      role="img"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={layout.plot.x0}
            x2={layout.plot.x1}
            y1={sy(t)}
            y2={sy(t)}
            stroke="rgb(var(--p-line))"
            strokeOpacity={t === 0 ? 0.5 : 0.18}
            strokeWidth={STROKE.rule}
          />
          <text
            x={layout.plot.x0 - 6}
            y={sy(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={TYPE.micro}
            fill="rgb(var(--p-muted-foreground))"
          >
            {yFormat(t)}
          </text>
        </g>
      ))}

      {xTicks.map((t) => (
        <text
          key={t}
          x={sx(t)}
          y={layout.plot.y1 + 12}
          textAnchor="middle"
          fontSize={TYPE.micro}
          fill="rgb(var(--p-muted-foreground))"
        >
          {xFormat(t)}
        </text>
      ))}

      {series.map((s, i) =>
        stack ? (
          <path
            key={s.id}
            d={
              path(
                s.points.map(([x, y], j) => [x, (y ?? 0) + bases[i][j]]),
                sx,
                sy
              ) +
              path(
                [...s.points].reverse().map(([x], j) => {
                  const k = s.points.length - 1 - j
                  return [x, bases[i][k]]
                }),
                sx,
                sy
              ).replace(/^M/, "L") +
              "Z"
            }
            fill={s.color}
            fillOpacity={0.55}
            stroke="none"
          />
        ) : (
          <path
            key={s.id}
            d={path(s.points, sx, sy)}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE.series}
            strokeLinejoin="round"
          />
        )
      )}

      {series.length > 1 &&
        series.map((s, i) => (
          <g key={s.id}>
            <rect
              x={layout.plot.x0 + i * 92}
              y={layout.legendTop}
              width={8}
              height={8}
              fill={s.color}
              fillOpacity={stack ? 0.55 : 1}
            />
            <text
              x={layout.plot.x0 + i * 92 + 12}
              y={layout.legendTop + 7}
              fontSize={TYPE.micro}
              fill="rgb(var(--p-muted-foreground))"
            >
              {s.label}
            </text>
          </g>
        ))}

      {xTitle && (
        <text
          x={(layout.plot.x0 + layout.plot.x1) / 2}
          y={layout.plot.y1 + 26}
          textAnchor="middle"
          fontSize={TYPE.micro}
          fill="rgb(var(--p-muted-foreground))"
        >
          {xTitle}
        </text>
      )}
    </svg>
  )
}

/**
 * Points placed at their coordinates, with the aspect the ground has.
 *
 * NO BASEMAP, AND IT IS NOT A PLACEHOLDER. The published panel draws IBGE state
 * rings behind these points, which are context and not the measurement; the
 * measurement is where the plants are and how much each loses. Adding an
 * outline would mean shipping a boundary file the store does not hold, to make
 * a figure that already says what it says slightly easier to place.
 */
export function ScatterMap({
  width,
  points,
  colorOf,
  height = 260,
}: {
  width: number
  points: { lon: number; lat: number; size: number; value: number }[]
  colorOf: (v: number) => string
  height?: number
}) {
  const geom = useMemo(() => {
    if (!points.length) return null
    const lons = points.map((p) => p.lon)
    const lats = points.map((p) => p.lat)
    const pad = 1.0
    const x0 = Math.min(...lons) - pad
    const x1 = Math.max(...lons) + pad
    const y0 = Math.min(...lats) - pad
    const y1 = Math.max(...lats) + pad
    // Equal aspect: a degree of longitude and a degree of latitude get the
    // same pixels, so the shape of the country is not stretched by the panel.
    const span = Math.max(x1 - x0, y1 - y0)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const side = Math.min(width, height)
    const sx = linearScale([cx - span / 2, cx + span / 2], [0, side])
    const sy = linearScale([cy - span / 2, cy + span / 2], [side, 0])
    return { sx, sy, side }
  }, [points, width, height])

  if (!geom) return null
  return (
    <svg width={geom.side} height={geom.side} className="block" role="img">
      {points.map((p, i) => (
        <circle
          key={i}
          cx={geom.sx(p.lon)}
          cy={geom.sy(p.lat)}
          r={2 + Math.sqrt(Math.max(p.size, 0)) / 3}
          fill={colorOf(p.value)}
          fillOpacity={0.85}
          stroke="rgb(var(--p-background))"
          strokeWidth={0.4}
        />
      ))}
    </svg>
  )
}
