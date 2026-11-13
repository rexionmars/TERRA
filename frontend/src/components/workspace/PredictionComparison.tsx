/**
 * Two classifications read against each other: what differs between the runs,
 * where their maps agree, and how the class shares moved.
 */
import { useState } from "react"

import {
  AgreementDelta,
  BlockAgreementPair,
  ReferenceConfusionPair,
  SideTag,
} from "@/components/workspace/AgreementCharts"
import { PlotSwipeView } from "./PlotSwipeView"
import { FigureCard, ReadingSection, titled } from "@/components/workspace/readingParts"
import { cn } from "@/lib/utils"
import type { ClassMapCompare } from "@/lib/boardProbe"
import type { PredictResult } from "@/lib/types"
import { modelLabel } from "@/lib/runAssets"

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

/**
 * The two runs as they are, side by side: the map each drew, the area, the
 * model and the period. They were four lines of text each, and a reader
 * comparing two maps did not see either.
 */
function SideCards({
  sides,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
}) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pt-4 pb-4">
      {sides.map((s, i) => {
        const stats = [...(s.result.class_stats ?? [])].sort((x, y) => y.pct - x.pct)
        const top = stats[0]
        return (
          <div
            key={s.areaId + i}
            className="min-w-0 overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))]"
          >
            <div className="relative h-28 bg-[rgb(var(--p-sunk))]">
              <img
                src={s.uri}
                alt=""
                draggable={false}
                className={cn(
                  "size-full object-contain p-2",
                  (s.pixelated ?? true) && "[image-rendering:pixelated]"
                )}
              />
              <span className="absolute top-2 left-2">
                <SideTag letter={i === 0 ? "A" : "B"} />
              </span>
            </div>
            {stats.length > 0 && (
              <div aria-hidden className="flex h-1">
                {stats.map((c) => (
                  <span
                    key={c.class_id}
                    style={{ width: `${c.pct}%`, background: c.color }}
                  />
                ))}
              </div>
            )}
            <div className="px-3 pt-2 pb-2.5">
              <p className="truncate text-read font-medium text-foreground">
                {titled(s.label)}
              </p>
              <p className="truncate text-label text-muted-foreground">
                {s.model ? modelLabel(s.model) : "Classification"}
                {top ? ` · ${top.name} ${Math.round(top.pct)}%` : ""}
              </p>
              {s.period && (
                <p className="telemetry truncate text-meta text-muted-foreground">
                  {s.period}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * What differs between the two runs, and nothing that does not.
 *
 * A delta is uninterpretable without it. A run carries the area, the model and
 * the period a reader set, and also how many scenes it found, over what dates,
 * and which reference year it was scored against. The last matters most:
 * two runs measured against different MapBiomas years have an accuracy delta
 * that is partly the reference moving rather than the model.
 *
 * Only the differing rows are drawn, as a table of A against B: a list of six
 * facets of which five agree is five rows to check and discard.
 */
function WhatDiffers({ a, b }: { a: PredictionCompareSide; b: PredictionCompareSide }) {
  const span = (dates: string[] | null | undefined) =>
    dates?.length ? `${dates[0]} to ${dates[dates.length - 1]}` : null
  const reference = (s: PredictionCompareSide) =>
    s.result.lulc ? `${s.result.lulc.source} ${s.result.lulc.year}` : null

  const facets: { label: string; a: string | null; b: string | null }[] = [
    { label: "Area", a: titled(a.label), b: titled(b.label) },
    {
      label: "Model",
      a: a.model ? modelLabel(a.model) : null,
      b: b.model ? modelLabel(b.model) : null,
    },
    { label: "Period", a: a.period ?? null, b: b.period ?? null },
    { label: "Scenes", a: String(a.result.n_dates), b: String(b.result.n_dates) },
    { label: "Acquired", a: span(a.result.date_range), b: span(b.result.date_range) },
    { label: "Reference", a: reference(a), b: reference(b) },
  ]
  const differing = facets.filter((f) => f.a !== f.b)
  const shared = facets.filter((f) => f.a === f.b && f.a)

  return (
    <ReadingSection
      title="What differs"
      caption={
        shared.length
          ? `Same ${shared.map((f) => f.label.toLowerCase()).join(", ")} in both.`
          : undefined
      }
    >
      {differing.length === 0 ? (
        <p className="text-label text-muted-foreground">
          Nothing recorded differs between the two runs.
        </p>
      ) : (
        <table className="w-full table-fixed text-label">
          <thead>
            <tr>
              <th className="w-24" />
              <th className="pb-1.5 text-left font-normal">
                <SideTag letter="A" />
              </th>
              <th className="pb-1.5 text-left font-normal">
                <SideTag letter="B" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--p-line)/0.25)]">
            {differing.map((f) => (
              <tr key={f.label}>
                <td className="py-1.5 text-muted-foreground">{f.label}</td>
                <td className="truncate py-1.5 pr-2 text-foreground" title={f.a ?? ""}>
                  {f.a ?? "Not recorded"}
                </td>
                <td className="truncate py-1.5 text-foreground" title={f.b ?? ""}>
                  {f.b ?? "Not recorded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReadingSection>
  )
}

/** The rows of a matrix of class transitions, A's classes down and B's across. */
function TransitionMatrix({ compare }: { compare: ClassMapCompare }) {
  const { legendA, legendB, transitions } = compare
  if (!legendA.length || !legendB.length || !transitions.length) return null
  const max = Math.max(1, ...transitions.flat())
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-meta">
        <thead>
          <tr>
            <th className="pb-1 text-left font-normal">
              <span className="text-meta text-muted-foreground">A down, B across</span>
            </th>
            {legendB.map((c) => (
              <th key={c.id} className="p-0 font-normal" title={`B: ${c.name}`}>
                <span
                  className="mx-auto block size-3 rounded-xs"
                  style={{ backgroundColor: c.color }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transitions.map((row, i) => (
            <tr key={legendA[i]?.id ?? i}>
              <th
                className="max-w-[9rem] pr-2 text-left font-normal"
                title={legendA[i]?.name}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: legendA[i]?.color }}
                  />
                  <span className="truncate text-label text-foreground">
                    {legendA[i]?.name}
                  </span>
                </span>
              </th>
              {row.map((cell, j) => {
                const diag = legendA[i]?.id != null && legendA[i]?.id === legendB[j]?.id
                const t = cell / max
                return (
                  <td key={j} className="p-0">
                    <div
                      className={cn(
                        "telemetry flex h-7 min-w-7 items-center justify-center rounded-xs px-1",
                        diag && "ring-1 ring-[rgb(var(--p-text)/0.7)]"
                      )}
                      style={{
                        background:
                          cell > 0
                            ? `rgb(var(--p-accent) / ${0.15 + t * 0.65})`
                            : "rgb(var(--p-line) / 0.1)",
                      }}
                      title={`${legendA[i]?.name ?? "?"} in A, ${legendB[j]?.name ?? "?"} in B: ${cell.toLocaleString()} px`}
                    >
                      <span
                        className={t > 0.55 ? "text-background" : "text-foreground"}
                      >
                        {cell > 0 ? cell.toLocaleString() : "·"}
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
  )
}

/*
  THE SHARES OF EACH CLASS, A AND B, AS TWO BARS. They were a signed figure
  per class in green or red, which said a class growing was good and one
  shrinking bad: neither is, since a share is what the ground holds and not a
  score. The bars are in the class's own colour, A's lighter above B's, and the
  change is given in neutral type beside both values.

  Over the UNION of the two legends, in A's order and then what only B has: a
  class absent from a raster has a share of zero, so its change is a real
  figure in either direction.
*/
function ShareBars({ a, b }: { a: PredictionCompareSide; b: PredictionCompareSide }) {
  const statsA = a.result.class_stats ?? []
  const statsB = b.result.class_stats ?? []
  const byIdA = new Map(statsA.map((c) => [c.class_id, c]))
  const byIdB = new Map(statsB.map((c) => [c.class_id, c]))
  const rows = [
    ...statsA.map((c) => ({ id: c.class_id, name: c.name, color: c.color })),
    ...statsB
      .filter((c) => !byIdA.has(c.class_id))
      .map((c) => ({ id: c.class_id, name: c.name, color: c.color })),
  ].map((c) => {
    const pa = byIdA.get(c.id)?.pct ?? 0
    const pb = byIdB.get(c.id)?.pct ?? 0
    return { ...c, pa, pb, delta: pb - pa }
  })
  rows.sort((x, y) => Math.max(y.pa, y.pb) - Math.max(x.pa, x.pb))

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-label">
            <span
              className="size-2.5 shrink-0 translate-y-px rounded-xs"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
            <span className="telemetry shrink-0 text-meta text-muted-foreground tabular-nums">
              {r.pa.toFixed(1)}% → {r.pb.toFixed(1)}%
            </span>
            <span className="telemetry w-16 shrink-0 text-right text-meta text-foreground tabular-nums">
              {Math.abs(r.delta) < 0.05
                ? "same"
                : `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta).toFixed(1)} pp`}
            </span>
          </div>
          {(["A", "B"] as const).map((letter) => {
            const pct = letter === "A" ? r.pa : r.pb
            return (
              <div key={letter} className="flex items-center gap-2 pl-[1.125rem]">
                <span className="telemetry w-2 text-micro text-muted-foreground">
                  {letter}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--p-line)/0.15)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      background: r.color,
                      opacity: letter === "A" ? 0.55 : 1,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </li>
      ))}
    </ul>
  )
}

function PredictionCompareBody({
  sides,
  compare,
  compareError,
  apart,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
  compare: ClassMapCompare | null
  compareError: string | null
  apart: boolean
}) {
  /*
    THE SHARED COLOUR DOMAIN, and why there is no control for it. Two rasters
    side by side are comparable by eye only if they share a colour mapping.
    That is met at the source: class rasters take their colour from a fixed map
    keyed by class id (sidecar/class_palette.py), and the confidence and NDVI
    rasters clip to [0, 1] over that absolute domain. The one per-instance
    scale was the confusion grids', reconciled in ReferenceConfusionPair
    against 0..100.
  */
  const [a, b] = sides
  const [swipe, setSwipe] = useState(0.5)
  const agreementA = a.result.lulc?.agreement ?? null
  const agreementB = b.result.lulc?.agreement ?? null
  const hasShares = !!a.result.class_stats?.length && !!b.result.class_stats?.length

  return (
    <div className="flex flex-col">
      <SideCards sides={sides} />

      <WhatDiffers a={a} b={b} />

      {/*
        WHERE THE TWO COVER THE SAME GROUND, the pixels are paired: how many
        agree, the swipe, and where A's classes went in B. The swipe sits beside
        the figures it is read against; it is offered only on one grid, since
        sliding one footprint over another invites reading a difference that is
        only two different fields.
      */}
      {compare && (
        <ReadingSection
          title="Pixel by pixel"
          caption="The two cover the same ground, so each pixel of A is set against the same pixel of B."
        >
          <div className="grid grid-cols-2 gap-2">
            <FigureCard
              label="Agree"
              value={`${compare.pct.toFixed(1)}%`}
              sub={`${compare.same.toLocaleString()} of ${compare.shared.toLocaleString()} px`}
            />
            <FigureCard
              label="Differ"
              value={`${(100 - compare.pct).toFixed(1)}%`}
              sub="same ground, other class"
            />
          </div>
          <div
            className="mt-3 h-[18rem] min-h-0 w-full overflow-hidden rounded-md"
            style={{ background: "var(--s-card)" }}
          >
            <PlotSwipeView
              left={{
                id: "a",
                title: titled(a.label),
                uri: a.uri,
                exportPngName: "",
                pixelated: a.pixelated ?? true,
              }}
              right={{
                id: "b",
                title: titled(b.label),
                uri: b.uri,
                exportPngName: "",
                pixelated: b.pixelated ?? true,
              }}
              ratio={swipe}
              onRatioChange={setSwipe}
            />
          </div>
          <div className="mt-4">
            <TransitionMatrix compare={compare} />
          </div>
        </ReadingSection>
      )}

      {/*
        WHERE THE TWO COVER DIFFERENT GROUND, which is every comparison of two
        areas, their pixels cannot be paired, and the reading says so in words
        rather than in the grid sizes it was told. What can be compared is each
        run against the reference, which needs no shared pixel.
      */}
      {!compare && apart && agreementA && agreementB && (
        <ReadingSection
          title="Against the reference"
          caption="Different areas, so their pixels cannot be set against each other. Each run is read against MapBiomas instead: a row is a reference class, and its cells are the share of it each run called each class."
        >
          <ReferenceConfusionPair
            a={agreementA}
            b={agreementB}
            labelA={titled(a.label)}
            labelB={titled(b.label)}
          />
        </ReadingSection>
      )}
      {!compare && apart && !(agreementA && agreementB) && (
        <ReadingSection title="Different areas">
          <p className="text-label text-muted-foreground">
            The two cover different ground, so their pixels cannot be set against each
            other, and at least one was not measured against a reference. Their class
            shares are compared below.
          </p>
        </ReadingSection>
      )}
      {compareError && (
        <ReadingSection title="Not compared">
          <p className="text-label text-muted-foreground">{compareError}</p>
        </ReadingSection>
      )}

      {/*
        Which of the two gets a class right, the question a reader opens this
        reading to ask. Offered wherever both were measured, same ground or not.
      */}
      {agreementA && agreementB && (
        <ReadingSection
          title="Accuracy, B against A"
          caption="Both measured against MapBiomas. Changes are B minus A, in percentage points; a class's change shows both values on hover."
        >
          <AgreementDelta
            a={agreementA}
            b={agreementB}
            labelA={titled(a.label)}
            labelB={titled(b.label)}
          />
        </ReadingSection>
      )}

      {agreementA?.blocks && agreementB?.blocks && (
        <ReadingSection title="Agreement by block">
          <BlockAgreementPair
            a={agreementA}
            b={agreementB}
            labelA={titled(a.label)}
            labelB={titled(b.label)}
          />
        </ReadingSection>
      )}

      {hasShares && (
        <ReadingSection
          title="Class shares"
          caption="How much of each area each class covers, A's bar above B's."
        >
          <ShareBars a={a} b={b} />
        </ReadingSection>
      )}

      {/*
        Domain shift is not here: drawn inside this reading it lost the
        histogram and the t-SNE that justify it. It is a node of its own on the
        Compare board, read whole.
      */}
    </div>
  )
}

/** What two class maps say against each other, filling whatever it is given. */
export function PredictionComparison({
  sides,
  compare,
  compareError,
  apart = false,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
  compare: ClassMapCompare | null
  compareError: string | null
  /** The two rasters are not one grid: two areas, compared through the reference. */
  apart?: boolean
}) {
  return (
    <div className="panel-scroll h-full w-full overflow-auto pb-6">
      <PredictionCompareBody
        sides={sides}
        compare={compare}
        compareError={compareError}
        apart={apart}
      />
    </div>
  )
}
