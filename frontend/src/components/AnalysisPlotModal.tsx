import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Columns2, Download, Minus, Plus, RotateCcw, X } from "lucide-react"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import {
  ExportClassification,
  ExportOverlayFile,
} from "../../wailsjs/go/main/App"
import { cn } from "@/lib/utils"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"

export type AnalysisPlotAsset = {
  id: string
  title: string
  uri: string
  exportPngName: string
  rasterTif?: string
  showClassLegend?: boolean
  pixelated?: boolean
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const ZOOM_STEP = 1.25

function shortLabel(title: string): string {
  if (title.startsWith("Predicted")) return "Predicted"
  if (title.startsWith("MapBiomas")) return "MapBiomas"
  if (title.startsWith("NDVI")) return "NDVI"
  if (title.startsWith("Confidence")) return "Confidence"
  if (title.startsWith("Satellite") || title.startsWith("True color")) return "Satellite"
  return title
}

function defaultCompareId(
  plot: AnalysisPlotAsset,
  available: AnalysisPlotAsset[]
): string | null {
  const ids = new Set(available.map((p) => p.id))
  if (plot.id === "predicted") {
    if (ids.has("satellite")) return "satellite"
    if (ids.has("ndvi")) return "ndvi"
    if (ids.has("reference")) return "reference"
    if (ids.has("confidence")) return "confidence"
  }
  if (plot.id === "satellite") {
    if (ids.has("predicted")) return "predicted"
    if (ids.has("ndvi")) return "ndvi"
  }
  if (plot.id === "reference" || plot.id === "ndvi" || plot.id === "confidence") {
    if (ids.has("satellite")) return "satellite"
    if (ids.has("predicted")) return "predicted"
  }
  const other = available.find((p) => p.id !== plot.id)
  return other?.id ?? null
}

const COMPARE_ORDER = ["satellite", "ndvi", "reference", "predicted", "confidence"]

function sortCompareCandidates(items: AnalysisPlotAsset[]): AnalysisPlotAsset[] {
  return [...items].sort((a, b) => {
    const ia = COMPARE_ORDER.indexOf(a.id)
    const ib = COMPARE_ORDER.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
}

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** Pan/zoom viewport for plot previews (wheel, drag, +/- controls). */
function PlotViewport({
  resetKey,
  children,
}: {
  resetKey: string
  children: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originTx: number
    originTy: number
  } | null>(null)
  const viewRef = useRef({ scale, tx, ty })
  viewRef.current = { scale, tx, ty }

  const resetView = useCallback(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  useEffect(() => {
    resetView()
  }, [resetKey, resetView])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const { scale: s } = viewRef.current
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      const ns = clampZoom(s * factor)
      if (ns === s) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const { tx: ox, ty: oy } = viewRef.current
      const cx = (x - ox) / s
      const cy = (y - oy) / s
      setScale(ns)
      if (ns <= MIN_ZOOM + 0.001) {
        setTx(0)
        setTy(0)
      } else {
        setTx(x - cx * ns)
        setTy(y - cy * ns)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const el = viewportRef.current
    if (!el) return
    const ns = clampZoom(nextScale)
    const { scale: s, tx: ox, ty: oy } = viewRef.current
    if (ns === s) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const cx = (x - ox) / s
    const cy = (y - oy) / s
    setScale(ns)
    if (ns <= MIN_ZOOM + 0.001) {
      setTx(0)
      setTy(0)
    } else {
      setTx(x - cx * ns)
      setTy(y - cy * ns)
    }
  }, [])

  const zoomBy = useCallback(
    (factor: number) => {
      const el = viewportRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * factor)
    },
    [scale, zoomAt]
  )

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative size-full min-h-0 overflow-hidden touch-none",
        scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if ((e.target as HTMLElement).closest(".map-swipe-handle")) return
        if (scale <= MIN_ZOOM) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        panRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originTx: tx,
          originTy: ty,
        }
      }}
      onPointerMove={(e) => {
        const pan = panRef.current
        if (!pan || pan.pointerId !== e.pointerId) return
        e.preventDefault()
        setTx(pan.originTx + (e.clientX - pan.startX))
        setTy(pan.originTy + (e.clientY - pan.startY))
      }}
      onPointerUp={(e) => {
        if (panRef.current?.pointerId === e.pointerId) panRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }}
      onPointerCancel={() => {
        panRef.current = null
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest(".map-swipe-handle")) return
        e.preventDefault()
        if (scale > 1.05) {
          resetView()
        } else {
          zoomAt(e.clientX, e.clientY, 2.5)
        }
      }}
    >
      <div
        className="absolute inset-0 origin-top-left will-change-transform"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        {children}
      </div>

      <div className="absolute bottom-2 right-2 z-30 flex flex-col overflow-hidden rounded-sm border border-white/15 bg-black/55 shadow-md">
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={scale >= MAX_ZOOM - 0.01}
          className="flex size-8 items-center justify-center text-white/90 hover:bg-white/10 disabled:opacity-35"
        >
          <Plus className="size-3.5" />
        </button>
        <div className="h-px bg-white/15" />
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={scale <= MIN_ZOOM + 0.01}
          className="flex size-8 items-center justify-center text-white/90 hover:bg-white/10 disabled:opacity-35"
        >
          <Minus className="size-3.5" />
        </button>
        <div className="h-px bg-white/15" />
        <button
          type="button"
          title="Reset view"
          onClick={resetView}
          disabled={scale <= MIN_ZOOM + 0.01 && Math.abs(tx) < 1 && Math.abs(ty) < 1}
          className="flex size-8 items-center justify-center text-white/90 hover:bg-white/10 disabled:opacity-35"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      {scale > 1.01 && (
        <div className="pointer-events-none absolute left-2 top-2 z-30 rounded-sm bg-black/55 px-1.5 py-0.5 text-meta tracking-wide text-white/85">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  )
}

function PlotSwipeView({
  left,
  right,
  ratio,
  onRatioChange,
}: {
  left: AnalysisPlotAsset
  right: AnalysisPlotAsset
  ratio: number
  onRatioChange: (r: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    onRatioChange(
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    )
  }

  return (
    <div ref={trackRef} className="relative size-full min-h-0 overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={left.uri}
          alt={left.title}
          draggable={false}
          className={cn(
            "absolute inset-0 size-full object-contain",
            left.pixelated && "overlay-thumb-crisp"
          )}
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${ratio * 100}%)` }}
        >
          <img
            src={right.uri}
            alt={right.title}
            draggable={false}
            className={cn(
              "absolute inset-0 size-full object-contain",
              right.pixelated && "overlay-thumb-crisp"
            )}
          />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${ratio * 100}%`, transform: "translateX(-50%)" }}
      />
      {/* Fixed corner labels — keep the divider free to travel edge-to-edge */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-sm bg-black/55 px-1.5 py-0.5 text-meta tracking-wide text-white/90">
        {shortLabel(left.title)}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-sm bg-black/55 px-1.5 py-0.5 text-meta tracking-wide text-white/90">
        {shortLabel(right.title)}
      </div>
      <button
        type="button"
        aria-label="Drag to compare plots"
        className="map-swipe-handle absolute top-1/2 z-20 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-black/55 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ left: `${ratio * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          e.preventDefault()
          e.stopPropagation()
          setFromClientX(e.clientX)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
      >
        <span className="flex gap-0.5" aria-hidden>
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
        </span>
      </button>
    </div>
  )
}

export function AnalysisPlotModal({
  plot,
  plots = [],
  legend,
  onClose,
}: {
  plot: AnalysisPlotAsset
  /** Other classification plots available for swipe compare. */
  plots?: AnalysisPlotAsset[]
  legend?: { id: number; name: string; color: string }[]
  onClose: () => void
}) {
  const compareCandidates = useMemo(
    () =>
      sortCompareCandidates(
        plots.filter((p) => p.id !== plot.id && !!p.uri)
      ),
    [plots, plot.id]
  )

  const [swipeOn, setSwipeOn] = useState(false)
  const [swipeRatio, setSwipeRatio] = useState(0.5)
  const [compareId, setCompareId] = useState<string | null>(() =>
    defaultCompareId(plot, compareCandidates)
  )

  useEffect(() => {
    setCompareId(defaultCompareId(plot, compareCandidates))
    setSwipeOn(false)
    setSwipeRatio(0.5)
  }, [plot.id, compareCandidates])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const comparePlot =
    compareCandidates.find((p) => p.id === compareId) ??
    compareCandidates[0] ??
    null

  const canSwipe = compareCandidates.length > 0 && !!comparePlot

  // Satellite (true color) always sits on the left when present in the pair.
  const swipeLeft =
    !comparePlot
      ? null
      : plot.id === "satellite"
        ? plot
        : comparePlot.id === "satellite"
          ? comparePlot
          : comparePlot
  const swipeRight =
    !comparePlot
      ? null
      : plot.id === "satellite"
        ? comparePlot
        : plot

  const exportPng = async () => {
    try {
      const dest = await ExportOverlayFile(plot.uri, plot.exportPngName)
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const exportTif = async () => {
    if (!plot.rasterTif) return
    try {
      const dest = await ExportClassification(plot.rasterTif)
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  return (
    <ModalShell
      onDismiss={onClose}
      label={plot.title}
      className="h-[min(48rem,92vh)] w-full max-w-5xl"
    >
      <ModalHeader
        eyebrow="PLOT"
        title={plot.title}
        subtitle={`Preview · zoom / pan · export${canSwipe ? " · swipe" : ""}`}
        onClose={onClose}
      />

        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
          style={{ background: "var(--background)" }}
        >
          <div className="rounded-sm border border-border bg-secondary min-h-0 flex-1 overflow-hidden">
            <PlotViewport resetKey={`${plot.id}:${swipeOn ? compareId ?? "" : "solo"}`}>
              {swipeOn && swipeLeft && swipeRight ? (
                <PlotSwipeView
                  left={swipeLeft}
                  right={swipeRight}
                  ratio={swipeRatio}
                  onRatioChange={setSwipeRatio}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-2">
                  <img
                    src={plot.uri}
                    alt={plot.title}
                    draggable={false}
                    className={cn(
                      "size-full object-contain",
                      plot.pixelated && "overlay-thumb-crisp"
                    )}
                  />
                </div>
              )}
            </PlotViewport>
          </div>

          {plot.showClassLegend && legend && legend.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-3">
              {legend.map((c) => (
                <span
                  key={c.id}
                  className="flex items-center gap-1.5 text-meta text-muted-foreground"
                >
                  <span
                    className="size-2.5 rounded-[2px]"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.id}: {c.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--panel-solid)",
          }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canSwipe ? (
              <>
                <button
                  type="button"
                  onClick={() => setSwipeOn((v) => !v)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-body",
                    swipeOn
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : btnGhost
                  )}
                  title="Swipe compare"
                >
                  <Columns2 className="size-3.5" />
                  Swipe
                </button>
                {swipeOn && (
                  <label className="flex items-center gap-1.5 text-body text-muted-foreground">
                    vs
                    <select
                      value={comparePlot?.id ?? ""}
                      onChange={(e) => setCompareId(e.target.value)}
                      className="rounded-sm border border-border bg-background max-w-[12rem] px-1.5 py-0.5 text-body text-foreground"
                    >
                      {compareCandidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {shortLabel(p.title)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <span />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void exportPng()}
              className={btnGhost}
            >
              <Download className="size-3.5" />
              Export PNG
            </button>
            {plot.rasterTif ? (
              <button
                type="button"
                onClick={() => void exportTif()}
                className={btnPrimary}
              >
                <Download className="size-3.5" />
                Export GeoTIFF
              </button>
            ) : null}
          </div>
        </div>
    </ModalShell>
  )
}
