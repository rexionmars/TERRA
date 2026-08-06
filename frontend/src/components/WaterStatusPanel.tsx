import { forwardRef, useState } from "react"
import { motion } from "motion/react"
import { AlertTriangle, ChevronDown, ChevronUp, Trash2, X } from "lucide-react"
import type { WaterAnalysis } from "@/lib/types"
import { BLUES_STOPS } from "@/lib/compositeCatalog"

interface WaterStatusPanelProps {
  water: WaterAnalysis | null
  onClear: () => void
}

function Ramp({
  stops,
  lowLabel,
  highLabel,
}: {
  stops: string[]
  lowLabel: string
  highLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2 w-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${stops.join(", ")})` }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="telemetry mt-0.5 truncate text-sm text-foreground">
        {value}
      </div>
      {sub && (
        <div className="telemetry truncate text-[10px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  )
}

/**
 * Surface-water run summary.
 *
 * Uses the same bottom bar as the classification and composition results, so
 * the three products read as one family rather than three conventions.
 *
 * Every figure is stated against what it was measured on: water fractions are a
 * percentage of the pixels observed on that date, not of the AOI, so a partly
 * clouded date cannot read as dry.
 */
export const WaterStatusPanel = forwardRef<
  HTMLDivElement,
  WaterStatusPanelProps
>(function WaterStatusPanel({ water, onClear }, ref) {
  const [collapsed, setCollapsed] = useState(false)
  const hasResult = !!water

  const peak = water?.series.find((d) => d.date === water.peak_date)
  const clipped = water?.series.filter((d) => d.threshold_clipped).length ?? 0
  const degenerate =
    water?.series.filter((d) => d.threshold_degenerate).length ?? 0

  const subtitle = water
    ? `${water.n_dates} ${water.n_dates === 1 ? "date" : "dates"} · ${water.date_range[0]} → ${water.date_range[1]}`
    : ""

  return (
    <motion.div
      ref={ref}
      className="panel app-no-drag absolute bottom-3 left-[23.5rem] right-16 z-[1000] mx-auto max-w-[36rem] rounded-md"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="eyebrow shrink-0 !text-foreground">
            Surface water
          </span>
          <span className="telemetry truncate text-[11px] text-muted-foreground">
            {water ? `${water.index} · ${subtitle}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasResult}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
            title="Clear surface water from map"
          >
            <Trash2 className="size-3.5" />
            Clear
          </button>
          <button
            type="button"
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
            type="button"
            onClick={onClear}
            disabled={!hasResult}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Clear surface water"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {!collapsed && water && (
        <>
          <hr className="hairline" />
          <div className="flex flex-col gap-3 p-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Water is the high tail of the index, cut at zero. Fractions are a
              percentage of the pixels observed on each date, not of the{" "}
              {water.aoi_area_ha.toFixed(1)} ha AOI, so a partly clouded date is
              not reported as dry.
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric
                label="Peak water"
                value={`${water.peak_water_fraction_pct.toFixed(1)}%`}
                sub={water.peak_date}
              />
              <Metric
                label="Peak area"
                value={peak ? `${peak.area_ha.toFixed(2)} ha` : "—"}
                sub={
                  peak ? `${peak.water_pixels.toLocaleString()} px` : undefined
                }
              />
              <Metric
                label="Ephemeral"
                value={`${water.ephemeral_area_ha.toFixed(2)} ha`}
                sub="wet on some dates"
              />
              <Metric
                label="Persistent"
                value={`${water.persistent_area_ha.toFixed(2)} ha`}
                sub="standing water"
              />
            </div>

            {/* Same ramp the occurrence raster is drawn with, so the legend
                describes the image on the map. */}
            <Ramp
              stops={BLUES_STOPS}
              lowLabel="never water"
              highLabel="water on every observed date"
            />

            {(clipped > 0 || degenerate > 0) && (
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-primary/80" />
                <span>
                  {clipped > 0 && (
                    <>
                      The comparison Otsu threshold hit its bound on {clipped} of{" "}
                      {water.n_dates} dates and is a bound there, not an
                      estimate.{" "}
                    </>
                  )}
                  {degenerate > 0 && (
                    <>
                      {degenerate} {degenerate === 1 ? "date" : "dates"} had too
                      few observations to threshold.
                    </>
                  )}
                </span>
              </p>
            )}

            <p className="text-[10px] text-muted-foreground">
              Visibility and opacity for this layer live in Overlay Tools,
              alongside the prediction and composition overlays.
            </p>
          </div>
        </>
      )}
    </motion.div>
  )
})
