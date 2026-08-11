/**
 * Two linked rasters, read against each other.
 *
 * ONE PREDICATE DECIDES WHAT THIS CAN BE, and it is whether the two cover the
 * same ground.
 *
 * Same ground is the comparison worth having: one AOI classified by two models,
 * or over two periods, or against its reference. A swipe there is the question
 * "which of these two calls this field right" asked of the pixels rather than
 * of a summary statistic, and the agreement figure is the same question
 * counted. That is what the board's arrows are for.
 *
 * Different ground makes a swipe meaningless. Two AOIs are two places; sliding
 * one footprint over another under a clip-path puts unrelated pixels in the
 * same rectangle and invites reading a difference that is only two different
 * fields. So it is not offered. What IS comparable between two places is what
 * each is made of, so that is shown instead: the two compositions side by side.
 *
 * The refusals are stated rather than silent, because "no answer, and here is
 * why" is information and a number computed anyway is not.
 */
import { useEffect, useRef, useState } from "react"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { PlotSwipeView } from "@/components/AnalysisPlotModal"
import { classIndexFor, type ClassLegendEntry } from "@/lib/classMask"
import type { LayerLegend } from "@/lib/layerLegend"

export interface CompareSide {
  /** Area and layer, so a title can say which stack it came from. */
  areaTitle?: string
  layerTitle: string
  uri: string
  pixelated: boolean
  legend: LayerLegend
  /** Pixel width and height are not known until the raster is decoded. */
  extentKey: string
}

/** A legend usable for counting: named classes with colours that invert. */
function classesOf(legend: LayerLegend): ClassLegendEntry[] | null {
  if (legend?.kind !== "classes") return null
  const entries = legend.entries
    .map((e, i) => ({ id: i, name: e.name, color: e.color }))
    .filter((e) => /^#?[0-9a-f]{6}$/i.test(e.color))
  return entries.length ? entries : null
}

type Agreement =
  | { state: "off"; why: string }
  | { state: "working" }
  | { state: "failed"; why: string }
  | {
      state: "done"
      shared: number
      same: number
      /** Share of pixels classified on BOTH that carry the same class. */
      pct: number
    }

export function BoardCompareModal({
  from,
  to,
  onClose,
}: {
  from: CompareSide
  to: CompareSide
  onClose: () => void
}) {
  const [ratio, setRatio] = useState(0.5)
  /*
    The whole modal turns on this. The extent, not the pixel count: two
    different areas can be rastered at the same size, and two runs of ONE area
    -- the case this exists for -- carry the same extent whatever model made
    them.
  */
  const sameGround = from.extentKey === to.extentKey
  const [agreement, setAgreement] = useState<Agreement>({ state: "working" })

  /*
    Through a ref, because `legendFor` builds a fresh object every render and a
    fresh object is a fresh dependency -- the effect would run on every render
    and each run sets state, which renders. The uris identify the rasters, and
    a legend is a pure function of the same payload its uri came from, so the
    uri is the sound thing to watch.
  */
  const legendsRef = useRef({ from: from.legend, to: to.legend })
  legendsRef.current = { from: from.legend, to: to.legend }

  useEffect(() => {
    let live = true
    const fromClasses = classesOf(legendsRef.current.from)
    const toClasses = classesOf(legendsRef.current.to)
    /*
      Same ground first. Two AOIs are two places, and an agreement between them
      counts nothing -- the check is the extent, not the pixel count, because
      two different areas can happen to be rastered at the same size.
    */
    if (!sameGround) {
      setAgreement({
        state: "off",
        why: "Two places, so neither a swipe nor an agreement: sliding one footprint over another puts unrelated pixels in one rectangle, and counting matches between them counts pixels that are not the same ground. What each is made of is set side by side instead.",
      })
      return
    }
    if (!fromClasses || !toClasses) {
      setAgreement({
        state: "off",
        why: "Agreement is counted between class maps. At least one of these is a continuous raster, where two values are near rather than equal.",
      })
      return
    }

    setAgreement({ state: "working" })
    Promise.all([
      classIndexFor(from.uri, fromClasses),
      classIndexFor(to.uri, toClasses),
    ])
      .then(([a, b]) => {
        if (!live) return
        if (a.unmatched > 0 || b.unmatched > 0) {
          setAgreement({
            state: "failed",
            why: `A legend does not explain its raster: ${
              a.unmatched + b.unmatched
            } pixels match no class. Counting agreement against it would be counting against the wrong table.`,
          })
          return
        }
        if (a.width !== b.width || a.height !== b.height) {
          setAgreement({
            state: "failed",
            why: `Same ground, different grids: ${a.width}x${a.height} against ${b.width}x${b.height}. Pairing them by index would compare pixels that are not the same place.`,
          })
          return
        }
        /*
          Counted over pixels classified on BOTH. A pixel outside one AOI's
          mask is not a disagreement -- it is an absence, and folding it in
          would report a run as wrong for the shape of its own footprint.

          The class ORDINALS are compared, which is why this needs the two
          legends to be the same table. They are: both sides are class maps of
          one area, so the legend that travelled with the run describes both.
        */
        let shared = 0
        let same = 0
        for (let i = 0; i < a.index.length; i++) {
          const x = a.index[i]
          const y = b.index[i]
          if (x === 255 || y === 255) continue
          shared++
          if (x === y) same++
        }
        setAgreement({
          state: "done",
          shared,
          same,
          pct: shared ? (same / shared) * 100 : 0,
        })
      })
      .catch((err: unknown) => {
        if (!live) return
        setAgreement({
          state: "failed",
          why: err instanceof Error ? err.message : "The rasters could not be read.",
        })
      })
    return () => {
      live = false
    }
  }, [from.uri, to.uri, sameGround])

  const label = (s: CompareSide) =>
    s.areaTitle ? `${s.layerTitle} · ${s.areaTitle}` : s.layerTitle

  return (
    <ModalShell
      onDismiss={onClose}
      label="Compare two rasters"
      className="w-[min(72rem,92vw)]"
    >
      <ModalHeader
        eyebrow="Compare"
        title={`${label(from)}  →  ${label(to)}`}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {!sameGround ? (
          /*
            No swipe across two places. What each is MADE of is comparable, so
            the two compositions run side by side -- and where a side is not a
            class map there is nothing to list, which the block says.
          */
          <div className="grid max-h-[min(58vh,34rem)] grid-cols-2 gap-4 overflow-auto">
            {[from, to].map((s, i) => (
              <div key={i} className="flex min-w-0 flex-col gap-2">
                <p className="eyebrow !text-[9px] truncate">{label(s)}</p>
                {s.legend?.kind === "classes" ? (
                  <ul className="flex flex-col gap-1">
                    {s.legend.entries.map((e) => (
                      <li
                        key={`${e.name}-${e.color}`}
                        className="flex items-center gap-2"
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{
                            background: e.color,
                            boxShadow:
                              "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.5)",
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                          {e.name}
                        </span>
                        {e.areaHa !== undefined && (
                          <span className="telemetry shrink-0 text-[9px] text-muted-foreground/70">
                            {e.areaHa.toFixed(0)} ha
                          </span>
                        )}
                        {e.pct !== undefined && (
                          <span className="telemetry w-14 shrink-0 text-right text-meta text-foreground">
                            {e.pct.toFixed(1)}%
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-meta text-muted-foreground">
                    Not a class map, so there is no composition to set beside
                    the other.
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          /*
            An explicit height, not flex-1. ModalShell sizes to its content, so
            a child asking for "one share of the remaining space" was asking for
            a share of nothing and collapsed to zero -- the modal opened with
            its agreement line and no swipe above it. The images are
            object-contain, so this box decides how large they are drawn.
          */
          <div className="h-[min(58vh,34rem)] min-h-0 overflow-hidden rounded-md bg-surface">
          <PlotSwipeView
            left={{
              id: "from",
              title: label(from),
              uri: from.uri,
              exportPngName: "",
              pixelated: from.pixelated,
            }}
            right={{
              id: "to",
              title: label(to),
              uri: to.uri,
              exportPngName: "",
              pixelated: to.pixelated,
            }}
            ratio={ratio}
            onRatioChange={setRatio}
          />
        </div>
        )}

        <div className="flex items-start gap-4">
          <div className="flex shrink-0 flex-col gap-0.5">
            <span className="eyebrow !text-[9px]">Agreement</span>
            <span className="telemetry text-heading text-foreground">
              {agreement.state === "done"
                ? `${agreement.pct.toFixed(1)}%`
                : agreement.state === "working"
                  ? "…"
                  : "—"}
            </span>
          </div>
          <p className="min-w-0 flex-1 text-meta leading-snug text-muted-foreground">
            {agreement.state === "done"
              ? `${agreement.same.toLocaleString()} of ${agreement.shared.toLocaleString()} pixels classified on both carry the same class. Pixels outside either footprint are not counted: an absence is not a disagreement.`
              : agreement.state === "working"
                ? "Reading both rasters."
                : agreement.why}
          </p>
        </div>
      </div>
    </ModalShell>
  )
}
