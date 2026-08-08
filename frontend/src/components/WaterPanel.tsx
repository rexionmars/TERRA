import { forwardRef } from "react"
import { motion } from "motion/react"
import { ChevronLeft, CheckCircle2, Loader2, Play, Trash2, Waves } from "lucide-react"
import { cn } from "@/lib/utils"
import { btnGhost, btnPrimary, btnPrimaryCommit } from "@/components/ui/buttons"
import { PanelSection as Section } from "@/components/ui/PanelSection"
import type { WaterIndex } from "@/lib/types"

const INDICES: { id: WaterIndex; label: string; detail: string }[] = [
  {
    id: "MNDWI",
    label: "MNDWI",
    detail: "green + SWIR1 · Xu (2006)",
  },
  {
    id: "NDWI",
    label: "NDWI",
    detail: "green + NIR · McFeeters (1996)",
  },
  {
    id: "AWEI",
    label: "AWEI",
    detail: "4 bands, unbounded · Feyisa (2014)",
  },
]

export interface WaterPanelProps {
  panelOffsetClass?: string
  hasArea: boolean
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  maxCloud: number
  onMaxCloudChange: (v: number) => void
  monthlyBest: boolean
  onMonthlyBestChange: (v: boolean) => void
  index: WaterIndex
  onIndexChange: (i: WaterIndex) => void
  running: boolean
  progress: number
  progressMsg: string
  hasResult: boolean
  onRun: () => void
  onClear: () => void
  onCollapse: () => void
}

/**
 * Surface water / flood mapping over a period.
 *
 * The product is a thresholded spectral index, with no model and no trained
 * legend, so it carries none of the fixed-legend domain-shift limitation that
 * applies to the classifier.
 */
export const WaterPanel = forwardRef<HTMLDivElement, WaterPanelProps>(
  function WaterPanel(props, ref) {
    const {
      hasArea,
      start,
      end,
      onStartChange,
      onEndChange,
      maxCloud,
      onMaxCloudChange,
      monthlyBest,
      onMonthlyBestChange,
      index,
      onIndexChange,
      running,
      progress,
      progressMsg,
      hasResult,
      onRun,
      onClear,
      onCollapse,
    } = props

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
          <h1 className="text-sm font-semibold">Surface water</h1>
          <button
            type="button"
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground"
            title="Hide panel"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>

        <Section step="01" title="Area">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Uses the same AOI as classification. Draw or import from the Classify
            panel if needed.
          </p>
          <div
            className={cn(
              "flex items-center gap-2 rounded-sm border px-3 py-2 text-xs",
              hasArea
                ? "border-primary/40 text-foreground"
                : "border-border/60 text-muted-foreground"
            )}
          >
            <CheckCircle2
              className={cn("size-3.5", hasArea ? "text-primary" : "opacity-40")}
            />
            {hasArea ? "AOI ready" : "No AOI defined"}
          </div>
        </Section>

        <Section step="02" title="Period">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Start
              <input
                type="date"
                value={start}
                onChange={(e) => onStartChange(e.target.value)}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              End
              <input
                type="date"
                value={end}
                onChange={(e) => onEndChange(e.target.value)}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Max cloud %
            <input
              type="number"
              min={0}
              max={100}
              value={maxCloud}
              onChange={(e) => onMaxCloudChange(Number(e.target.value))}
              className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={monthlyBest}
              onChange={(e) => onMonthlyBestChange(e.target.checked)}
              className="accent-primary"
            />
            Best scene per month
          </label>
        </Section>

        <Section step="03" title="Index">
          <div className="flex flex-col gap-1.5">
            {INDICES.map((opt) => {
              const active = index === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onIndexChange(opt.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="text-xs font-medium">{opt.label}</span>
                  <span className="telemetry text-[10px] opacity-80">
                    {opt.detail}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Water is the high tail of the index, cut at zero — the literature
            threshold for all three. An Otsu threshold is reported alongside for
            comparison but is not applied.
          </p>
        </Section>

        <Section step="04" title="Run">
          {running && (
            <div className="flex flex-col gap-1">
              <div className="bg-background h-1 overflow-hidden rounded-sm">
                <div
                  className="h-full rounded-sm bg-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <span className="telemetry text-[10px] text-muted-foreground">
                {progressMsg}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || running}
              onClick={onRun}
              className={cn(btnPrimaryCommit, "flex-1")}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {running ? "Mapping…" : "Map water"}
            </button>
            {hasResult && (
              <button
                type="button"
                onClick={onClear}
                disabled={running}
                className={btnGhost}
              >
                <Trash2 className="size-3.5" />
                Clear
              </button>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Waves className="mt-0.5 size-3 shrink-0 opacity-70" />
            Descriptive product: a thresholded spectral index, with no model and
            no trained legend.
          </p>
        </Section>
      </motion.div>
    )
  }
)
