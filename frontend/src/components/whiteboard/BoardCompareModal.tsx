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
import { DomainShiftSection } from "@/components/DomainShiftSection"
import { ConfusionMatrix } from "@/components/whiteboard/AgreementCharts"
import type { LayerLegend } from "@/lib/layerLegend"
import type { LULCAgreement, PredictResult } from "@/lib/types"

export interface CompareSide {
  /** Area and layer, so a title can say which stack it came from. */
  areaTitle?: string
  layerTitle: string
  /**
   * What produced this raster.
   *
   * The reason the comparison exists. With the same ground and the same window,
   * the estimator is what the two sides differ by, so it leads the label: two
   * corners reading "Prediction" and "Prediction" name nothing the reader is
   * choosing between.
   */
  model?: string
  uri: string
  pixelated: boolean
  legend: LayerLegend
  /** Pixel width and height are not known until the raster is decoded. */
  extentKey: string
  /**
   * The run behind this raster.
   *
   * Domain shift reads the fingerprint the run carries, not the image: the
   * comparison is between feature distributions, and a PNG has none. Optional
   * because a side can be a layer with no run behind it -- a reference map, an
   * imported raster -- and the section withholds itself rather than inventing
   * a domain for it.
   */
  result?: PredictResult | null
  /** MapBiomas accuracy for this side, where the run measured it. */
  agreement?: LULCAgreement | null
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

  /** The header, which has the room to say everything. */
  const label = (s: CompareSide) =>
    [s.model, s.layerTitle, s.areaTitle].filter(Boolean).join(" · ")
  /*
    The swipe's corners, which do not. The model leads and the area is dropped:
    the corner is a 2rem chip over the imagery, its title is trimmed to fit, and
    the run id an area is named by would push out the one word that says which
    side is which.
  */
  const corner = (s: CompareSide) =>
    [s.model, s.layerTitle].filter(Boolean).join(" · ")

  return (
    <ModalShell
      onDismiss={onClose}
      label="Compare two rasters"
      className="max-h-[92vh] w-[min(72rem,92vw)]"
    >
      <ModalHeader
        eyebrow="Compare"
        title={`${label(from)}  →  ${label(to)}`}
        onClose={onClose}
      />

      <div className="panel-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {sameGround ? (
          /*
            An explicit height, not flex-1. ModalShell sizes to its content, so
            a child asking for "one share of the remaining space" was asking for
            a share of nothing and collapsed to zero -- the modal opened with
            its agreement line and no swipe above it. The images are
            object-contain, so this box decides how large they are drawn.
          */
          <div className="h-[min(38vh,24rem)] min-h-0 overflow-hidden rounded-md bg-surface">
            <PlotSwipeView
              left={{
                id: "from",
                title: corner(from),
                uri: from.uri,
                exportPngName: "",
                pixelated: from.pixelated,
              }}
              right={{
                id: "to",
                title: corner(to),
                uri: to.uri,
                exportPngName: "",
                pixelated: to.pixelated,
              }}
              ratio={ratio}
              onRatioChange={setRatio}
            />
          </div>
        ) : null}

        {/*
          DOMAIN SHIFT IS WHAT THIS MODAL IS FOR WHEN THE GROUND DIFFERS.

          What used to fill this space with two areas was the two compositions
          side by side -- the same class list, with the same four columns and
          the same rounding, that the right column already draws for each
          selected plane. Two places make a swipe meaningless, so the modal had
          nothing of its own and repeated what was visible behind it.

          Distance between two feature domains is the opposite: it does not
          exist for a single plane, and it needs the width a 15rem column
          cannot give. Its histogram and t-SNE were being withheld under
          `compact` in the fixed band -- present in the code, invisible in use.
          Here they are drawn.
        */}
        {from.result && to.result && (
          <DomainShiftSection
            resultA={from.result}
            resultB={to.result}
            labelA={label(from)}
            labelB={label(to)}
          />
        )}

        {/*
          The matrix, at a size where a cell can be read.

          It leaves the right column because k x k does not fit in 15rem: it was
          the single tallest thing there and the reason that column scrolled.
          What it uniquely answers -- which class gets taken for which -- is a
          cell-by-cell reading, and a grid too narrow to label its own axes
          cannot be read that way. Here both sides sit side by side, which is
          also the comparison the column could never show.
        */}
        {(from.agreement || to.agreement) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[from, to].map((s, i) =>
              s.agreement ? (
                <ConfusionMatrix
                  key={i}
                  a={s.agreement}
                  title={label(s)}
                />
              ) : (
                <p key={i} className="text-meta text-muted-foreground">
                  {label(s)} carries no reference comparison.
                </p>
              )
            )}
          </div>
        )}

        {sameGround && (
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
        )}
      </div>
    </ModalShell>
  )
}
