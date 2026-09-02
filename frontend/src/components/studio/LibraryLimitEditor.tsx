/**
 * Each predicted class against a spectral library, and the limit that runs into.
 *
 * TWO READINGS, one per pane, chosen in the area header beside the editor's
 * own name. `distance` is the ranking over every class at once and is what a
 * reader comes for; `mechanism` is one class band by band and is what stops
 * the ranking being read as an identification. Stacked in one body the ranking
 * pushed the mechanism below the fold, which is where an argument goes to be
 * skipped.
 *
 * THE READING THIS EXISTS TO PREVENT. A reader who sees a class called Soybean
 * and a soybean reference in the same interface will conclude, if nothing stops
 * them, that a small angle between the two identifies the material. It does
 * not, and the measurement says so plainly: on every run this has been put
 * against, the class named Soybean is the FURTHEST of the five from the soybean
 * reference, not the closest.
 *
 * That is not a classification error, which is why the panels are ordered the
 * way they are. The ranking states the result, the ratio states the mechanism,
 * and the normalised shapes show what the angle actually compares. A library
 * spectrum is leaf level and a Sentinel-2 pixel is canopy: soil through the
 * gaps and shadow between the rows. If the difference were brightness the angle
 * would be zero, because the angle is scale-invariant -- it is not, because
 * soil raises the red while gaps and shadow lower the NIR, in opposite
 * directions, and the shape itself is distorted.
 *
 * So the word "identified" appears nowhere here, and must not be added.
 */
import { useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Info } from "@phosphor-icons/react"

import { StudioPopover } from "@/components/studio/StudioPopover"

import type { LibraryClass, PredictResult } from "@/lib/types"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn } from "@/lib/seriesColor"
import {
  ROW_PX,
  STROKE,
  TYPE,
  layoutFigure,
  linearScale,
  measureText,
  niceTicks,
  plotHeightFor,
} from "@/lib/figure"
import { useFigureBox, useFigureWidth } from "@/lib/useFigureSize"
import { cn } from "@/lib/utils"

/*
  Both panels lay themselves out from the panel they are given and from the
  text they will draw, through the same `layoutFigure` the spectral editor
  uses. Neither carries a margin written by hand: the ranking's label gutter is
  the widest class name, and the band panel's is its widest tick.

  They also draw the SAME seven bands as the spectral editor, so the band panel
  shares that figure's x domain and a band lands at the same fraction of the
  plot in both -- which is as far as sharing can go now that the plot is the
  panel's size rather than a constant.
*/
const RANK_ROW = 22

function AngleRanking({
  classes,
  colours,
  focus,
  onFocus,
}: {
  classes: LibraryClass[]
  colours: Map<number, string>
  focus: number | null
  onFocus: (id: number | null) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const width = useFigureWidth(host)
  const max = Math.max(...classes.map((c) => c.angle_rad))
  const ticks = niceTicks(0, max * 1.08, 5)
  /*
    The gutter is the widest class name, so a legend of long names widens it
    and a legend of short ones gives the bars the room back. It was 176 units
    written down, which was right for the five classes that happened to be
    there.
  */
  const gutter =
    Math.max(...classes.map((c) => measureText(c.name, TYPE.meta))) + 10
  // The ranking asks for the height its rows need rather than taking what it
  // is given: rows of a fixed height are what makes five classes readable and
  // twelve scrollable, instead of twelve rows squeezed into one panel.
  const height =
    classes.length * RANK_ROW + ROW_PX.label + ROW_PX.title + ROW_PX.gap
  const layout = {
    width: width,
    height,
    plot: {
      x0: gutter,
      x1: Math.max(gutter + 1, width - 42),
      y0: ROW_PX.gap,
      y1: classes.length * RANK_ROW + ROW_PX.gap,
    },
  }
  const x = linearScale([0, max * 1.08], [layout.plot.x0, layout.plot.x1])
  const row = RANK_ROW

  return (
    <div ref={host} className="w-full">
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ display: "block", fontFamily: "var(--font-sans)" }}
      role="img"
      aria-label="Spectral angle from each predicted class to the library reference"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={layout.plot.y0}
            y2={layout.plot.y1}
            stroke="var(--hairline)"
            strokeWidth={0.75}
            strokeDasharray="2 4"
          />
          <text
            x={x(t)}
            y={layout.plot.y1 + 12}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      <text
        x={(layout.plot.x0 + layout.plot.x1) / 2}
        y={layout.height - 4}
        fontSize={TYPE.body}
        fill="var(--muted-foreground)"
        textAnchor="middle"
      >
        Spectral angle to the reference (radians) — smaller is more consistent
      </text>
      {classes.map((c, i) => {
        const y = layout.plot.y0 + i * row + row / 2
        const stroke = colours.get(c.class_id) ?? "#888888"
        const dim = focus !== null && focus !== c.class_id
        return (
          <g
            key={c.class_id}
            opacity={dim ? 0.35 : 1}
            onMouseEnter={() => onFocus(c.class_id)}
            onMouseLeave={() => onFocus(null)}
          >
            <rect
              x={0}
              y={y - row / 2}
              width={layout.width}
              height={row}
              fill={focus === c.class_id ? "var(--accent-dim)" : "transparent"}
            />
            <text
              x={layout.plot.x0 - 8}
              y={y}
              fontSize={TYPE.meta}
              fill="var(--foreground)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {c.name}
            </text>
            <rect
              x={layout.plot.x0}
              y={y - row * 0.22}
              width={Math.max(0, x(c.angle_rad) - layout.plot.x0)}
              height={row * 0.44}
              fill={stroke}
            />
            <text
              x={x(c.angle_rad) + 5}
              y={y}
              fontSize={TYPE.meta}
              fill="var(--muted-foreground)"
              dominantBaseline="middle"
              className="telemetry"
            >
              {c.angle_rad.toFixed(3)}
            </text>
          </g>
        )
      })}
    </svg>
    </div>
  )
}

function BandPanel({
  cls,
  stroke,
  mode,
}: {
  cls: LibraryClass
  stroke: string
  mode: "ratio" | "shape"
}) {
  /*
    A box sized by the pane, not by this figure.

    The host is a flex child with min-h-0 and the svg is absolute inside it, so
    the figure is out of flow and cannot push the container it is measured
    from. That is what lets the height be read as well as the width.
  */
  const host = useRef<HTMLDivElement | null>(null)
  const box = useFigureBox(host)
  const bands = cls.bands

  const values =
    mode === "ratio"
      ? bands.map((b) => b.ratio ?? 0)
      : bands.map((b) => b.unit_canopy ?? 0)
  const other =
    mode === "shape" ? bands.map((b) => b.unit_leaf ?? 0) : null
  const lo = Math.min(0, ...values, ...(other ?? []))
  const hi = Math.max(...values, ...(other ?? []))
  const ticks = niceTicks(lo, hi * 1.06, 4)
  const layout = layoutFigure({
    width: box.width,
    plotHeight: plotHeightFor(box.height),
    yLabels: ticks.map((t) => t.toFixed(2)),
    lastXLabel: bands[bands.length - 1]?.band ?? "",
  })
  const x = linearScale([400, 2300], [layout.plot.x0, layout.plot.x1])
  const y = linearScale([lo, hi * 1.06], [layout.plot.y1, layout.plot.y0])

  return (
    <div ref={host} className="relative min-h-0 w-full flex-1" style={{ minHeight: 200 }}>
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{
        position: "absolute",
        inset: 0,
        display: "block",
        fontFamily: "var(--font-sans)",
      }}
      role="img"
      aria-label={
        mode === "ratio"
          ? "Canopy over leaf reflectance, band by band"
          : "Unit-normalised spectra, which is what the angle compares"
      }
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={layout.plot.x0}
            x2={layout.plot.x1}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--hairline)"
            strokeWidth={0.5}
            strokeDasharray="2 5"
          />
          <text
            x={layout.plot.x0 - 6}
            y={y(t)}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {/*
        Unity, on the ratio panel. It is the whole argument: a flat line at one
        would mean the canopy is the leaf, a flat line anywhere would mean
        brightness -- which the angle ignores -- and what is drawn is neither.
      */}
      {mode === "ratio" && lo < 1 && hi > 1 && (
        <line
          x1={layout.plot.x0}
          x2={layout.plot.x1}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--accent-quiet)"
          strokeWidth={1}
        />
      )}
      <path
        d={`M${layout.plot.x0},${layout.plot.y0} L${layout.plot.x0},${layout.plot.y1} L${layout.plot.x1},${layout.plot.y1}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={STROKE.axis}
      />
      {other && (
        <polyline
          points={bands.map((b, i) => `${x(b.wavelength_nm)},${y(other[i])}`).join(" ")}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={STROKE.series}
          strokeDasharray="5 3"
        />
      )}
      <polyline
        points={bands.map((b, i) => `${x(b.wavelength_nm)},${y(values[i])}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE.series}
      />
      {bands.map((b, i) => (
        <g key={b.band}>
          <circle cx={x(b.wavelength_nm)} cy={y(values[i])} r={2.2} fill={stroke} />
          <text
            x={x(b.wavelength_nm)}
            y={layout.plot.y1 + ROW_PX.tick + TYPE.meta}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {b.band}
          </text>
        </g>
      ))}
      <text
        x={(layout.plot.x0 + layout.plot.x1) / 2}
        y={layout.height - 4}
        fontSize={TYPE.body}
        fill="var(--muted-foreground)"
        textAnchor="middle"
      >
        {mode === "ratio"
          ? "Canopy over leaf — flat would be brightness, which the angle ignores"
          : "Unit-normalised: the two vectors the angle is taken between"}
      </text>
    </svg>
    </div>
  )
}

/** Which reading the area is showing. Declared here, held per area. */
export type LibraryLimitMode = "distance" | "mechanism"

export function LibraryLimitEditor({
  runs,
  mode,
  surface,
  rover,
}: {
  runs: Array<{ id: string; label: string; result: PredictResult }>
  mode: LibraryLimitMode
  /** The studio surface a popover is portalled into and clamped inside. */
  surface: HTMLElement | null
  /**
   * The class the rover is pointing at, and the plane it came from.
   *
   * Pointing at a pixel names its class in the ranking and puts that class in
   * the mechanism pane, which is the question a reader has at exactly that
   * moment: this pixel is called Soybean, so how far is Soybean from the
   * soybean reference, and why.
   */
  rover?: { areaId: string; classId: number } | null
}) {
  const [runIdx, setRunIdx] = useState(0)
  const [notes, setNotes] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  const [band, setBand] = useState<"ratio" | "shape">("ratio")
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  const run = runs.length ? runs[Math.min(runIdx, runs.length - 1)] : undefined
  const limit = run?.result.library_limit ?? null

  /*
    What the reader chose here wins, then the rover.

    A class picked in the mechanism pane is a deliberate act and stays; the
    rover is a sweep. The rover only counts on the run it was taken over,
    because the same class id in another run is a different measurement.
  */
  const linked =
    rover && run && rover.areaId === run.id ? rover.classId : null
  const focus = pick ?? linked

  const colours = useMemo(() => {
    const ground = chartGround(theme)
    return new Map(
      (limit?.classes ?? []).map((c) => [c.class_id, legibleOn(c.color, ground)])
    )
  }, [limit, theme])

  if (!runs.length) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Pick a plane to measure its classes against a spectral library.
      </p>
    )
  }

  const shown = limit?.classes.find((c) => c.class_id === focus) ?? limit?.classes[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
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
        {limit && (
          <>
            <span className="telemetry ml-auto truncate text-meta text-muted-foreground">
              {limit.reference.material} · {limit.reference.n_spectra} spectra ·{" "}
              {limit.reference.source} · {limit.reference.level} level
            </span>
            {/*
              The caveat and the provenance, behind a button.

              Under the figures they were four lines of prose against three of
              chart, and prose that long beneath a figure is read once and
              scrolled past afterwards -- while the space it costs is paid on
              every look. What it says has not been softened: what a small
              angle does and does not mean is the reason this editor exists,
              and it is the first thing in the panel.

              StudioPopover with role="dialog", which that module already
              distinguishes from a menu: a panel of prose announced as a menu
              sends a screen reader looking for items that are not there.
            */}
            <StudioPopover
              open={notes}
              onOpenChange={setNotes}
              surface={surface}
              align="end"
              widthRem={22}
              role="dialog"
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  title="What this comparison can and cannot settle"
                  className={cn(
                    "shrink-0 rounded-sm p-0.5 transition-colors",
                    notes
                      ? "bg-accent-dim text-foreground"
                      : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                  )}
                >
                  <Info className="size-3.5" />
                </button>
              )}
            >
              <div className="flex flex-col gap-2 p-2 text-meta leading-snug">
                <p className="eyebrow !text-[9px]">
                  What a small angle means
                </p>
                <p className="text-muted-foreground">
                  It means the class is CONSISTENT with the reference, not that
                  the material is identified. The reference is{" "}
                  {limit.reference.level} level and a pixel is canopy, so the
                  two are not measurements of the same thing.
                </p>
                <p className="eyebrow !text-[9px]">Why the difference survives</p>
                <p className="text-muted-foreground">
                  Soil raises the red while gaps and shadow lower the NIR, in
                  opposite directions. A constant ratio would be brightness
                  alone and the angle would return zero; the shape is distorted
                  instead, and normalisation cannot remove it.
                </p>
                <p className="eyebrow !text-[9px]">The reference</p>
                <p className="text-muted-foreground">
                  {limit.reference.note} Package {limit.reference.package_id},
                  convolved onto the ESA Sentinel-2A response functions.
                  Measured on the {limit.scene_date} acquisition.
                </p>
              </div>
            </StudioPopover>
          </>
        )}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {!limit || !limit.classes.length || !shown ? (
          <p className="text-meta text-muted-foreground">
            This run carries no library comparison. It needs the spectral
            response, which runs saved before that measurement do not have.
          </p>
        ) : (
          <div className="flex h-full min-w-0 flex-col gap-3">
            {mode === "distance" ? (
              /*
                The ranking asks for the height its rows need and does not
                stretch: twelve classes in a short pane must scroll rather than
                be squeezed into twelve unreadable rows.
              */
              <div className="shrink-0">
                <AngleRanking
                  classes={limit.classes}
                  colours={colours}
                  focus={focus}
                  onFocus={setPick}
                />
              </div>
            ) : (
              /*
                The mechanism pane fills what is left, both ways: the class
                buttons and the caption take what they need and the figure
                takes the rest, so a taller pane is a taller plot rather than
                the same plot with space under it.
              */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
                  {/*
                    Which class, chosen here rather than in the header: the
                    header names the pane, and the class is the pane's subject
                    rather than a second mode of it.
                  */}
                  <div className="flex flex-wrap gap-0.5">
                    {limit.classes.map((c) => (
                      <button
                        key={c.class_id}
                        type="button"
                        /*
                          A pin, released by pressing it again. Without that,
                          one press stops the rover ever driving this pane
                          again and there is nothing on screen saying why.
                        */
                        onClick={() =>
                          setPick((prev) =>
                            prev === c.class_id ? null : c.class_id
                          )
                        }
                        className={cn(
                          "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                          shown.class_id === c.class_id
                            ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                            : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                        )}
                      >
                        <span
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: colours.get(c.class_id) }}
                        />
                        {c.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {(["ratio", "shape"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBand(m)}
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                          band === m
                            ? "bg-surface-raised text-foreground"
                            : "text-muted-foreground hover:bg-surface-raised/40"
                        )}
                      >
                        {m === "ratio" ? "Canopy / leaf" : "Normalised"}
                      </button>
                    ))}
                  </div>
                </div>
                <BandPanel
                  cls={shown}
                  stroke={colours.get(shown.class_id) ?? "#888888"}
                  mode={band}
                />
                {/*
                  One line, and only what the figure cannot state itself. The
                  argument behind it is under the info button, where it is read
                  once rather than costing four lines of height on every look.
                */}
                <p className="telemetry shrink-0 text-meta text-muted-foreground">
                  {pick === null && linked !== null ? "rover · " : ""}
                  {band === "ratio"
                    ? `${shown.name} · ${shown.angle_rad.toFixed(3)} rad from the reference`
                    : "solid: class · dashed: reference · both at unit length"}
                </p>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
