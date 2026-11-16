/**
 * An NDVI trajectory drawn: the model's daily NDVI as a line, its interval
 * shaded around it, the dates it used as dots and the dates it set aside as
 * crosses.
 *
 * MODEL AND MEASURE LOOK APART. The line and the band are the model's; the
 * marks are what the satellite measured. Each is told by its shape as well as
 * its colour, so the chart reads in grey and under the common colour-vision
 * deficiencies: Okabe and Ito's green for the model, orange for a date used,
 * vermilion for a date set aside, each token measured at 3:1 on the panel in
 * both themes (check:contrast).
 */
import {
  bandPath,
  chartScales,
  linePath,
  monthLabel,
  monthTicks,
  ndviRange,
  ndviText,
  ndviTicks,
  type ChartFrame,
} from "@/lib/trajectory"
import type { TrajectoryAnalysis } from "@/lib/types"

const MODEL = "var(--oi-green)"
const USED = "var(--oi-orange)"
const SET_ASIDE = "var(--oi-vermillion)"
const FRAME: ChartFrame = {
  width: 300,
  height: 156,
  left: 30,
  right: 8,
  top: 12,
  bottom: 20,
}
const TICK = 3

function Cross({ x, y, r = 2.6 }: { x: number; y: number; r?: number }) {
  return (
    <path
      d={`M${x - r},${y - r}L${x + r},${y + r}M${x - r},${y + r}L${x + r},${y - r}`}
      style={{ stroke: SET_ASIDE }}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  )
}

export function TrajectoryChart({ report }: { report: TrajectoryAnalysis }) {
  if (report.dates.length < 2) return null
  const range = ndviRange(report)
  const { x, y } = chartScales(report, FRAME, range)
  const first = report.dates[0]
  const last = report.dates[report.dates.length - 1]
  const months = monthTicks(first, last)
  const bottom = FRAME.height - FRAME.bottom
  const right = FRAME.width - FRAME.right
  const used = report.observations.filter((o) => o.kept)
  const aside = report.observations.filter((o) => !o.kept)
  const level = Math.round(100 * report.level)
  return (
    <svg
      viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`NDVI from ${first} to ${last}, with its ${level}\u00a0% interval; ${used.length} dates used and ${aside.length} set aside`}
    >
      <text x={0} y={7} className="fill-muted-foreground" fontSize={8}>
        NDVI
      </text>
      {ndviTicks(range).map((v) => (
        <g key={v}>
          <line
            x1={FRAME.left - TICK}
            x2={FRAME.left}
            y1={y(v)}
            y2={y(v)}
            className="stroke-muted-foreground"
            strokeWidth={0.6}
          />
          <text
            x={FRAME.left - TICK - 2}
            y={y(v) + 2.8}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {ndviText(v).replace(/\.?0+$/, "") || "0"}
          </text>
        </g>
      ))}
      {months.map((m, i) => (
        <g key={m}>
          <line
            x1={x(m)}
            x2={x(m)}
            y1={bottom}
            y2={bottom + TICK}
            className="stroke-muted-foreground"
            strokeWidth={0.6}
          />
          <text
            x={x(m)}
            y={bottom + TICK + 9}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {monthLabel(m, i ? months[i - 1] : null)}
          </text>
        </g>
      ))}
      <path
        d={`M${FRAME.left},${FRAME.top}V${bottom}H${right}`}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={0.6}
      />
      <path d={bandPath(report, x, y)} style={{ fill: MODEL }} fillOpacity={0.25} />
      <path
        d={linePath(report, x, y)}
        fill="none"
        style={{ stroke: MODEL }}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {used.map((o) => (
        <circle
          key={o.date}
          cx={x(o.date)}
          cy={y(o.ndvi)}
          r={2.1}
          style={{ fill: USED }}
        />
      ))}
      {aside.map((o) => (
        <Cross key={o.date} x={x(o.date)} y={y(o.ndvi)} />
      ))}
    </svg>
  )
}

/** What each mark of the chart is, beside a drawing of it. */
export function TrajectoryKey({ level }: { level: number }) {
  const item = "flex items-center gap-1"
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
      <span className={item}>
        <svg width={14} height={8} aria-hidden>
          <rect
            x={0}
            y={0}
            width={14}
            height={8}
            style={{ fill: MODEL }}
            fillOpacity={0.25}
          />
          <path d="M0,4H14" style={{ stroke: MODEL }} strokeWidth={1.5} />
        </svg>
        Model, {Math.round(100 * level)}
        {"\u00a0"}% interval
      </span>
      <span className={item}>
        <svg width={8} height={8} aria-hidden>
          <circle cx={4} cy={4} r={2.1} style={{ fill: USED }} />
        </svg>
        Date used
      </span>
      <span className={item}>
        <svg width={8} height={8} aria-hidden>
          <Cross x={4} y={4} r={2.4} />
        </svg>
        Set aside
      </span>
    </div>
  )
}
