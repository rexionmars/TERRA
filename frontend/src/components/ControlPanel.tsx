import { forwardRef, useState } from "react"
import { motion } from "motion/react"
import {
  Play,
  Loader2,
  Pencil,
  Upload,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Layers,
  CheckCircle2,
  Circle,
  Globe2,
} from "lucide-react"
import type { Area, GeoJSONGeometry, ModelKind } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelSection as Section } from "@/components/ui/PanelSection"

interface ControlPanelProps {
  areas: Area[]
  activeExample: string
  onSelectExample: (id: string) => void
  customPolygon: GeoJSONGeometry | null
  hasArea: boolean
  onClearArea: () => void
  onImportPolygon: () => void
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  maxCloud: number
  onMaxCloudChange: (v: number) => void
  monthlyBest: boolean
  onMonthlyBestChange: (v: boolean) => void
  mode: "single" | "temporal"
  onModeChange: (m: "single" | "temporal") => void
  modelKind: ModelKind
  onModelKindChange: (m: ModelKind) => void
  prithviMode: "pixel" | "patch"
  onPrithviModeChange: (m: "pixel" | "patch") => void
  running: boolean
  progress: number
  progressMsg: string
  onRun: () => void
  onAnalyzeLULC: () => void
  lulcRunning?: boolean
  /** Hide this panel (dock tabs remain). */
  onCollapse?: () => void
  /** Tailwind left offset, e.g. left-3 or left-14 */
  panelOffsetClass?: string
}

export const ControlPanel = forwardRef<HTMLDivElement, ControlPanelProps>(
  function ControlPanel(props, ref) {
  const {
    areas,
    activeExample,
    onSelectExample,
    customPolygon,
    hasArea,
    onClearArea,
    onImportPolygon,
    start,
    end,
    onStartChange,
    onEndChange,
    maxCloud,
    onMaxCloudChange,
    monthlyBest,
    onMonthlyBestChange,
    mode,
    onModeChange,
    modelKind,
    onModelKindChange,
    prithviMode,
    onPrithviModeChange,
    running,
    progress,
    progressMsg,
    onRun,
    onAnalyzeLULC,
    lulcRunning = false,
    onCollapse,
  } = props

  const [showExamples, setShowExamples] = useState(false)
  const canLULC = hasArea
  const busy = running || lulcRunning

  return (
      <motion.div
        ref={ref}
        className={`panel app-no-drag panel-scroll absolute ${props.panelOffsetClass ?? "left-3"} top-3 bottom-3 z-[1000] flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4`}
        initial={{ opacity: 0, x: -28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -28 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">New classification</h1>
        <button
          type="button"
          onClick={() => onCollapse?.()}
          className="text-muted-foreground hover:text-foreground"
          title="Hide panel"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>

      {/* STEP 1 — area */}
      <Section step="01" title="Area">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Draw a polygon on the map, search a location, or load a file.
          Works anywhere in the world.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onImportPolygon}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            <Upload className="size-3.5" />
            Import
          </button>
          <button
            onClick={onClearArea}
            disabled={busy || !hasArea}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            Clear
          </button>
        </div>
        <div
          className={cn(
            "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs",
            hasArea
              ? "border-primary/40 text-foreground"
              : "border-dashed border-border text-muted-foreground"
          )}
        >
          {hasArea ? (
            <CheckCircle2 className="size-3.5 text-primary" />
          ) : (
            <Pencil className="size-3.5" />
          )}
          {hasArea
            ? activeExample
              ? `Example ${activeExample} loaded`
              : "Area defined"
            : "No area defined"}
        </div>

        {/* Examples: secondary launcher, collapsed by default */}
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setShowExamples((s) => !s)}
            className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Layers className="size-3" />
            Reference examples
            {showExamples ? (
              <ChevronLeft className="size-3 rotate-90" />
            ) : (
              <ChevronRight className="size-3 rotate-90" />
            )}
          </button>
          {showExamples && (
            <div className="grid grid-cols-3 gap-1.5">
              {areas.map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  onClick={() => onSelectExample(a.id)}
                  title={a.label}
                  className={cn(
                    "rounded-sm border px-2 py-1 text-xs disabled:opacity-50",
                    activeExample === a.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  {a.id}
                </button>
              ))}
            </div>
          )}
        </div>
      </Section>

      <hr className="hairline" />

      {/* STEP 2 — period + scenes */}
      <Section step="02" title="Period & scenes">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">start</span>
            <input
              type="date"
              value={start}
              disabled={busy}
              onChange={(e) => onStartChange(e.target.value)}
              className="telemetry rounded-sm border border-input bg-transparent px-2 py-1 text-xs disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">end</span>
            <input
              type="date"
              value={end}
              disabled={busy}
              onChange={(e) => onEndChange(e.target.value)}
              className="telemetry rounded-sm border border-input bg-transparent px-2 py-1 text-xs disabled:opacity-50"
            />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="eyebrow">max cloud</span>
            <span className="telemetry text-xs text-foreground">{maxCloud}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={maxCloud}
            disabled={busy}
            onChange={(e) => onMaxCloudChange(parseInt(e.target.value))}
            className="accent-[var(--primary)]"
          />
        </div>
        <button
          onClick={() => onMonthlyBestChange(!monthlyBest)}
          className="flex items-center gap-2 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          {monthlyBest ? (
            <CheckCircle2 className="size-3.5 text-primary" />
          ) : (
            <Circle className="size-3.5" />
          )}
          Best scene per month
        </button>
      </Section>

      <hr className="hairline" />

      {/* STEP 3 — model */}
      <Section step="03" title="Model">
        <div className="grid grid-cols-1 gap-2">
          {(
            [
              ["spectral", "Random Forest", "spectro-temporal features"],
              ["temporal_transformer", "Temporal Transformer", "lightweight series model"],
              ["prithvi", "Prithvi-EO 2.0", "embeddings (NASA/IBM)"],
            ] as const
          ).map(([m, label, sub]) => (
            <button
              key={m}
              disabled={busy}
              onClick={() => onModelKindChange(m)}
              className={cn(
                "rounded-sm border p-2 text-left text-xs disabled:opacity-50",
                modelKind === m
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-secondary"
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {sub}
              </span>
            </button>
          ))}
        </div>
        {modelKind === "prithvi" && (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["pixel", "Pixel", "10 m, comparable to RF"],
                  ["patch", "Patch", "~160 m, spatial context"],
                ] as const
              ).map(([m, label, sub]) => (
                <button
                  key={m}
                  disabled={busy}
                  onClick={() => onPrithviModeChange(m)}
                  className={cn(
                    "rounded-sm border p-1.5 text-left text-[11px] disabled:opacity-50",
                    prithviMode === m
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[9px] text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Frozen backbone + Random Forest. Temporal soybean retention uses the
              Random Forest model; Prithvi produces the map only.
            </p>
          </div>
        )}
      </Section>

      <hr className="hairline" />

      {/* STEP 4 — mode */}
      <Section step="04" title="Mode">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["single", "Map", "full temporal stack"],
              ["temporal", "Temporal", "cumulative retention"],
            ] as const
          ).map(([m, label, sub]) => (
            <button
              key={m}
              disabled={busy || (m === "temporal" && modelKind !== "spectral")}
              onClick={() => onModeChange(m)}
              className={cn(
                "rounded-sm border p-2 text-left text-xs disabled:opacity-50",
                mode === m
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-secondary"
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {sub}
              </span>
            </button>
          ))}
        </div>
        {modelKind !== "spectral" && (
          <p className="text-[10px] text-muted-foreground">
            Cumulative temporal mode is available with Random Forest only.
          </p>
        )}
      </Section>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {(running || lulcRunning) && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="telemetry">{progressMsg || "processing"}</span>
              <span className="telemetry text-primary">
                {progress >= 0 ? `${progress}%` : "··"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.max(0, progress)}%` }}
              />
            </div>
          </div>
        )}
        <button
          onClick={onAnalyzeLULC}
          disabled={busy || !canLULC}
          title={
            canLULC
              ? "MapBiomas land cover / land use (Brazil COG if needed)"
              : "Draw or select an area first"
          }
          className="flex items-center justify-center gap-2 rounded-sm border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          {lulcRunning ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Analyzing LULC
            </>
          ) : (
            <>
              <Globe2 className="size-3.5" />
              Analyze land cover
            </>
          )}
        </button>
        <button
          onClick={onRun}
          disabled={busy || !hasArea || !start || !end}
          className="flex items-center justify-center gap-2 rounded-sm bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Classifying
            </>
          ) : (
            <>
              <Play className="size-4" />
              Classify
            </>
          )}
        </button>
      </div>
      </motion.div>
  )
})
