import { forwardRef, useState } from "react"
import { motion } from "motion/react"
import { X, ChevronDown, ChevronUp, ChartColumn, Plus } from "lucide-react"
import type { PredictResult } from "@/lib/types"
import { useAuth } from "@/lib/auth"

interface ResultsPanelProps {
  result: PredictResult
  onClose: () => void
  onNewClassification: () => void
}

export const ResultsPanel = forwardRef<HTMLDivElement, ResultsPanelProps>(
  function ResultsPanel({ result, onClose, onNewClassification }, ref) {
    const [collapsed, setCollapsed] = useState(false)
    const { goAnalysis } = useAuth()

    const isLulcOnly =
      !!result.lulc &&
      !(result.n_dates > 0) &&
      !(result.confidence_uri && result.confidence_uri.length > 0)

    // class_stats is declared non-optional but a run that made no
    // classification marshals it as null, so the list is defaulted here rather
    // than trusted: reading it directly took the whole application down.
    const stats = isLulcOnly
      ? (result.lulc?.composition ?? []).map((c) => ({
          class_id: c.class_id,
          name: c.name,
          color: c.color,
          pct: c.pct,
        }))
      : (result.class_stats ?? [])

    const subtitle = isLulcOnly
      ? `MapBiomas ${result.lulc?.year ?? 2023} · ${result.lulc?.metrics.area_ha.toFixed(1) ?? "—"} ha`
      : `${result.n_dates} scenes · ${result.date_range?.[0] ?? "—"} → ${result.date_range?.[1] ?? "—"}`

    return (
      <motion.div
        ref={ref}
        className="panel app-no-drag absolute bottom-[calc(var(--map-foot,0px)+0.75rem)] left-[23.5rem] right-16 z-[1000] mx-auto max-w-[36rem] rounded-md"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow !text-foreground">
              {isLulcOnly ? "Land cover" : "Result"}
            </span>
            <span className="telemetry text-[11px] text-muted-foreground">
              {subtitle}
              {!isLulcOnly && result.mean_confidence > 0 && (
                <> · conf {(result.mean_confidence * 100).toFixed(0)}%</>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goAnalysis}
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
              title="Open analysis"
            >
              <ChartColumn className="size-3.5" />
              Analysis
            </button>
            <button
              type="button"
              onClick={onNewClassification}
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Start a new classification"
            >
              <Plus className="size-3.5" />
              New
            </button>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="text-muted-foreground hover:text-foreground"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              title="Close result"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            <hr className="hairline" />
            <div className="flex flex-col gap-3 p-3">
              <ul className="flex flex-col gap-1.5">
                {stats.slice(0, 5).map((s) => (
                  <li key={s.class_id} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="w-40 shrink-0 truncate">{s.name}</span>
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                      />
                    </span>
                    <span className="telemetry w-12 shrink-0 text-right text-foreground">
                      {s.pct.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-muted-foreground">
                {isLulcOnly
                  ? "MapBiomas cover on the map. Open Analysis for groups, diversity and details."
                  : "Overlay visibility, swipe, and opacity live in Overlay Tools. Open Analysis for cover map, VI series and phenology."}
              </p>
            </div>
          </>
        )}
      </motion.div>
    )
  }
)
