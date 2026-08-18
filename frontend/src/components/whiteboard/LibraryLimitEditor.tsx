/**
 * Each predicted class against a spectral library, and the limit that runs into.
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
import { TYPE, linearScale, niceTicks } from "@/lib/figure"
import { cn } from "@/lib/utils"

/** Each panel draws into its own box; the ratios between them are fixed. */
const RANK = { w: 700, h: 150, pad: { top: 8, right: 12, bottom: 30, left: 176 } }
const BAND = { w: 700, h: 210, pad: { top: 10, right: 12, bottom: 34, left: 52 } }

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
      style={{ width: "100%", height: "auto", fontFamily: "var(--font-sans)" }}
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
  const x = linearScale([400, 2300], [BAND.pad.left, BAND.w - BAND.pad.right])

  const values =
    mode === "ratio"
      ? bands.map((b) => b.ratio ?? 0)
      : bands.map((b) => b.unit_canopy ?? 0)
  const other =
    mode === "shape" ? bands.map((b) => b.unit_leaf ?? 0) : null
  const lo = Math.min(0, ...values, ...(other ?? []))
  const hi = Math.max(...values, ...(other ?? []))
  const y = linearScale([lo, hi * 1.06], [BAND.h - BAND.pad.bottom, BAND.pad.top])

  return (
    <svg
      viewBox={`0 0 ${BAND.w} ${BAND.h}`}
      style={{ width: "100%", height: "auto", fontFamily: "var(--font-sans)" }}
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
            x1={BAND.pad.left}
            x2={BAND.w - BAND.pad.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--hairline)"
            strokeWidth={0.5}
            strokeDasharray="2 5"
          />
          <text
            x={BAND.pad.left - 6}
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
          x1={BAND.pad.left}
          x2={BAND.w - BAND.pad.right}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--accent-quiet)"
          strokeWidth={1}
        />
      )}
      <path
        d={`M${BAND.pad.left},${BAND.pad.top} L${BAND.pad.left},${BAND.h - BAND.pad.bottom} L${BAND.w - BAND.pad.right},${BAND.h - BAND.pad.bottom}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={1}
      />
      {other && (
        <polyline
          points={bands.map((b, i) => `${x(b.wavelength_nm)},${y(other[i])}`).join(" ")}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.6}
          strokeDasharray="5 3"
        />
      )}
      <polyline
        points={bands.map((b, i) => `${x(b.wavelength_nm)},${y(values[i])}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
      />
      {bands.map((b, i) => (
        <g key={b.band}>
          <circle cx={x(b.wavelength_nm)} cy={y(values[i])} r={2.2} fill={stroke} />
          <text
            x={x(b.wavelength_nm)}
            y={BAND.h - BAND.pad.bottom + 13}
            fontSize={TYPE.meta}
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {b.band}
          </text>
        </g>
      ))}
      <text
        x={(BAND.pad.left + BAND.w - BAND.pad.right) / 2}
        y={BAND.h - 5}
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

export function LibraryLimitEditor({
  runs,
}: {
  runs: Array<{ id: string; label: string; result: PredictResult }>
}) {
  const [runIdx, setRunIdx] = useState(0)
  const [focus, setFocus] = useState<number | null>(null)
  const [mode, setMode] = useState<"ratio" | "shape">("ratio")
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
            <div>
              <p className="eyebrow mb-1">Distance to the reference</p>
              <AngleRanking
                classes={limit.classes}
                colours={colours}
                focus={focus}
                onFocus={setFocus}
              />
              {/*
                Stated on the figure, not left to the reader. Without it the
                ranking reads as an identification that happens to disagree
                with the classifier.
              */}
              <p className="text-meta text-muted-foreground">
                A small angle means the class is CONSISTENT with the reference,
                not that the material is identified. The reference is{" "}
                {limit.reference.level} level and a pixel is canopy, so the two
                are not measurements of the same thing.
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="eyebrow">
                  {mode === "ratio" ? "Why it survives" : "What the angle sees"} ·{" "}
                  {shown.name}
                </p>
                <div className="flex gap-0.5">
                  {(["ratio", "shape"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                        mode === m
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
                mode={mode}
              />
              <p className="text-meta text-muted-foreground">
                {mode === "ratio"
                  ? "Soil raises the red while gaps and shadow lower the NIR, in opposite directions. A constant ratio would be brightness alone and the angle would return zero; the shape is distorted instead, and normalisation cannot remove it."
                  : "Solid is the class, dashed the reference, both scaled to unit length. This is the pair the angle is taken between, so any separation visible here is separation the angle reports."}
              </p>
            </div>

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
