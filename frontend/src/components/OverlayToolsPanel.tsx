import { useMemo, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  Blend,
  SlidersHorizontal,
  Download,
  Palette,
  Code2,
  X,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Eye,
} from "lucide-react"
import { exportPng, exportTif, runAssets } from "@/lib/runAssets"
import type {
  CompositionOverlay,
  ModelKind,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import {
  AOI_CONTOUR_SCHEMES,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"
import { cn } from "@/lib/utils"

export interface OverlayToolsPanelProps {
  open: boolean
  onClose: () => void
  result: PredictResult | null
  composition: CompositionOverlay | null
  compositionGallery?: CompositionOverlay[]
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  areaLabel?: string
  modelKind?: ModelKind
  composeSceneDate?: string | null
  showPredictionOverlay: boolean
  onShowPredictionOverlayChange: (v: boolean) => void
  showCompositionOverlay: boolean
  onShowCompositionOverlayChange: (v: boolean) => void
  /** Surface-water occurrence raster, when a water run has been made. */
  water?: WaterAnalysis | null
  showWaterOverlay?: boolean
  onShowWaterOverlayChange?: (v: boolean) => void
  waterOpacity?: number
  onWaterOpacityChange?: (v: number) => void
  showConfidence: boolean
  onShowConfidenceChange: (v: boolean) => void
  confidenceOnTop: boolean
  onConfidenceOnTopChange: (v: boolean) => void
  smoothOverlay: boolean
  onSmoothOverlayChange: (v: boolean) => void
  swipeCompare: boolean
  onSwipeCompareChange: (v: boolean) => void
  overlayOpacity: number
  onOverlayOpacityChange: (v: number) => void
  composeOpacity: number
  onComposeOpacityChange: (v: number) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void
}

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-primary">{icon}</span>
        <span className="eyebrow !text-foreground flex-1">{title}</span>
        {open ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="flex flex-col gap-2 pl-0.5">{children}</div>}
    </div>
  )
}

function OverlayAssetCard({
  title,
  params,
  previewUri,
  pixelated,
  active,
  onActivate,
  onRemove,
  onExportPng,
  onExportTif,
  canExportTif,
}: {
  title: string
  params: string
  previewUri?: string
  pixelated?: boolean
  active?: boolean
  onActivate?: () => void
  onRemove?: () => void
  onExportPng?: () => void
  onExportTif?: () => void
  canExportTif?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-sm border bg-secondary/20 p-2",
        active ? "border-primary/50" : "border-border/70"
      )}
    >
      <button
        type="button"
        disabled={!onActivate}
        onClick={onActivate}
        className={cn(
          "relative size-16 shrink-0 overflow-hidden rounded-sm border border-border/50 bg-secondary",
          onActivate && "hover:opacity-90"
        )}
        title={onActivate ? "Show on map" : undefined}
      >
        {previewUri ? (
          <img
            src={previewUri}
            alt=""
            className={cn(
              "h-full w-full object-cover",
              pixelated && "overlay-thumb-crisp"
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-5 opacity-50" />
          </div>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="min-w-0">
          <div className="flex items-start gap-1">
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {title}
            </p>
            {active && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] uppercase tracking-wide text-primary">
                <Eye className="size-2.5" />
                map
              </span>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Remove from gallery"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <p className="telemetry mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
            {params}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-1">
          {onExportPng && (
            <button
              type="button"
              onClick={onExportPng}
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Export PNG"
            >
              <Download className="size-3" />
              PNG
            </button>
          )}
          {onExportTif && (
            <button
              type="button"
              disabled={!canExportTif}
              onClick={onExportTif}
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={
                canExportTif ? "Export GeoTIFF" : "GeoTIFF not available"
              }
            >
              <Download className="size-3" />
              GeoTIFF
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function OverlayToolsPanel(props: OverlayToolsPanelProps) {
  const {
    open,
    onClose,
    result,
    composition,
    compositionGallery = [],
    onSelectComposition,
    onRemoveComposition,
    areaLabel,
    modelKind,
    composeSceneDate,
    showPredictionOverlay,
    onShowPredictionOverlayChange,
    showCompositionOverlay,
    onShowCompositionOverlayChange,
    water = null,
    showWaterOverlay = true,
    onShowWaterOverlayChange,
    waterOpacity = 0.8,
    onWaterOpacityChange,
    showConfidence,
    onShowConfidenceChange,
    confidenceOnTop,
    onConfidenceOnTopChange,
    smoothOverlay,
    onSmoothOverlayChange,
    swipeCompare,
    onSwipeCompareChange,
    overlayOpacity,
    onOverlayOpacityChange,
    composeOpacity,
    onComposeOpacityChange,
    aoiContourScheme,
    onAoiContourSchemeChange,
  } = props

  /*
    Built from lib/runAssets.ts rather than assembled here. The board's
    outliner lists the same set with the same actions, and two derivations of
    "what this run produced" would disagree within a release -- silently,
    because both would look plausible.
  */
  const assets = useMemo(
    () =>
      runAssets({
        result,
        composition,
        compositionGallery,
        water,
        areaLabel,
        modelKind,
        composeSceneDate,
        showCompositionOverlay,
        showWaterOverlay,
        composeOpacity,
        waterOpacity,
      }),
    [
      result,
      composition,
      compositionGallery,
      water,
      areaLabel,
      modelKind,
      composeSceneDate,
      showCompositionOverlay,
      showWaterOverlay,
      composeOpacity,
      waterOpacity,
    ]
  )

  const cards = assets.map((a) => (
    <OverlayAssetCard
      key={a.id}
      title={a.title}
      params={a.params}
      previewUri={a.previewUri}
      pixelated={a.pixelated}
      active={a.onBoard}
      onActivate={
        a.selectId && onSelectComposition
          ? () => onSelectComposition(a.selectId!)
          : undefined
      }
      onRemove={
        a.removeId && onRemoveComposition
          ? () => onRemoveComposition(a.removeId!)
          : undefined
      }
      onExportPng={() => void exportPng(a)}
      onExportTif={a.exportTif ? () => void exportTif(a) : undefined}
      canExportTif={!!a.exportTif}
    />
  ))

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn(
            "panel app-no-drag absolute right-14 z-[1100] flex w-[19rem] flex-col overflow-hidden rounded-md",
            // Bottom-aligned with the control stack its button sits in, and
            // 0.625rem is that stack's own margin under the last control, so
            // the two share a baseline. A panel that opens at the far end from
            // the thing that opened it is the defect this avoids.
            "bottom-[calc(var(--map-foot,0px)+0.625rem)]",
            "max-h-[min(36rem,calc(100%-var(--map-foot,0px)-5rem))]"
          )}
          // Rises from the edge it is attached to.
          initial={{ opacity: 0, x: 16, y: 8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 16, y: 8 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-3.5 text-primary" />
              <span className="eyebrow !text-foreground">Overlay Tools</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <hr className="hairline" />
          <div className="panel-scroll flex flex-col gap-4 overflow-y-auto p-3">
            <Section
              icon={<ImageIcon className="size-3.5" />}
              title="Generated overlays"
            >
              {cards.length === 0 ? (
                // Names every run that puts a card here. Solar leaving does not
                // make the old sentence true: surface water still produces a
                // card and is neither a classification nor a composition, so a
                // user with a water raster on the map was told to do two things
                // that would not have produced it.
                <p className="text-[11px] text-muted-foreground">
                  No overlays yet — classify, map surface water, or apply a
                  composition.
                </p>
              ) : (
                <div className="flex flex-col gap-2">{cards}</div>
              )}
            </Section>

            <hr className="hairline" />

            <Section icon={<Palette className="size-3.5" />} title="AOI palette">
              <div className="grid grid-cols-2 gap-1.5">
                {AOI_CONTOUR_SCHEMES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onAoiContourSchemeChange(s.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-[11px]",
                      aoiContourScheme === s.id
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-[2px] border border-white/20"
                      style={{ backgroundColor: s.stroke }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
            </Section>

            <hr className="hairline" />

            <Section
              icon={<SlidersHorizontal className="size-3.5" />}
              title="Overlays"
            >
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showPredictionOverlay}
                  disabled={!result}
                  onChange={(e) =>
                    onShowPredictionOverlayChange(e.target.checked)
                  }
                  className="accent-primary"
                />
                Show prediction overlay
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showCompositionOverlay}
                  disabled={!composition}
                  onChange={(e) =>
                    onShowCompositionOverlayChange(e.target.checked)
                  }
                  className="accent-primary"
                />
                Show composition overlay
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showWaterOverlay}
                  disabled={!water || !onShowWaterOverlayChange}
                  onChange={(e) =>
                    onShowWaterOverlayChange?.(e.target.checked)
                  }
                  className="accent-primary"
                />
                Show surface water overlay
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={swipeCompare}
                  onChange={(e) => onSwipeCompareChange(e.target.checked)}
                  className="accent-primary"
                />
                Swipe imagery ↔ overlay
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={smoothOverlay}
                  disabled={!result}
                  onChange={(e) => onSmoothOverlayChange(e.target.checked)}
                  className="accent-primary"
                />
                Smooth prediction overlay
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showConfidence}
                  disabled={!result?.confidence_uri}
                  onChange={(e) => onShowConfidenceChange(e.target.checked)}
                  className="accent-primary"
                />
                Show confidence overlay
              </label>
              <label
                className={cn(
                  "flex items-center gap-1.5 text-[11px] text-muted-foreground",
                  !showConfidence && "opacity-45"
                )}
              >
                <input
                  type="checkbox"
                  checked={confidenceOnTop}
                  disabled={!showConfidence}
                  onChange={(e) => onConfidenceOnTopChange(e.target.checked)}
                  className="accent-primary"
                />
                Keep prediction under confidence
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Prediction opacity {Math.round(overlayOpacity * 100)}%
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={overlayOpacity}
                  onChange={(e) =>
                    onOverlayOpacityChange(Number(e.target.value))
                  }
                  className="w-full accent-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Composition opacity {Math.round(composeOpacity * 100)}%
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={composeOpacity}
                  disabled={!composition}
                  onChange={(e) =>
                    onComposeOpacityChange(Number(e.target.value))
                  }
                  className="w-full accent-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                Surface water opacity {Math.round(waterOpacity * 100)}%
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={waterOpacity}
                  disabled={!water || !onWaterOpacityChange}
                  onChange={(e) =>
                    onWaterOpacityChange?.(Number(e.target.value))
                  }
                  className="w-full accent-primary"
                />
              </label>
            </Section>

            <hr className="hairline" />

            <Section
              icon={<Code2 className="size-3.5" />}
              title="Composition script"
              defaultOpen={false}
            >
              <textarea
                readOnly
                disabled
                rows={4}
                className="w-full resize-none rounded-sm border border-border bg-secondary/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground opacity-70"
                value={
                  "// GEE-style band expressions — coming soon.\n" +
                  "// Example:\n" +
                  "// var ndvi = (B08 - B04) / (B08 + B04);"
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Scripted band math will land in a later release.
              </p>
            </Section>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Matches left-dock tab chrome; sits under the basemap layers control. */
export function OverlayToolsButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title="Overlay Tools"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // No anchor of its own: it is handed to Leaflet's bottom-right stack,
        // which places it under the zoom and draw tools. It used to sit at the
        // top-right, a few pixels from where this panel opens, so the panel
        // read as something the button had produced.
        //
        // Sized to the stack it joins rather than to the 2rem it was: the zoom
        // and draw buttons are 2.125rem, and a narrower one beside them reads
        // as a different kind of control.
        "overlay-tools-btn panel app-no-drag flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-secondary hover:text-foreground",
        active && "border-primary/50 bg-primary/15 text-foreground"
      )}
    >
      {/*
        Blend, not sliders. Two sliders icons had come to mean two different
        things a few pixels apart -- this one and the dock bar's parameters --
        and overlapping discs say what this panel actually governs: how the
        layers sit over one another, their opacity and their comparison.
      */}
      <Blend className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}
