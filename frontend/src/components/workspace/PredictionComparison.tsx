/**
 * Two classifications read against each other: what differs between the runs,
 * where their maps agree, and how the class shares moved.
 */
import { useState } from "react"
import { WaterFigure } from "@/components/analysisPrimitives"
import {
  AgreementDelta,
  BlockAgreementPair,
  ReferenceConfusionPair,
} from "@/components/workspace/AgreementCharts"
import { PlotSwipeView } from "./PlotSwipeView"
import { cn } from "@/lib/utils"
import type { ClassMapCompare } from "@/lib/boardProbe"
import type { ModelKind, PredictResult } from "@/lib/types"
import { modelLabel } from "@/lib/runAssets"

function CompactMatrix({
  title = "Confusion matrix",
  rowLabel = "Rows = reference",
  colLabel = "columns = predicted",
  rowClasses,
  colClasses,
  matrix,
}: {
  title?: string
  rowLabel?: string
  colLabel?: string
  rowClasses: { id: number; name: string; color: string }[]
  colClasses: { id: number; name: string; color: string }[]
  matrix: number[][]
}) {
  if (!rowClasses.length || !colClasses.length || !matrix.length) return null
  const max = Math.max(1, ...matrix.flat())
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow !text-micro">{title}</p>
        <p className="text-meta leading-snug text-muted-foreground">
          {rowLabel} · {colLabel}
        </p>
      </div>
      <div
        className="overflow-x-auto rounded-sm border p-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
      >
        <table className="w-full border-separate border-spacing-0.5 text-micro">
          <thead>
            <tr>
              <th className="p-0.5" />
              {colClasses.map((c) => (
                <th key={c.id} className="p-0.5 font-normal" title={c.name}>
                  <span
                    className="mx-auto flex size-3.5 items-center justify-center rounded-xs text-micro text-white"
                    style={{ backgroundColor: c.color }}
                  >
                    {c.id}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={rowClasses[i]?.id ?? i}>
                <th className="p-0.5 text-left font-normal" title={rowClasses[i]?.name}>
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2.5 shrink-0 rounded-xs"
                      style={{ backgroundColor: rowClasses[i]?.color }}
                    />
                    <span className="telemetry text-muted-foreground">
                      {rowClasses[i]?.id}
                    </span>
                  </span>
                </th>
                {row.map((cell, j) => {
                  const diag =
                    rowClasses[i]?.id != null && rowClasses[i]?.id === colClasses[j]?.id
                  const t = cell / max
                  return (
                    <td key={j} className="p-0">
                      <div
                        className={cn(
                          "telemetry flex min-h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-xs px-0.5",
                          diag && "ring-1 ring-primary/50"
                        )}
                        style={{
                          background:
                            cell > 0
                              ? `rgb(var(--p-accent) / ${0.15 + t * 0.65})`
                              : "rgb(var(--p-line) / 0.08)",
                        }}
                        title={`${rowClasses[i]?.name ?? "?"} → ${colClasses[j]?.name ?? "?"}: ${cell.toLocaleString()}`}
                      >
                        <span
                          className={cn(
                            "telemetry",
                            t > 0.55 ? "text-background" : "text-foreground"
                          )}
                        >
                          {cell > 0 ? cell : "·"}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * What differs between the two runs, and nothing that does not.
 *
 * A delta is uninterpretable without it. The identity blocks named the area,
 * the model and the period, which is what a reader would have set deliberately
 * -- but a run also carries how many scenes it found, over what dates, and
 * which reference year it was scored against, and none of those were on screen.
 * The last one matters most and is the easiest to miss: two runs measured
 * against different MapBiomas years have an accuracy delta that is partly the
 * reference moving rather than the model, and nothing said so.
 *
 * Only the differing rows are drawn. A list of six facets of which five agree
 * is five rows asking to be checked and discarded; what a reader needs is the
 * short list of things that are not the same. This is the device QGIS's
 * Processing History supplies for expensive asynchronous work -- and a TERRA
 * run costs minutes and quota, so re-running one to find out what it used is
 * not a way of asking.
 */
function WhatDiffers({ a, b }: { a: PredictionCompareSide; b: PredictionCompareSide }) {
  const span = (dates: string[] | null | undefined) =>
    dates?.length ? `${dates[0]} – ${dates[dates.length - 1]}` : null
  const reference = (s: PredictionCompareSide) =>
    s.result.lulc ? `${s.result.lulc.source} ${s.result.lulc.year}` : null

  const facets: { label: string; a: string | null; b: string | null }[] = [
    { label: "Area", a: a.label, b: b.label },
    {
      label: "Model",
      a: a.model ? modelLabel(a.model as ModelKind) : null,
      b: b.model ? modelLabel(b.model as ModelKind) : null,
    },
    { label: "Period", a: a.period ?? null, b: b.period ?? null },
    {
      label: "Scenes",
      a: String(a.result.n_dates),
      b: String(b.result.n_dates),
    },
    { label: "Acquired", a: span(a.result.date_range), b: span(b.result.date_range) },
    { label: "Reference", a: reference(a), b: reference(b) },
  ]
  const differing = facets.filter((f) => f.a !== f.b)
  if (!differing.length) return null

  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow !text-micro">What differs</p>
      <ul className="flex flex-col gap-0.5">
        {differing.map((f) => (
          <li key={f.label} className="flex flex-col">
            <span className="telemetry text-micro text-muted-foreground">
              {f.label}
            </span>
            <span
              className="truncate text-meta text-foreground"
              title={`${f.a ?? "—"} → ${f.b ?? "—"}`}
            >
              {f.a ?? "—"} <span className="text-muted-foreground">&rarr;</span>{" "}
              {f.b ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface PredictionCompareSide {
  areaId: string
  label: string
  model?: string | null
  period?: string | null
  result: PredictResult
  uri: string
  /** Class maps are drawn unfiltered; a bilinear sample invents a class. */
  pixelated?: boolean
}

function PredictionCompareBody({
  sides,
  compare,
  compareError,
  compact = false,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
  compare: ClassMapCompare | null
  compareError: string | null
  compact?: boolean
}) {
  /*
    THE SHARED COLOUR DOMAIN, and why there is no control for it.

    Two rasters set side by side are not comparable by eye unless they share a
    colour mapping: rescaled each to its own range, one presents two different
    values in the same colour, and the reading is confident and wrong. It is
    the precondition the design record raises against every side-by-side
    arrangement, and ParaView's answer -- a transfer function decoupled from
    the view, with rescaling stated rather than implicit -- is the mechanism it
    asks for.

    Checked against what this editor actually draws, and it is already met at
    the source rather than needing a control here:

      - Class rasters take their colour from `MAPBIOMAS_COLORS` in
        `sidecar/class_palette.py`, a fixed map keyed by class id. The same
        class is the same colour in every run by construction.
      - `write_confidence_png` and `write_ndvi_mean_png` clip to [0, 1] and ramp
        over that absolute domain. Neither is rescaled to the run's own range.

    So a basis selector here would be chrome for a condition this application
    does not produce, and the geometric budget is the reason that matters: at
    the 1000x700 minimum the chrome already takes half the width. The one place
    a per-instance scale did exist was the confusion grids, which shaded against
    their own maxima -- reconciled in `ReferenceConfusionPair` against 0..100
    and said on screen, since a reconciliation a reader cannot see is one they
    cannot check.
  */
  const [a, b] = sides
  // Where the divider stands. Local, because it is a way of looking rather
  // than a property of either raster.
  const [swipe, setSwipe] = useState(0.5)
  const statsA = a.result.class_stats ?? []
  const statsB = b.result.class_stats ?? []
  // Present only where the run was measured against a reference; a run with no
  // MapBiomas cells behind it has nothing to be more or less accurate than.
  const agreementA = a.result.lulc?.agreement ?? null
  const agreementB = b.result.lulc?.agreement ?? null

  /*
    The share delta over the UNION of the two legends, not over A's.

    Iterating A alone drops a class B found and A did not, which is the finding
    the row would have carried. `AgreementDelta` was made to keep those rows for
    that reason and this list, in the same panel, was still discarding them.

    Absence means something different here than it does there, though, and the
    two are not fixed the same way. `per_class` absent is NOT MEASURED, so its
    delta is unknown and the row says `only B`. `class_stats` absent is a share
    of ZERO -- the class is not in the raster -- so the delta is a real figure in
    both directions: -pct for a class only A has, +pct for one only B has.
  */
  const byIdA = new Map(statsA.map((c) => [c.class_id, c]))
  const byIdB = new Map(statsB.map((c) => [c.class_id, c]))
  const shareRows = [
    ...statsA.map((ca) => ({
      classId: ca.class_id,
      name: ca.name,
      color: ca.color,
      delta: (byIdB.get(ca.class_id)?.pct ?? 0) - ca.pct,
    })),
    // A's order first, so a reader who knows one legend still reads it in the
    // order they know; what only B has lands after it rather than interleaved.
    ...statsB
      .filter((cb) => !byIdA.has(cb.class_id))
      .map((cb) => ({
        classId: cb.class_id,
        name: cb.name,
        color: cb.color,
        delta: cb.pct,
      })),
  ]

  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "min-w-max flex-row items-start" : "flex-col"
      )}
    >
      <div className={cn("flex flex-col gap-2", compact && "w-[14rem] shrink-0")}>
        <p className="eyebrow !text-micro">Prediction difference</p>
        <p className="text-meta leading-snug text-muted-foreground">
          Two prediction planes in the selection path. Shared pixels are compared
          class-to-class; the matrix is how A’s labels land on B’s.
        </p>

        <div className="flex flex-col gap-2">
          {[a, b].map((s, i) => (
            <div key={s.areaId + i} className="flex flex-col gap-0.5">
              <p className="telemetry text-micro text-muted-foreground">
                {i === 0 ? "A" : "B"} · {s.label}
              </p>
              <p className="truncate text-meta text-foreground">
                {s.model ? modelLabel(s.model as ModelKind) : "Classification"}
              </p>
              {s.period && (
                <p className="telemetry truncate text-micro text-muted-foreground">
                  {s.period}
                </p>
              )}
            </div>
          ))}
        </div>

        <WhatDiffers a={a} b={b} />

        {compareError && (
          <p className="text-meta leading-snug text-muted-foreground">{compareError}</p>
        )}

        {compare && (
          <div className="grid grid-cols-2 gap-2">
            <WaterFigure
              label="Agreement"
              value={`${compare.pct.toFixed(1)}%`}
              sub={`${compare.same.toLocaleString()} / ${compare.shared.toLocaleString()} px`}
            />
            <WaterFigure
              label="Differ"
              value={`${(100 - compare.pct).toFixed(1)}%`}
              sub="same ground, other class"
            />
          </div>
        )}
      </div>

      {/*
        THE SWIPE, where the two cover the same ground.

        It lived in a dialog that covered the board the arrow was pointing at,
        which is the contradiction the compare editor was made to end. Here it
        sits beside what it is being read against: slide it and the figures to
        its right do not move.

        Only with `compare`, which is non-null exactly when the two rasters
        share a grid -- sliding one footprint over another puts unrelated
        pixels in one rectangle and invites reading a difference that is only
        two different fields.
      */}
      {compare && (
        <div
          className={cn(
            "min-h-0 overflow-hidden rounded-sm",
            compact ? "aspect-[4/3] h-full shrink-0" : "h-[18rem] w-full"
          )}
          style={{ background: "var(--s-card)" }}
        >
          <PlotSwipeView
            left={{
              id: "a",
              title: sides[0].label,
              uri: sides[0].uri,
              exportPngName: "",
              pixelated: sides[0].pixelated ?? true,
            }}
            right={{
              id: "b",
              title: sides[1].label,
              uri: sides[1].uri,
              exportPngName: "",
              pixelated: sides[1].pixelated ?? true,
            }}
            ratio={swipe}
            onRatioChange={setSwipe}
          />
        </div>
      )}

      {/*
        WHERE THE TWO COVER DIFFERENT GROUND, which is every comparison of two
        areas: each run's own confusion against the reference, side by side.

        This slot used to hold the transition matrix or, failing that, the
        sentence saying why it could not run -- and the failing case is the one
        the studio exists for. The two readings are not alternatives dressed as
        one: A-to-B says where A's labels went in B and needs shared pixels;
        this says where each run's labels went against ground and needs none.
      */}
      {!compare && agreementA && agreementB && (
        <div className={cn(compact && "shrink-0")}>
          <ReferenceConfusionPair
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {compare && (
        <div className={cn(compact && "shrink-0")}>
          <CompactMatrix
            title="Class transitions"
            rowLabel="Rows = A"
            colLabel="columns = B"
            rowClasses={compare.legendA.map((e) => ({
              id: e.id,
              name: e.name,
              color: e.color,
            }))}
            colClasses={compare.legendB.map((e) => ({
              id: e.id,
              name: e.name,
              color: e.color,
            }))}
            matrix={compare.transitions}
          />
        </div>
      )}

      {/*
        Which of the two gets a class right, which is the question a reader
        opens this editor to ask and the one nothing here answered. Both runs
        already carried it: a producer's and a user's accuracy per class,
        measured against MapBiomas. Reading them against each other meant
        opening one run, remembering, and opening the other.

        Offered wherever BOTH were measured, same ground or not: two areas
        classified by one model is exactly the comparison this studio exists
        for, and it needs no shared pixels.
      */}
      {agreementA && agreementB && (
        <div className={cn(compact && "w-[16rem] shrink-0")}>
          <AgreementDelta
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {/*
        Offered whether or not the grids match: a block breakdown is computed
        inside each run against its own reference, so it needs no shared pixel
        -- the same property that makes the confusion pair work for two areas.
      */}
      {agreementA && agreementB && (
        <div className={cn(compact && "shrink-0")}>
          <BlockAgreementPair
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {statsA.length > 0 && statsB.length > 0 && (
        <div className={cn("flex flex-col gap-1.5", compact && "w-[12rem] shrink-0")}>
          <p className="eyebrow !text-micro">Share delta (A → B)</p>
          <ul className="flex flex-col gap-1">
            {shareRows.map((r) => (
              <li key={r.classId} className="flex items-center gap-2 text-meta">
                <span
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: r.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {r.name}
                </span>
                <span
                  className={cn(
                    "telemetry shrink-0",
                    r.delta > 0.05
                      ? "text-emerald-400"
                      : r.delta < -0.05
                        ? "text-rose-400"
                        : "text-foreground"
                  )}
                >
                  {r.delta > 0 ? "+" : ""}
                  {r.delta.toFixed(1)} pp
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Domain shift is not here any more. Under `compact` this band drew four
        figures and withheld the histogram and the t-SNE that justify the
        analysis -- they need width, and this band is what is left of the row
        after a 15rem column. It moved to the compare modal, whole.

        What stays in the band is what the band is for: the A-to-B relation.
        Composition delta above, class transitions below.
      */}
    </div>
  )
}

/** What two class maps say against each other, filling whatever it is given. */
export function PredictionComparison({
  sides,
  compare,
  compareError,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
  compare: ClassMapCompare | null
  compareError: string | null
}) {
  return (
    <div className="panel-scroll h-full w-full overflow-auto px-2 py-1.5">
      <PredictionCompareBody
        sides={sides}
        compare={compare}
        compareError={compareError}
        compact
      />
    </div>
  )
}
