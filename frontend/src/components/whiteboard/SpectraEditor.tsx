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
 * CHOOSER, NOT A SECOND SOURCE. Which run is read follows `StudioTables`: the
 * runs behind the selected planes, in selection order, deduplicated by area.
 * A view of a selection, so a board with nothing selected says so rather than
 * picking a run on the reader's behalf.
 */
import { useMemo, useState } from "react"
import { useTheme } from "next-themes"
import {
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { ClassSpectrumPoint, PredictResult } from "@/lib/types"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn, seriesDash } from "@/lib/seriesColor"
import { cn } from "@/lib/utils"

interface Series {
  classId: number
  name: string
  stroke: string
  dash: string | undefined
}

export function SpectraEditor({
  runs,
}: {
  /** The selected planes' runs, in selection order. */
  runs: Array<{ id: string; label: string; result: PredictResult }>
}) {
  const [runIdx, setRunIdx] = useState(0)
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  const run = runs.length ? runs[Math.min(runIdx, runs.length - 1)] : undefined
  const spectra = run?.result.class_spectra ?? null

  const { rows, series, byKey, minPixels } = useMemo(() => {
    const ground = chartGround(theme)
    const points: ClassSpectrumPoint[] = spectra?.points ?? []

    // Series in the order the classes were measured, so the legend does not
    // reshuffle between two runs over the same area.
    const first = new Map<number, ClassSpectrumPoint>()
    for (const p of points) if (!first.has(p.class_id)) first.set(p.class_id, p)
    const series: Series[] = [...first.values()].map((p, i) => ({
      classId: p.class_id,
      name: p.name,
      stroke: legibleOn(p.color, ground),
      dash: seriesDash(i),
    }))

    // One row per band, one column per class: the shape Recharts reads, and
    // the shape a tooltip needs to show every class at one wavelength.
    const wavelengths = [...new Set(points.map((p) => p.wavelength_nm))].sort(
      (a, b) => a - b
    )
    const byKey = new Map<string, ClassSpectrumPoint>()
    for (const p of points) byKey.set(`${p.wavelength_nm}|${p.class_id}`, p)

    const rows = wavelengths.map((nm) => {
      const row: Record<string, number | string> = {
        wavelength_nm: nm,
        band: points.find((p) => p.wavelength_nm === nm)?.band ?? "",
      }
      for (const s of series) {
        const p = byKey.get(`${nm}|${s.classId}`)
        if (p) row[`c${s.classId}`] = p.mean
      }
      return row
    })

    const minPixels = points.length
      ? Math.min(...points.map((p) => p.n_pixels))
      : 0
    return { rows, series, byKey, minPixels }
  }, [spectra, theme])

  if (!runs.length) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Pick a plane to read the spectral response of the classes its run
        predicted.
      </p>
    )
  }

  const ticks = rows.map((r) => r.wavelength_nm as number)
  const bandOf = new Map(rows.map((r) => [r.wavelength_nm as number, r.band as string]))

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
        {!spectra || !rows.length || !series.length ? (
          <p className="text-meta text-muted-foreground">
            This run carries no spectral response. Runs saved before the
            measurement existed do not have one, and neither does a run whose
            scene could not be re-read for its bands.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={rows}
                margin={{ top: 6, right: 14, left: 4, bottom: 24 }}
              >
                {/*
                  A vertical rule per band, unlike the time series elsewhere.
                  Here the x positions ARE the measurement -- seven samples with
                  a 750 nm hole in the middle -- and the rules make the sampling
                  visible instead of leaving it implied by the dots.
                */}
                <CartesianGrid
                  vertical
                  horizontal={false}
                  stroke="var(--hairline)"
                  strokeDasharray="2 4"
                />
                {/*
                  Wavelength on a true numeric scale, not seven evenly spaced
                  categories. The gap between B8A at 865 nm and B11 at 1614 nm
                  is most of the axis, and that gap is the sensor: Sentinel-2
                  does not sample there, and a category axis would draw a
                  straight line across it as though it had.
                */}
                <XAxis
                  type="number"
                  dataKey="wavelength_nm"
                  domain={[400, 2300]}
                  ticks={ticks}
                  tickFormatter={(v: number) => bandOf.get(v) ?? String(v)}
                  stroke="var(--border)"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickMargin={6}
                  minTickGap={2}
                >
                  <Label
                    value="Wavelength (nm), band centres"
                    position="insideBottom"
                    offset={-16}
                    style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                </XAxis>
                <YAxis
                  domain={["auto", "auto"]}
                  stroke="var(--border)"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v: number) => v.toFixed(2)}
                  width={48}
                >
                  <Label
                    value="Reflectance (dimensionless)"
                    angle={-90}
                    position="insideLeft"
                    style={{
                      fontSize: 12,
                      fill: "var(--muted-foreground)",
                      textAnchor: "middle",
                    }}
                  />
                </YAxis>
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const nm = Number(label)
                    return (
                      <div
                        className="rounded-sm border border-border p-2"
                        style={{ backgroundColor: "var(--popover)", fontSize: 11 }}
                      >
                        <p className="telemetry mb-1 text-muted-foreground">
                          {bandOf.get(nm)} · {nm} nm
                        </p>
                        {series.map((s) => {
                          const p = byKey.get(`${nm}|${s.classId}`)
                          if (!p) return null
                          return (
                            <p key={s.classId} className="flex items-center gap-1.5">
                              <span
                                className="size-2 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: s.stroke }}
                              />
                              <span className="w-36 truncate">{s.name}</span>
                              <span className="telemetry">{p.mean.toFixed(3)}</span>
                              {/*
                                The spread, here rather than as five overlapping
                                ribbons. Drawn, they cover each other and the
                                means they belong to; a mean with no dispersion
                                beside it anywhere would be the worse omission.
                              */}
                              <span className="telemetry text-muted-foreground">
                                [{p.p05.toFixed(3)}, {p.p95.toFixed(3)}]
                              </span>
                            </p>
                          )
                        })}
                      </div>
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={20}
                  wrapperStyle={{ fontSize: 11, paddingBottom: 2 }}
                  iconType="plainline"
                />
                {series.map((s) => (
                  <Line
                    key={s.classId}
                    type="linear"
                    dataKey={`c${s.classId}`}
                    name={s.name}
                    stroke={s.stroke}
                    strokeWidth={1.8}
                    // A second channel, so colour is never the only one.
                    strokeDasharray={s.dash}
                    dot={{ r: 2, strokeWidth: 0, fill: s.stroke }}
                    activeDot={{ r: 3.5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/*
              What the figure is not. A curve is the mean over pixels the MODEL
              assigned, so a misclassified region moves the curve of the class
              it was assigned to, and the spectrum cannot be read as evidence
              that the assignment was right.
            */}
            <p className="mt-2 text-meta text-muted-foreground">
              Class means over predicted pixels, so this describes what the
              classifier grouped together rather than whether the grouping is
              correct. Smallest class n = {minPixels.toLocaleString()} pixels;
              hover for the 5th to 95th percentile spread.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
