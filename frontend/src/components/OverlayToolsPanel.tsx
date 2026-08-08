import { useMemo, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
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
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import {
  ExportClassification,
  ExportOverlayFile,
} from "../../wailsjs/go/main/App"
import type {
  CompositionOverlay,
  ModelKind,
  PredictResult,
  WaterAnalysis,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
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
  /**
   * Solar raster, siting or terrain, whichever the map is showing. Only one
   * reaches the map at a time, so one switch and one opacity describe it.
   */
  solar?: SolarSitingAnalysis | SolarTerrainAnalysis | null
  showSolarOverlay?: boolean
  onShowSolarOverlayChange?: (v: boolean) => void
  solarOpacity?: number
  onSolarOpacityChange?: (v: number) => void
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

async function exportAsset(src: string, filename: string) {
  try {
    const dest = await ExportOverlayFile(src, filename)
    if (dest) notifyExportOk(dest)
  } catch (e) {
    notifyExportFail(e)
  }
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
          onActivate && "cursor-pointer hover:opacity-90"
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

function modelLabel(kind?: ModelKind): string {
  switch (kind) {
    case "prithvi":
      return "Prithvi-EO"
    case "temporal_transformer":
      return "Temporal Transformer"
    case "spectral":
      return "Random Forest"
    default:
      return kind || "model"
  }
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
    solar = null,
    showSolarOverlay = true,
    onShowSolarOverlayChange,
    solarOpacity = 0.85,
    onSolarOpacityChange,
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

  const gallery =
    compositionGallery.length > 0
      ? compositionGallery
      : composition?.overlay_uri
        ? [composition]
        : []

  const cards = useMemo(() => {
    const list: ReactNode[] = []

    if (result?.overlay_uri) {
      const range =
        result.date_range?.length === 2
          ? `${result.date_range[0]} → ${result.date_range[1]}`
          : null
      const parts = [
        areaLabel?.trim() || null,
        modelLabel(modelKind),
        result.n_dates > 0 ? `${result.n_dates} scenes` : null,
        range,
        result.mean_confidence > 0
          ? `conf ${(result.mean_confidence * 100).toFixed(0)}%`
          : null,
      ].filter(Boolean)
      list.push(
        <OverlayAssetCard
          key="prediction"
          title="Prediction"
          params={parts.join(" · ")}
          previewUri={result.overlay_uri}
          pixelated
          onExportPng={() =>
            void exportAsset(result.overlay_uri, "terra_prediction.png")
          }
          onExportTif={
            result.raster_tif
              ? async () => {
                  try {
                    const dest = await ExportClassification(result.raster_tif)
                    if (dest) notifyExportOk(dest)
                  } catch (e) {
                    notifyExportFail(e)
                  }
                }
              : undefined
          }
          canExportTif={!!result.raster_tif}
        />
      )
    }

    if (result?.confidence_uri) {
      list.push(
        <OverlayAssetCard
          key="confidence"
          title="Confidence"
          params={[
            "from classification",
            result.mean_confidence > 0
              ? `mean ${(result.mean_confidence * 100).toFixed(0)}%`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          previewUri={result.confidence_uri}
          onExportPng={() =>
            void exportAsset(result.confidence_uri, "terra_confidence.png")
          }
        />
      )
    }

    if (result?.ndvi_mean_uri) {
      const range =
        result.date_range?.length === 2
          ? `${result.date_range[0]} → ${result.date_range[1]}`
          : null
      list.push(
        <OverlayAssetCard
          key="ndvi"
          title="NDVI mean"
          params={["temporal mean NDVI", range].filter(Boolean).join(" · ")}
          previewUri={result.ndvi_mean_uri}
          onExportPng={() =>
            void exportAsset(result.ndvi_mean_uri!, "terra_ndvi_mean.png")
          }
        />
      )
    }

    if (result?.true_color_uri) {
      const range =
        result.date_range?.length === 2
          ? `${result.date_range[0]} → ${result.date_range[1]}`
          : null
      list.push(
        <OverlayAssetCard
          key="true-color"
          title="Satellite true color"
          params={["peak-NDVI scene · B04-B03-B02", range]
            .filter(Boolean)
            .join(" · ")}
          previewUri={result.true_color_uri}
          onExportPng={() =>
            void exportAsset(result.true_color_uri!, "terra_true_color.png")
          }
        />
      )
    }

    // The standalone products. Each renders a raster onto the map and has its
    // own visibility switch below, but none produced a card here, so the
    // gallery reported "no overlays yet" while its own raster was on screen
    // and its own toggle was listed under it.
    if (water?.occurrence_uri) {
      const range =
        water.date_range?.length === 2
          ? `${water.date_range[0]} → ${water.date_range[1]}`
          : null
      list.push(
        <OverlayAssetCard
          key="water-occurrence"
          title="Surface water occurrence"
          params={[
            water.index,
            water.n_dates > 0 ? `${water.n_dates} dates` : null,
            range,
            `opacity ${Math.round((waterOpacity ?? 0.8) * 100)}%`,
          ]
            .filter(Boolean)
            .join(" · ")}
          previewUri={water.occurrence_uri}
          pixelated
          active={showWaterOverlay}
          onExportPng={() =>
            void exportAsset(water.occurrence_uri, "terra_water_occurrence.png")
          }
        />
      )
    }

    if (solar?.overlay_uri) {
      // One switch drives both solar rasters and siting takes priority, so the
      // card names which of the two is actually on the map.
      const siting = "classes" in solar ? solar : null
      const terrain = siting ? null : (solar as SolarTerrainAnalysis)
      list.push(
        <OverlayAssetCard
          key="solar-raster"
          title={
            siting ? "Photovoltaic siting" : "Terrain plane-of-array irradiation"
          }
          params={[
            siting ? siting.dem_source : terrain?.dem_source,
            terrain?.season,
            terrain ? terrain.unit : null,
            siting
              ? `${siting.suitable_no_conflict_ha.toFixed(1)} ha without conflict`
              : null,
            `opacity ${Math.round((solarOpacity ?? 0.85) * 100)}%`,
          ]
            .filter(Boolean)
            .join(" · ")}
          previewUri={solar.overlay_uri}
          pixelated
          active={showSolarOverlay}
          onExportPng={() =>
            void exportAsset(
              solar.overlay_uri,
              siting ? "terra_solar_siting.png" : "terra_solar_terrain.png"
            )
          }
        />
      )
    }

    for (const item of gallery) {
      if (!item.overlay_uri) continue
      const bandOrIndex =
        item.kind === "index" && item.index
          ? item.index.toUpperCase()
          : item.bands?.join("-")
      const paramLine = [
        bandOrIndex,
        item.sceneDate ||
          (item.id === composition?.id ? composeSceneDate : null) ||
          null,
        item.kind === "rgb"
          ? "RGB composite"
          : item.kind === "index"
            ? "Spectral index"
            : null,
        `opacity ${Math.round((item.opacity ?? composeOpacity) * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · ")

      list.push(
        <OverlayAssetCard
          key={item.id || item.overlay_uri}
          title={item.title || item.label || "Composition"}
          params={paramLine}
          previewUri={item.overlay_uri}
          active={composition?.id === item.id && showCompositionOverlay}
          onActivate={
            onSelectComposition && item.id
              ? () => onSelectComposition(item.id)
              : undefined
          }
          onRemove={
            onRemoveComposition && item.id
              ? () => onRemoveComposition(item.id)
              : undefined
          }
          onExportPng={() =>
            void exportAsset(
              item.overlay_uri,
              `terra_${(item.title || "composition").replace(/\s+/g, "_").toLowerCase()}.png`
            )
          }
          onExportTif={
            item.raster_tif
              ? () =>
                  void exportAsset(
                    item.raster_tif!,
                    `terra_${(item.title || "composition").replace(/\s+/g, "_").toLowerCase()}.tif`
                  )
              : undefined
          }
          canExportTif={!!item.raster_tif}
        />
      )
    }

    return list
  }, [
    result,
    gallery,
    composition,
    areaLabel,
    modelKind,
    composeSceneDate,
    composeOpacity,
    showCompositionOverlay,
    onSelectComposition,
    onRemoveComposition,
    water,
    waterOpacity,
    showWaterOverlay,
    solar,
    solarOpacity,
    showSolarOverlay,
  ])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="panel app-no-drag absolute right-14 top-14 z-[1100] flex max-h-[min(36rem,calc(100%-5rem))] w-[19rem] flex-col overflow-hidden rounded-md"
          initial={{ opacity: 0, x: 16, y: -8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 16, y: -8 }}
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
                <p className="text-[11px] text-muted-foreground">
                  No overlays yet — classify or apply a composition.
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
                  checked={showSolarOverlay}
                  disabled={!solar || !onShowSolarOverlayChange}
                  onChange={(e) => onShowSolarOverlayChange?.(e.target.checked)}
                  className="accent-primary"
                />
                Show solar overlay
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
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                Solar opacity {Math.round(solarOpacity * 100)}%
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={solarOpacity}
                  disabled={!solar || !onSolarOpacityChange}
                  onChange={(e) => onSolarOpacityChange?.(Number(e.target.value))}
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
        "overlay-tools-btn panel app-no-drag absolute right-[10px] top-[3.35rem] z-[1000] flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-secondary hover:text-foreground",
        active && "border-primary/50 bg-primary/15 text-foreground"
      )}
    >
      <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}
