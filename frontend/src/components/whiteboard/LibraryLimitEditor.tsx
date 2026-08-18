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
import { useMemo, useState } from "react"
import { useTheme } from "next-themes"

import type { LibraryClass, PredictResult } from "@/lib/types"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn } from "@/lib/seriesColor"
import {
  FIGURE,
  PLOT,
  STROKE,
  TYPE,
  figureStyle,
  linearScale,
  niceTicks,
} from "@/lib/figure"
import { cn } from "@/lib/utils"

/*
  The band panels borrow the spectral editor's geometry rather than choosing
  their own.

  They draw the SAME seven bands, so a band has to land at the same x in both
  or a reader comparing the two figures is comparing two axes. Sharing FIGURE
  and PLOT also shares the plot's proportions: the first version was 700 by 210
  against the spectral figure's 700 by 340, and the same seven points spread
  across a panel two thirds as tall read as a zoomed-in version of the other.

  The ranking is not a band figure and keeps a box of its own -- its x axis is
  an angle and its rows are classes -- but at the same width, so the two stack
  without a step.
*/
const RANK = { w: FIGURE.width, h: 150, pad: { top: 8, right: 12, bottom: 30, left: 176 } }

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
  const max = Math.max(...classes.map((c) => c.angle_rad))
  const x = linearScale([0, max * 1.08], [RANK.pad.left, RANK.w - RANK.pad.right])
  const row = (RANK.h - RANK.pad.top - RANK.pad.bottom) / classes.length

  return (
    <svg
      viewBox={`0 0 ${RANK.w} ${RANK.h}`}
      style={figureStyle(RANK.w)}
      role="img"
      aria-label="Spectral angle from each predicted class to the library reference"
    >
      {niceTicks(0, max * 1.08, 5).map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={RANK.pad.top}
            y2={RANK.h - RANK.pad.bottom}
            stroke="var(--hairline)"
            strokeWidth={0.75}
            strokeDasharray="2 4"
          />
          <text
            x={x(t)}
            y={RANK.h - RANK.pad.bottom + 12}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      <text
        x={(RANK.pad.left + RANK.w - RANK.pad.right) / 2}
        y={RANK.h - 4}
        fontSize={TYPE.body}
        fill="var(--muted-foreground)"
        textAnchor="middle"
      >
        Spectral angle to the reference (radians) — smaller is more consistent
      </text>
      {classes.map((c, i) => {
        const y = RANK.pad.top + i * row + row / 2
        const stroke = colours.get(c.class_id) ?? "#888888"
        const dim = focus !== null && focus !== c.class_id
        return (
          <g
            key={c.class_id}
            opacity={dim ? 0.35 : 1}
            onMouseEnter={() => onFocus(c.class_id)}
            onMouseLeave={() => onFocus(null)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={0}
              y={y - row / 2}
              width={RANK.w}
              height={row}
              fill={focus === c.class_id ? "var(--accent-dim)" : "transparent"}
            />
            <text
              x={RANK.pad.left - 8}
              y={y}
              fontSize={TYPE.meta}
              fill="var(--foreground)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {c.name}
            </text>
            <rect
              x={RANK.pad.left}
              y={y - row * 0.22}
              width={Math.max(0, x(c.angle_rad) - RANK.pad.left)}
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
  const bands = cls.bands
  const x = linearScale([400, 2300], [PLOT.x0, PLOT.x1])

  const values =
    mode === "ratio"
      ? bands.map((b) => b.ratio ?? 0)
      : bands.map((b) => b.unit_canopy ?? 0)
  const other =
    mode === "shape" ? bands.map((b) => b.unit_leaf ?? 0) : null
  const lo = Math.min(0, ...values, ...(other ?? []))
  const hi = Math.max(...values, ...(other ?? []))
  const y = linearScale([lo, hi * 1.06], [PLOT.y1, PLOT.y0])

  return (
    <svg
      viewBox={`0 0 ${FIGURE.width} ${FIGURE.height}`}
      style={figureStyle()}
      role="img"
      aria-label={
        mode === "ratio"
          ? "Canopy over leaf reflectance, band by band"
          : "Unit-normalised spectra, which is what the angle compares"
      }
    >
      {niceTicks(lo, hi * 1.06, 4).map((t) => (
        <g key={t}>
          <line
            x1={PLOT.x0}
            x2={PLOT.x1}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--hairline)"
            strokeWidth={0.5}
            strokeDasharray="2 5"
          />
          <text
            x={PLOT.x0 - 6}
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
          x1={PLOT.x0}
          x2={PLOT.x1}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--accent-quiet)"
          strokeWidth={1}
        />
      )}
      <path
        d={`M${PLOT.x0},${PLOT.y0} L${PLOT.x0},${PLOT.y1} L${PLOT.x1},${PLOT.y1}`}
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
            y={PLOT.y1 + 15}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
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
        {mode === "ratio"
          ? "Canopy over leaf — flat would be brightness, which the angle ignores"
          : "Unit-normalised: the two vectors the angle is taken between"}
      </text>
    </svg>
  )
}

/** Which reading the area is showing. Declared here, held per area. */
export type LibraryLimitMode = "distance" | "mechanism"

export function LibraryLimitEditor({
  runs,
  mode,
}: {
  runs: Array<{ id: string; label: string; result: PredictResult }>
  mode: LibraryLimitMode
}) {
  const [runIdx, setRunIdx] = useState(0)
  const [focus, setFocus] = useState<number | null>(null)
  const [band, setBand] = useState<"ratio" | "shape">("ratio")
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  const run = runs.length ? runs[Math.min(runIdx, runs.length - 1)] : undefined
  const limit = run?.result.library_limit ?? null

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
          <span className="telemetry ml-auto truncate text-meta text-muted-foreground">
            {limit.reference.material} · {limit.reference.n_spectra} spectra ·{" "}
            {limit.reference.source} · {limit.reference.level} level
          </span>
        )}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {!limit || !limit.classes.length || !shown ? (
          <p className="text-meta text-muted-foreground">
            This run carries no library comparison. It needs the spectral
            response, which runs saved before that measurement do not have.
          </p>
        ) : (
          <div style={{ minWidth: RANK.w }} className="flex flex-col gap-3">
            {mode === "distance" ? (
              <div>
                <AngleRanking
                  classes={limit.classes}
                  colours={colours}
                  focus={focus}
                  onFocus={setFocus}
                />
                {/*
                  Stated on the figure, not left to the reader, and not left to
                  the other pane either: a reader who never opens the mechanism
                  still has to be told what the ranking does not mean.
                */}
                <p className="text-meta text-muted-foreground">
                  A small angle means the class is CONSISTENT with the
                  reference, not that the material is identified. The reference
                  is {limit.reference.level} level and a pixel is canopy, so the
                  two are not measurements of the same thing. Why the difference
                  survives is the other pane.
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
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
                        onClick={() => setFocus(c.class_id)}
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
                <p className="text-meta text-muted-foreground">
                  {band === "ratio"
                    ? `Soil raises the red while gaps and shadow lower the NIR, in opposite directions. A constant ratio would be brightness alone and the angle would return zero; the shape is distorted instead, and normalisation cannot remove it. ${shown.name} sits ${shown.angle_rad.toFixed(3)} rad from the reference.`
                    : "Solid is the class, dashed the reference, both scaled to unit length. This is the pair the angle is taken between, so any separation visible here is separation the angle reports."}
                </p>
              </div>
            )}

            <p className="text-[9px] leading-snug text-muted-foreground">
              {limit.reference.note} Package {limit.reference.package_id},
              convolved onto the ESA Sentinel-2A response functions. Measured on
              the {limit.scene_date} acquisition.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
