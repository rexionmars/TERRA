/**
 * What the sensor measured, per predicted class, for a selected plane.
 *
 * The application reads seven bands and reported none of them. The classifier
 * consumes them as 80 derived features and everything downstream shows indices,
 * which are ratios of bands with the bands themselves removed. The domain-shift
 * editor beside this one has the same shape of gap in the other direction: MMD,
 * KL and a change-vector magnitude say THAT a distribution moved without saying
 * where. A per-class spectrum says which band moved, and in which direction.
 *
 * DRAWN RATHER THAN CONFIGURED. The first version of this editor was a Recharts
 * `LineChart`, and it inherited that library's two defaults this figure cannot
 * have: a plot that stretches while its type does not, so the figure had no
 * proportions of its own, and a tick layout that drops a colliding label
 * silently, so seven measurements were drawn with six labels. `lib/figure.ts`
 * holds the coordinate system; everything below is marks placed in it.
 *
 * CHOOSER, NOT A SECOND SOURCE. Which run is read follows `StudioTables`: the
 * runs behind the selected planes, in selection order, deduplicated by area.
 */
import { useMemo, useState } from "react"
import { useTheme } from "next-themes"

import type { ClassSpectrumPoint, PredictResult } from "@/lib/types"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn, seriesDash } from "@/lib/seriesColor"
import {
  FIGURE,
  PLOT,
  STROKE,
  TYPE,
  figureStyle,
  linearScale,
  niceTicks,
  staggerRows,
} from "@/lib/figure"
import { cn } from "@/lib/utils"

interface Series {
  classId: number
  name: string
  stroke: string
  dash: string | undefined
  points: ClassSpectrumPoint[]
}

/** The axis the sensor defines, not the one the data happens to occupy. */
const NM_DOMAIN = [400, 2300] as const

export function SpectraEditor({
  runs,
}: {
  /** The selected planes' runs, in selection order. */
  runs: Array<{ id: string; label: string; result: PredictResult }>
}) {
  const [runIdx, setRunIdx] = useState(0)
  const [hoverBand, setHoverBand] = useState<number | null>(null)
  const [focusClass, setFocusClass] = useState<number | null>(null)
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  const run = runs.length ? runs[Math.min(runIdx, runs.length - 1)] : undefined
  const spectra = run?.result.class_spectra ?? null

  const figure = useMemo(() => {
    const ground = chartGround(theme)
    const points: ClassSpectrumPoint[] = spectra?.points ?? []
    if (!points.length) return null

    const byClass = new Map<number, ClassSpectrumPoint[]>()
    for (const p of points) {
      const list = byClass.get(p.class_id)
      if (list) list.push(p)
      else byClass.set(p.class_id, [p])
    }
    const series: Series[] = [...byClass.entries()].map(([classId, ps], i) => ({
      classId,
      name: ps[0].name,
      stroke: legibleOn(ps[0].color, ground),
      dash: seriesDash(i),
      points: [...ps].sort((a, b) => a.wavelength_nm - b.wavelength_nm),
    }))

    const bands = [...new Set(points.map((p) => p.wavelength_nm))]
      .sort((a, b) => a - b)
      .map((nm) => ({
        nm,
        band: points.find((p) => p.wavelength_nm === nm)?.band ?? "",
      }))

    /*
      The domain covers the percentiles, not the means, so a dispersion band
      never leaves the axis it is measured against.

      And it starts BELOW zero where the data does. Reflectance corrected for
      the baseline 04.00 offset goes slightly negative over dark surfaces --
      here the 5th percentile of Non-vegetated Area reaches -0.048 in the three
      visible bands -- which is not an error to be clipped away. Not clamping
      near zero is the reason the offset was introduced, and an axis pinned at
      zero would hide the one part of the correction that shows.
    */
    const yMax = Math.max(...points.map((p) => p.p95))
    const yMin = Math.min(0, ...points.map((p) => p.p05))
    const x = linearScale(NM_DOMAIN, [PLOT.x0, PLOT.x1])
    const y = linearScale([yMin, yMax], [PLOT.y1, PLOT.y0])

    const at = new Map<string, ClassSpectrumPoint>()
    for (const p of points) at.set(`${p.wavelength_nm}|${p.class_id}`, p)

    return {
      series,
      bands,
      x,
      y,
      at,
      yTicks: niceTicks(yMin, yMax, 5),
      // Drawn only when the data crosses it: on an all-positive spectrum the
      // axis already starts there and a second line would say nothing.
      zeroLine: yMin < 0 ? y(0) : null,
      // Half the gap to each neighbour, so a pointer anywhere in the figure is
      // always inside exactly one band's column.
      columns: bands.map((b, i) => {
        const prev = i > 0 ? (b.nm + bands[i - 1].nm) / 2 : NM_DOMAIN[0]
        const next =
          i < bands.length - 1 ? (b.nm + bands[i + 1].nm) / 2 : NM_DOMAIN[1]
        return { left: x(prev), right: x(next) }
      }),
      minPixels: Math.min(...points.map((p) => p.n_pixels)),
    }
  }, [spectra, theme])

  if (!runs.length) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Pick a plane to read the spectral response of the classes its run
        predicted.
      </p>
    )
  }

  // 22 units: three or four glyphs at TYPE.meta, plus a gap.
  const rows = staggerRows(figure?.bands.map((b) => figure.x(b.nm)) ?? [], 22)
  const hovered = hoverBand !== null ? figure?.bands[hoverBand] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        {/* Which run, only where more than one is selected. */}
        {runs.length > 1 &&
          runs.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRunIdx(i)}
              className={cn(
                "max-w-[12rem] truncate rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                i === runIdx
                  ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                  : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        {/*
          The two statements a reader needs before the curve means anything: it
          is ONE acquisition, and it is the corrected reflectance convention.
          Neither is recoverable from the figure, and this run reports other
          quantities under the other convention.
        */}
        {spectra && (
          <span className="telemetry ml-auto truncate text-meta text-muted-foreground">
            {spectra.scene_date} · 1 of {spectra.n_scenes} acquisition
            {spectra.n_scenes === 1 ? "" : "s"} · {spectra.convention}
          </span>
        )}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {!spectra || !figure ? (
          <p className="text-meta text-muted-foreground">
            This run carries no spectral response. Runs saved before the
            measurement existed do not have one, and neither does a run whose
            scene could not be re-read for its bands.
          </p>
        ) : (
          /*
            The figure does not scale below its reference width; the area
            scrolls instead. Fitting it to a narrower panel is what puts a 5 px
            glyph on screen, and this studio already refuses that trade.
          */
          <div style={{ minWidth: FIGURE.width }}>
            <svg
              viewBox={`0 0 ${FIGURE.width} ${FIGURE.height}`}
              style={figureStyle()}
              role="img"
              aria-label={`Mean surface reflectance per band for ${figure.series.length} predicted classes on ${spectra.scene_date}`}
            >
              {/*
                The dispersion of ONE class at a time, on hover. Five ribbons
                drawn at once cover each other and the means they belong to,
                which is why the first version had no dispersion at all.
              */}
              {figure.series
                .filter((s) => s.classId === focusClass)
                .map((s) => (
                  <path
                    key={`ribbon-${s.classId}`}
                    d={
                      s.points
                        .map((p, i) => `${i ? "L" : "M"}${figure.x(p.wavelength_nm)},${figure.y(p.p95)}`)
                        .join("") +
                      s.points
                        .slice()
                        .reverse()
                        .map((p) => `L${figure.x(p.wavelength_nm)},${figure.y(p.p05)}`)
                        .join("") +
                      "Z"
                    }
                    fill={s.stroke}
                    fillOpacity={0.14}
                    stroke="none"
                  />
                ))}

              {/*
                A rule per band. Unlike a background grid, these are not
                decoration: the x positions ARE the measurement, seven samples
                with a 750 nm hole between B8A and B11, and the rules are what
                make the sampling visible rather than implied by the dots.
              */}
              {figure.bands.map((b, i) => (
                <line
                  key={`rule-${b.band}`}
                  x1={figure.x(b.nm)}
                  x2={figure.x(b.nm)}
                  y1={PLOT.y0}
                  y2={PLOT.y1}
                  stroke={i === hoverBand ? "var(--accent-quiet)" : "var(--hairline)"}
                  strokeWidth={i === hoverBand ? STROKE.axis : STROKE.rule}
                  strokeDasharray={i === hoverBand ? undefined : "2 4"}
                />
              ))}

              {/*
                Zero, where reflectance can fall below it. Without the rule a
                reader cannot tell a small positive from a small negative on a
                dispersion band that straddles the two.
              */}
              {figure.zeroLine !== null && (
                <line
                  x1={PLOT.x0}
                  x2={PLOT.x1}
                  y1={figure.zeroLine}
                  y2={figure.zeroLine}
                  stroke="var(--border)"
                  strokeWidth={STROKE.rule}
                />
              )}

              {/* Two axis lines, no frame: theme_classic, as the R figure. */}
              <path
                d={`M${PLOT.x0},${PLOT.y0} L${PLOT.x0},${PLOT.y1} L${PLOT.x1},${PLOT.y1}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth={STROKE.axis}
              />

              {figure.yTicks.map((t) => (
                <g key={`y-${t}`}>
                  <line
                    x1={PLOT.x0 - 4}
                    x2={PLOT.x0}
                    y1={figure.y(t)}
                    y2={figure.y(t)}
                    stroke="var(--border)"
                    strokeWidth={STROKE.axis}
                  />
                  <text
                    x={PLOT.x0 - 7}
                    y={figure.y(t)}
                    fontSize={TYPE.meta}
                    fill="var(--muted-foreground)"
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {t.toFixed(2)}
                  </text>
                </g>
              ))}
              <text
                transform={`translate(${TYPE.body + 2},${(PLOT.y0 + PLOT.y1) / 2}) rotate(-90)`}
                fontSize={TYPE.body}
                fill="var(--muted-foreground)"
                textAnchor="middle"
              >
                Reflectance (dimensionless)
              </text>

              {/* Band labels, staggered where two bands sit too close to fit. */}
              {figure.bands.map((b, i) => (
                <g key={`x-${b.band}`}>
                  <line
                    x1={figure.x(b.nm)}
                    x2={figure.x(b.nm)}
                    y1={PLOT.y1}
                    y2={PLOT.y1 + 4 + rows[i] * 12}
                    stroke="var(--border)"
                    strokeWidth={STROKE.axis}
                  />
                  <text
                    x={figure.x(b.nm)}
                    y={PLOT.y1 + 15 + rows[i] * 12}
                    fontSize={TYPE.meta}
                    fill={i === hoverBand ? "var(--foreground)" : "var(--muted-foreground)"}
                    textAnchor="middle"
                  >
                    {b.band}
                  </text>
                </g>
              ))}
              <text
                x={(PLOT.x0 + PLOT.x1) / 2}
                y={FIGURE.height - 6}
                fontSize={TYPE.body}
                fill="var(--muted-foreground)"
                textAnchor="middle"
              >
                Wavelength (nm), band centres
              </text>

              {figure.series.map((s) => {
                const dim = focusClass !== null && focusClass !== s.classId
                return (
                  <g key={`s-${s.classId}`} opacity={dim ? 0.25 : 1}>
                    <polyline
                      points={s.points
                        .map((p) => `${figure.x(p.wavelength_nm)},${figure.y(p.mean)}`)
                        .join(" ")}
                      fill="none"
                      stroke={s.stroke}
                      strokeWidth={STROKE.series}
                      // A second channel, so colour is never the only one.
                      strokeDasharray={s.dash}
                      strokeLinejoin="round"
                    />
                    {s.points.map((p) => (
                      <circle
                        key={p.band}
                        cx={figure.x(p.wavelength_nm)}
                        cy={figure.y(p.mean)}
                        r={2.2}
                        fill={s.stroke}
                      />
                    ))}
                  </g>
                )
              })}

              {/*
                The legend is also the control: pointing at a class is how its
                dispersion is asked for. On the right rather than above, because
                the class names run to 26 characters and a row of five would set
                the figure's width instead of the data doing it.
              */}
              {figure.series.map((s, i) => (
                <g
                  key={`legend-${s.classId}`}
                  transform={`translate(${PLOT.x1 + 12},${PLOT.y0 + 8 + i * 16})`}
                  onMouseEnter={() => setFocusClass(s.classId)}
                  onMouseLeave={() => setFocusClass(null)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={-4}
                    y={-9}
                    width={FIGURE.margin.right - 8}
                    height={16}
                    fill={focusClass === s.classId ? "var(--accent-dim)" : "transparent"}
                  />
                  <line
                    x1={0}
                    x2={16}
                    y1={0}
                    y2={0}
                    stroke={s.stroke}
                    strokeWidth={STROKE.series}
                    strokeDasharray={s.dash}
                  />
                  <text
                    x={21}
                    y={0}
                    fontSize={TYPE.meta}
                    fill="var(--foreground)"
                    dominantBaseline="middle"
                  >
                    {s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name}
                  </text>
                </g>
              ))}

              {/* Pointer targets, last so nothing else takes the event. */}
              {figure.columns.map((c, i) => (
                <rect
                  key={`hit-${i}`}
                  x={c.left}
                  y={PLOT.y0}
                  width={Math.max(0, c.right - c.left)}
                  height={PLOT.y1 - PLOT.y0}
                  fill="transparent"
                  onMouseEnter={() => setHoverBand(i)}
                  onMouseLeave={() => setHoverBand(null)}
                />
              ))}
            </svg>

            {/*
              A readout, not a tooltip. It sits in one place and occludes
              nothing: a floating panel over a figure this dense covers the
              neighbouring band it is being compared against, and moves while
              the reader is reading it.
            */}
            <div
              className="mt-1 rounded-sm border p-1.5"
              style={{ borderColor: "rgb(var(--p-line) / 0.22)", minHeight: 58 }}
            >
              {hovered ? (
                <>
                  <p className="telemetry mb-1 text-meta text-muted-foreground">
                    {hovered.band} · {hovered.nm} nm · mean [p05, p95]
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {figure.series.map((s) => {
                      const p = figure.at.get(`${hovered.nm}|${s.classId}`)
                      if (!p) return null
                      return (
                        <span
                          key={s.classId}
                          className="flex items-center gap-1.5 text-meta"
                        >
                          <span
                            className="size-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: s.stroke }}
                          />
                          <span className="truncate">{s.name}</span>
                          <span className="telemetry">{p.mean.toFixed(3)}</span>
                          <span className="telemetry text-muted-foreground">
                            [{p.p05.toFixed(3)}, {p.p95.toFixed(3)}]
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-meta text-muted-foreground">
                  Point at a band for its values, or at a class in the legend
                  for the 5th to 95th percentile spread of that class.
                </p>
              )}
            </div>

            {/*
              What the figure is not. A curve is the mean over pixels the MODEL
              assigned, so a misclassified region moves the curve of the class
              it was assigned to, and the spectrum cannot be read as evidence
              that the assignment was right.
            */}
            <p className="mt-2 text-meta text-muted-foreground">
              Class means over predicted pixels, so this describes what the
              classifier grouped together rather than whether the grouping is
              correct. Smallest class n = {figure.minPixels.toLocaleString()}{" "}
              pixels.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
