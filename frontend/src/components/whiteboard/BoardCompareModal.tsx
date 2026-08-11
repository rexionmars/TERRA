/**
 * Two linked rasters, read against each other.
 *
 * The board's arrows already say "read this, then this". Pressing one asks the
 * next question -- how do they differ -- and this answers it in the two ways
 * the data allows: a swipe, which works for any two pictures, and an agreement
 * figure, which works only where the two are the same grid and the same kind of
 * thing.
 *
 * THE SECOND ONE REFUSES MORE OFTEN THAN IT ANSWERS, and that is the honest
 * behaviour rather than a limitation to apologise for. Two rasters from two
 * AOIs are two pieces of ground: laying one over the other and counting matches
 * would produce a number with no referent. Two rasters of one AOI on different
 * grids -- a classification at 10 m in UTM and a solar raster at 1/3600 degree
 * in geographic -- are not pixel-aligned either. The predicate is stated on
 * screen when it fails, because "no answer, and here is why" is information and
 * a number computed anyway is not.
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
    if (from.extentKey !== to.extentKey) {
      setAgreement({
        state: "off",
        why: "These cover different ground. An agreement between two areas would count pixels that are not the same place.",
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
  }, [from.uri, to.uri, from.extentKey, to.extentKey])

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
        <div className="min-h-0 flex-1 overflow-hidden rounded-md bg-surface">
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
