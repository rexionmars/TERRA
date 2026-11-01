/**
 * Class separability: which bands tell two classes apart, and where that fails.
 *
 * The other half of the question the spectral response editor asks. That one
 * draws what each class reflects; this one asks whether those curves are far
 * enough apart to be told from one another, band by band, using the spread the
 * same payload already carries.
 *
 * TWO READINGS, because the interesting case is when they disagree.
 *
 *   Surround -- every pair of classes within ONE run. This is contrast against
 *   the surround: how far a class sits from the others sharing its scene.
 *
 *   Drift -- the SAME class in two runs. This is whether the class itself still
 *   looks the way it did in the other area.
 *
 * A class can be nearly unchanged in itself while becoming unclassifiable,
 * because what collapsed was the contrast around it rather than its own
 * signature. Drawing only one of the two readings makes that case unreadable,
 * and it is the case a reader comparing two regions is most likely to be in.
 *
 * TEXT FIRST, FIGURE SECOND. The ranking carries every number as text and the
 * chart under it shows the shape. Colour is nowhere the only channel: the
 * ranking states the distance, names the band that carries it, and orders the
 * rows by it.
 *
 * The arithmetic is in lib/separability.ts, with its own tests. Nothing here
 * computes a distance; this file chooses what to compare and draws the result.
 */
import { useMemo, useState } from "react"
import { useTheme } from "next-themes"

import type { ClassSpectra, PredictResult } from "@/lib/types"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn } from "@/lib/seriesColor"
import {
  ROW_PX,
  STROKE,
  TYPE,
  layoutFigure,
  linearScale,
  measureText,
  plotHeightFor,
} from "@/lib/figure"
import { useFigureHost } from "@/lib/useFigureSize"
import {
  classDriftBetweenRuns,
  classPairSeparability,
  separabilityBand,
  type BandSeparation,
} from "@/lib/separability"
import { cn } from "@/lib/utils"

type Reading = "surround" | "drift"

/** The JM scale is fixed at 0 to 2 by its definition, never fitted to data. */
const JM_DOMAIN = [0, 2] as const
const JM_TICKS = [0, 0.5, 1, 1.5, 2]

/**
 * Where the conventional readings change, drawn as ground behind the bars.
 *
 * A convention rather than a result -- see `separabilityBand`. They are drawn
 * because a bare bar at 0.9 says nothing to a reader who does not already know
 * the scale saturates at 2, and labelled because an unexplained band of shading
 * is a second thing to decode rather than a key.
 */
const BANDS: { from: number; to: number; label: string }[] = [
  { from: 0, to: 1.0, label: "overlapping" },
  { from: 1.0, to: 1.9, label: "partial" },
  { from: 1.9, to: 2, label: "separable" },
]

const fmtJM = (jm: number) => jm.toFixed(3)

/** Signed, and in percentage points of reflectance, which is how it is read. */
const fmtShift = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pp`

export function SeparabilityEditor({
  runs,
}: {
  /** The selected planes' runs, in selection order. */
  runs: Array<{ id: string; label: string; result: PredictResult }>
}) {
  const [reading, setReading] = useState<Reading>("surround")
  const [runIdx, setRunIdx] = useState(0)
  const [otherIdx, setOtherIdx] = useState(1)
  const [pick, setPick] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  /*
    A callback ref, not a ref object. This panel answers "nothing selected"
    and "this run carries no spectra" before it ever draws a figure, so the
    measured host is absent on the first render more often than it is present
    -- and it unmounts again on every deselection. A ref-object measurement
    attaches once, finds nothing, and leaves the chart on the 640x300 fallback
    for the rest of the session. See useFigureSize's own header.
  */
  const [host, box] = useFigureHost()

  const run = runs.length ? runs[Math.min(runIdx, runs.length - 1)] : undefined
  const other =
    runs.length > 1 ? runs[Math.min(otherIdx, runs.length - 1)] : undefined
  const spectra: ClassSpectra | null = run?.result.class_spectra ?? null
  const otherSpectra: ClassSpectra | null =
    other?.result.class_spectra ?? null

  const ground = useMemo(() => chartGround(theme), [theme])

  /*
    Both readings reduced to one list of rows, so the ranking and the chart
    below it are written once. A row is a thing being compared, its distance,
    the band carrying it, and the per-band detail the chart draws.
  */
  const rows = useMemo(() => {
    if (reading === "surround") {
      return classPairSeparability(spectra).map((p) => ({
        key: `${p.aId}-${p.bId}`,
        swatches: [p.aColor, p.bColor],
        title: `${p.aName} vs ${p.bName}`,
        best: p.best,
        measured: p.measured,
        bands: p.bands,
        shifts: null as { band: string; delta: number | null }[] | null,
      }))
    }
    return classDriftBetweenRuns(spectra, otherSpectra).map((d) => ({
      key: String(d.classId),
      swatches: [d.color],
      title: d.name,
      best: d.best,
      measured: d.measured,
      bands: d.bands,
      shifts: d.shifts,
    }))
  }, [reading, spectra, otherSpectra])

  /*
    Drift is ranked the other way round. In surround the reader is hunting for
    what is NOT separable, so least first; in drift the reader is hunting for
    what MOVED, so most first. The two lists mean opposite things at the top and
    sorting them the same way would put the uninteresting end of one of them
    under the reader's eye.
  */
  const ordered = useMemo(() => {
    if (reading === "surround") return rows
    return [...rows].sort((a, b) => {
      if (a.best === null && b.best === null) return 0
      if (a.best === null) return 1
      if (b.best === null) return -1
      return (b.best.jm ?? 0) - (a.best.jm ?? 0)
    })
  }, [rows, reading])

  const selected =
    ordered.find((r) => r.key === pick) ?? ordered[0] ?? null

  /** The selected row's bands, in wavelength order, for the chart. */
  const chartBands = useMemo(
    () =>
      selected
        ? [...selected.bands].sort((a, b) => a.wavelength_nm - b.wavelength_nm)
        : [],
    [selected]
  )

  const figure = useMemo(() => {
    if (!chartBands.length || box.width < 80) return null
    const yLabels = JM_TICKS.map((t) => t.toFixed(1))
    const widest = chartBands.reduce(
      (w, b) => Math.max(w, measureText(b.band, TYPE.meta)),
      0
    )
    const layout = layoutFigure({
      width: box.width,
      plotHeight: plotHeightFor(box.height, { xLabelRows: 1, legendRows: 0 }),
      yLabels,
      xLabelRows: 1,
      lastXLabel: chartBands[chartBands.length - 1]?.band ?? "",
    })
    const y = linearScale(JM_DOMAIN, [layout.plot.y1, layout.plot.y0])
    const slot = (layout.plot.x1 - layout.plot.x0) / chartBands.length
    // Bars keep a gap on each side and never grow past the widest label they
    // sit under, so a two-band chart draws two bars rather than two slabs.
    const barW = Math.max(3, Math.min(slot * 0.6, widest + 8))
    return { layout, y, slot, barW, yLabels }
  }, [chartBands, box.width, box.height])

  // Every hook is above this line. The two cases below are the ones this editor
  // is most often mounted into -- a studio area exists before anything is
  // selected -- so each says what it needs rather than rendering an empty
  // rectangle that reads as a broken panel.
  if (!runs.length) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Pick a plane to read how far apart the classes its run predicted are,
        band by band.
      </p>
    )
  }

  const needsSecond = reading === "drift" && !other

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        {(
          [
            ["surround", "Against the surround"],
            ["drift", "Between two runs"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setReading(id)
              // The rows are different things in the two readings, so a key
              // held across the switch would select a pair that is not there.
              setPick(null)
            }}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-meta transition-colors",
              reading === id
                ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                : "text-muted-foreground hover:bg-hover hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}

        <span className="mx-1 h-3 w-px bg-border" aria-hidden />

        <RunTabs
          runs={runs}
          value={Math.min(runIdx, runs.length - 1)}
          onChange={(i) => {
            setRunIdx(i)
            setPick(null)
          }}
          prefix={reading === "drift" ? "A" : undefined}
        />
        {reading === "drift" && runs.length > 1 && (
          <RunTabs
            runs={runs}
            value={Math.min(otherIdx, runs.length - 1)}
            onChange={(i) => {
              setOtherIdx(i)
              setPick(null)
            }}
            prefix="B"
          />
        )}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {needsSecond ? (
          <p className="text-meta text-muted-foreground">
            Drift compares one class between two runs. Select a second plane and
            it is measured against this one.
          </p>
        ) : !spectra || (reading === "drift" && !otherSpectra) ? (
          <p className="text-meta text-muted-foreground">
            This reading needs the per-class spectral response, and one of these
            runs carries none. Runs saved before the measurement existed do not
            have one, and neither does a run whose scene could not be re-read
            for its bands.
          </p>
        ) : !ordered.length ? (
          <p className="text-meta text-muted-foreground">
            {reading === "surround"
              ? "This run predicted a single class, so there is no pair to separate."
              : "These two runs share no predicted class, so there is nothing to compare between them."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Provenance
              spectra={spectra}
              other={reading === "drift" ? otherSpectra : null}
              runLabel={run?.label}
              otherLabel={other?.label}
            />

            <div className="flex flex-col">
              {ordered.map((r) => {
                const active = selected?.key === r.key
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setPick(r.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-meta transition-colors",
                      active
                        ? "bg-accent-dim text-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                  >
                    <span className="flex shrink-0 items-center gap-0.5">
                      {r.swatches.map((c, i) => (
                        <span
                          key={i}
                          className="size-2 rounded-[1px]"
                          style={{ background: legibleOn(c, ground) }}
                        />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    {r.best === null ? (
                      <span className="telemetry shrink-0 text-[10px]">
                        not measured
                      </span>
                    ) : (
                      <>
                        {/*
                          How many bands the headline rests on, and only when
                          that is fewer than were tried. A distance drawn from
                          two bands out of seven is a weaker reading than one
                          drawn from all seven, and nothing else on the row
                          says so. Silent at full count, because "7/7" on
                          every row is noise that hides the "2/7" beside it.
                        */}
                        {r.measured < r.bands.length && (
                          <span
                            className="telemetry shrink-0 text-[10px] text-muted-foreground"
                            title={`${r.measured} of ${r.bands.length} bands could be measured for this comparison`}
                          >
                            {r.measured}/{r.bands.length}
                          </span>
                        )}
                        <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                          {r.best.band}
                        </span>
                        <span
                          className={cn(
                            "telemetry w-[3.2rem] shrink-0 text-right text-[10px]",
                            active ? "text-foreground" : undefined
                          )}
                        >
                          {fmtJM(r.best.jm!)}
                        </span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>

            <div
              className="rounded-sm border p-1.5"
              style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
            >
              <p className="eyebrow !text-[9px]">
                {selected?.title ?? ""} · per band
              </p>
              <div
                ref={host}
                className="relative min-h-0 w-full flex-1"
                style={{ minHeight: 190 }}
              >
                {figure && (
                  <svg
                    width={figure.layout.width}
                    height={figure.layout.height}
                    viewBox={`0 0 ${figure.layout.width} ${figure.layout.height}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "block",
                      fontFamily: "var(--font-sans)",
                    }}
                    role="img"
                    aria-label={`Jeffries-Matusita distance per band for ${selected?.title ?? ""}, on a scale of 0 to 2`}
                  >
                    {/* The conventional bands, as ground rather than as rules
                        over the bars, so nothing is drawn on top of the data. */}
                    {BANDS.map((b) => (
                      <g key={b.label}>
                        <rect
                          x={figure.layout.plot.x0}
                          y={figure.y(b.to)}
                          width={figure.layout.plot.x1 - figure.layout.plot.x0}
                          height={Math.max(0, figure.y(b.from) - figure.y(b.to))}
                          fill="var(--foreground)"
                          fillOpacity={b.label === "separable" ? 0.05 : b.label === "partial" ? 0.03 : 0}
                        />
                        <text
                          x={figure.layout.plot.x1 - 3}
                          y={(figure.y(b.from) + figure.y(b.to)) / 2}
                          fontSize={TYPE.micro}
                          fill="var(--muted-foreground)"
                          textAnchor="end"
                          dominantBaseline="middle"
                          opacity={0.7}
                        >
                          {b.label}
                        </text>
                      </g>
                    ))}

                    <path
                      d={`M${figure.layout.plot.x0},${figure.layout.plot.y0} L${figure.layout.plot.x0},${figure.layout.plot.y1} L${figure.layout.plot.x1},${figure.layout.plot.y1}`}
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth={STROKE.axis}
                    />

                    {JM_TICKS.map((t) => (
                      <g key={`y-${t}`}>
                        <line
                          x1={figure.layout.plot.x0 - 4}
                          x2={figure.layout.plot.x0}
                          y1={figure.y(t)}
                          y2={figure.y(t)}
                          stroke="var(--border)"
                          strokeWidth={STROKE.axis}
                        />
                        <text
                          x={figure.layout.plot.x0 - 7}
                          y={figure.y(t)}
                          fontSize={TYPE.meta}
                          fill="var(--muted-foreground)"
                          textAnchor="end"
                          dominantBaseline="middle"
                        >
                          {t.toFixed(1)}
                        </text>
                      </g>
                    ))}
                    <text
                      transform={`translate(${TYPE.body + 2},${(figure.layout.plot.y0 + figure.layout.plot.y1) / 2}) rotate(-90)`}
                      fontSize={TYPE.body}
                      fill="var(--muted-foreground)"
                      textAnchor="middle"
                    >
                      Jeffries-Matusita distance
                    </text>

                    {chartBands.map((b, i) => {
                      const cx =
                        figure.layout.plot.x0 + figure.slot * (i + 0.5)
                      return (
                        <g key={b.band}>
                          {b.jm === null ? (
                            /* A band that could not be measured is drawn as a
                               tick on the axis and named, never as a bar of
                               zero height -- zero is a distance and this is
                               the absence of one. */
                            <text
                              x={cx}
                              y={figure.layout.plot.y1 - 4}
                              fontSize={TYPE.micro}
                              fill="var(--muted-foreground)"
                              textAnchor="middle"
                              opacity={0.8}
                            >
                              {b.missing === "degenerate" ? "flat" : "n/a"}
                            </text>
                          ) : (
                            <rect
                              x={cx - figure.barW / 2}
                              y={figure.y(b.jm)}
                              width={figure.barW}
                              height={Math.max(
                                0,
                                figure.layout.plot.y1 - figure.y(b.jm)
                              )}
                              fill="var(--accent)"
                              fillOpacity={
                                separabilityBand(b.jm) === "separable"
                                  ? 0.95
                                  : separabilityBand(b.jm) === "partial"
                                    ? 0.7
                                    : 0.45
                              }
                            />
                          )}
                          <text
                            x={cx}
                            y={
                              figure.layout.plot.y1 +
                              ROW_PX.tick +
                              ROW_PX.label / 2
                            }
                            fontSize={TYPE.meta}
                            fill="var(--muted-foreground)"
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {b.band}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                )}
              </div>

              {selected?.shifts && (
                <ShiftRow
                  bands={chartBands}
                  shifts={selected.shifts}
                  aLabel={run?.label ?? "A"}
                  bLabel={other?.label ?? "B"}
                />
              )}
            </div>

            <Note reading={reading} />
          </div>
        )}
      </div>
    </div>
  )
}

function RunTabs({
  runs,
  value,
  onChange,
  prefix,
}: {
  runs: Array<{ id: string; label: string }>
  value: number
  onChange: (i: number) => void
  prefix?: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {prefix && (
        <span className="eyebrow shrink-0 !text-[9px]">{prefix}</span>
      )}
      {runs.map((r, i) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onChange(i)}
          className={cn(
            "max-w-[9rem] truncate rounded-sm px-1.5 py-0.5 text-meta transition-colors",
            i === value
              ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          )}
        >
          {r.label}
        </button>
      ))}
    </span>
  )
}

/**
 * Which acquisition the numbers came from.
 *
 * Not trim. `class_spectra` is ONE scene out of the period, so a separability
 * figure read as a seasonal property is being read as something it is not --
 * and in the drift reading the two runs are two different dates, which is a
 * second reason two classes can look further apart than they are.
 */
function Provenance({
  spectra,
  other,
  runLabel,
  otherLabel,
}: {
  spectra: ClassSpectra
  other: ClassSpectra | null
  runLabel?: string
  otherLabel?: string
}) {
  return (
    <p className="telemetry text-[10px] leading-snug text-muted-foreground">
      {other ? (
        <>
          {runLabel} {spectra.scene_date} · {otherLabel} {other.scene_date}
          {spectra.scene_date !== other.scene_date && (
            <> · different acquisitions, so season is in this comparison too</>
          )}
        </>
      ) : (
        <>
          {spectra.scene_date} · one acquisition of {spectra.n_scenes} ·{" "}
          {spectra.bands.length} bands
        </>
      )}
    </p>
  )
}

/** The direction each band moved, which the unsigned distance cannot say. */
function ShiftRow({
  bands,
  shifts,
  aLabel,
  bLabel,
}: {
  bands: BandSeparation[]
  shifts: { band: string; delta: number | null }[]
  aLabel: string
  bLabel: string
}) {
  const byBand = new Map(shifts.map((s) => [s.band, s.delta]))
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      <p className="eyebrow !text-[9px]">
        Mean reflectance, {aLabel} to {bLabel}
      </p>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {bands.map((b) => {
          const d = byBand.get(b.band)
          return (
            <span
              key={b.band}
              className="telemetry text-[10px] text-muted-foreground"
            >
              {b.band}{" "}
              <span className={d == null ? undefined : "text-foreground"}>
                {d == null ? "n/a" : fmtShift(d)}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * What the measurement is, and the two ways it is most likely to be misread.
 *
 * A FLOOR, NOT A CEILING, is the first and the one that matters. Every distance
 * here is univariate -- one band at a time -- and a classifier reads all of them
 * together, so it can separate classes that no single band separates. This is
 * not a theoretical caveat: a study on this same question measured a best
 * single-variable JM of 0.059 on a scale that runs to 2, over data on which a
 * random forest reached macro-F1 0.81. A reader who takes a column of short
 * bars for "these classes cannot be told apart" has drawn the opposite of what
 * the numbers support.
 *
 * NO CORRECTION IS IMPLIED is the second. A reader who finds a pair at 0.05
 * will reasonably ask what to do about it, and the honest answer is that this
 * panel does not know. Six corrections for a gap of this kind were measured on
 * real cross-region data and none of them closed it. Pointing at a repair that
 * does not exist would be worse than pointing at nothing.
 */
function Note({ reading }: { reading: Reading }) {
  return (
    <p className="text-[10px] leading-snug text-muted-foreground">
      {reading === "surround"
        ? "Jeffries-Matusita distance between each pair of predicted classes, one band at a time, from the mean and spread of a single acquisition under a normal assumption."
        : "Jeffries-Matusita distance for the same class measured in two runs, one band at a time, from the mean and spread of a single acquisition each under a normal assumption."}{" "}
      Per band because the payload carries a marginal for each band and no
      covariance between them.{" "}
      <span className="text-foreground">
        These are a floor and not a ceiling.
      </span>{" "}
      A classifier reads the bands together and can separate classes that no
      single band separates, so a column of short bars is not a finding that
      these classes are indistinguishable. It says only that no one band
      distinguishes them here — not that a model could not, and not that a
      correction is available.
    </p>
  )
}
