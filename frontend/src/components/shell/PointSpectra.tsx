import { useTheme } from "next-themes"

import type { ThemeName } from "@/lib/contrast"
import { linearScale } from "@/lib/figure"
import { chartGround, legibleOn } from "@/lib/seriesColor"
import type { ClassSpectra } from "@/lib/types"

const W = 368
const H = 196
const PAD = { top: 10, right: 92, bottom: 38, left: 42 }

const X_TICKS = [500, 1000, 1500, 2000]

/**
 * One curve per point, in the Okabe and Ito blue and orange, and with a line of
 * its own too, so the two stay apart in grey and for a reader who cannot tell the
 * hues.
 */
const STYLE = {
  A: { hue: "#56B4E9", dash: undefined, marker: "circle" },
  B: { hue: "#E69F00", dash: "5 3", marker: "square" },
} as const

/** Three to seven round steps from zero to just past the top value. */
function yTicks(max: number): number[] {
  const step = max > 0.6 ? 0.2 : max > 0.3 ? 0.1 : 0.05
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(2)))
  return out
}

export interface SpectraPoint {
  slot: "A" | "B"
  classId: number
}

/**
 * The mean reflectance of the class under each point, by band.
 *
 * Marks and not a line alone, because these are measurements at seven bands and
 * the line between them is only there to carry the eye. Direct labels at the end
 * of each curve, and the whisker's meaning is stated under the figure by the
 * caller.
 */
export function PointSpectra({
  spectra,
  points,
}: {
  spectra: ClassSpectra
  points: readonly SpectraPoint[]
}) {
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"
  const ground = chartGround(theme)

  const curves = points
    .map((p) => ({
      slot: p.slot,
      rows: spectra.points
        .filter((r) => r.class_id === p.classId)
        .sort((a, b) => a.wavelength_nm - b.wavelength_nm),
    }))
    .filter((c) => c.rows.length > 1)
  if (!curves.length) return null

  const top = Math.max(...curves.flatMap((c) => c.rows.map((r) => r.p95)))
  const ticks = yTicks(top)
  const x = linearScale([400, 2300], [PAD.left, W - PAD.right])
  const y = linearScale([0, ticks[ticks.length - 1]], [H - PAD.bottom, PAD.top])
  const axisY = H - PAD.bottom

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", fontFamily: "var(--font-sans)" }}
      role="img"
      aria-label={`Mean reflectance by wavelength of the class under ${curves.map((c) => `point ${c.slot}, ${c.rows[0].name}`).join(", and ")}`}
    >
      <path
        d={`M${PAD.left},${PAD.top} L${PAD.left},${axisY} L${W - PAD.right},${axisY}`}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={0.75}
      />
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left - 3}
            x2={PAD.left}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--muted-foreground)"
            strokeWidth={0.75}
          />
          <text
            x={PAD.left - 5}
            y={y(v)}
            fontSize={10}
            fill="var(--muted-foreground)"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {X_TICKS.map((v) => (
        <g key={v}>
          <line
            x1={x(v)}
            x2={x(v)}
            y1={axisY}
            y2={axisY + 3}
            stroke="var(--muted-foreground)"
            strokeWidth={0.75}
          />
          <text
            x={x(v)}
            y={axisY + 13}
            fontSize={10}
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {v}
          </text>
        </g>
      ))}
      <text
        x={(PAD.left + W - PAD.right) / 2}
        y={H - 8}
        fontSize={10}
        fill="var(--muted-foreground)"
        textAnchor="middle"
      >
        Wavelength (nm)
      </text>
      <text
        transform={`translate(10 ${(PAD.top + axisY) / 2}) rotate(-90)`}
        fontSize={10}
        fill="var(--muted-foreground)"
        textAnchor="middle"
      >
        Reflectance
      </text>
      {curves.map((c) => {
        const style = STYLE[c.slot]
        const ink = legibleOn(style.hue, ground, 3)
        const last = c.rows[c.rows.length - 1]
        return (
          <g key={c.slot}>
            <polyline
              points={c.rows.map((r) => `${x(r.wavelength_nm)},${y(r.mean)}`).join(" ")}
              fill="none"
              stroke={ink}
              strokeWidth={1.25}
              strokeDasharray={style.dash}
              strokeLinejoin="round"
            />
            {c.rows.map((r) => (
              <g key={r.band}>
                <line
                  x1={x(r.wavelength_nm)}
                  x2={x(r.wavelength_nm)}
                  y1={y(r.p05)}
                  y2={y(r.p95)}
                  stroke={ink}
                  strokeWidth={0.75}
                  opacity={0.6}
                />
                {style.marker === "circle" ? (
                  <circle cx={x(r.wavelength_nm)} cy={y(r.mean)} r={2.5} fill={ink} />
                ) : (
                  <rect
                    x={x(r.wavelength_nm) - 2.25}
                    y={y(r.mean) - 2.25}
                    width={4.5}
                    height={4.5}
                    fill={ink}
                  />
                )}
              </g>
            ))}
            <text
              x={x(last.wavelength_nm) + 6}
              y={y(last.mean)}
              fontSize={10}
              fill={ink}
              dominantBaseline="middle"
            >
              {c.slot} ·{" "}
              {last.name.length > 13 ? `${last.name.slice(0, 12)}…` : last.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
