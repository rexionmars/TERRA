import { motion } from "motion/react"
import { AlertTriangle, X } from "lucide-react"
import type { WaterAnalysis } from "@/lib/types"

/**
 * Summary of a surface-water run, anchored bottom-right like the other status
 * panels.
 *
 * Every figure is stated against what it was measured on. Water fractions are a
 * percentage of the pixels observed on that date, not of the AOI, so a partly
 * clouded date cannot read as dry.
 */
export function WaterStatusPanel({
  water,
  onClose,
}: {
  water: WaterAnalysis
  onClose: () => void
}) {
  const peak = water.series.find((d) => d.date === water.peak_date)
  const clippedDates = water.series.filter((d) => d.threshold_clipped).length
  const degenerate = water.series.filter((d) => d.threshold_degenerate).length

  return (
    <motion.div
      className="panel app-no-drag absolute bottom-3 right-3 z-[1000] flex w-[19rem] flex-col gap-3 rounded-md p-4"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 18 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="telemetry text-[10px] text-primary">SURFACE WATER</p>
          <h2 className="mt-0.5 truncate text-sm font-semibold">
            {water.index} · {water.n_dates}{" "}
            {water.n_dates === 1 ? "date" : "dates"}
          </h2>
          <p className="telemetry mt-0.5 text-[10px] text-muted-foreground">
            {water.date_range[0]} → {water.date_range[1]}
          </p>
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

      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Peak water"
          value={`${water.peak_water_fraction_pct.toFixed(1)}%`}
          sub={water.peak_date}
        />
        <Metric
          label="Peak area"
          value={peak ? `${peak.area_ha.toFixed(2)} ha` : "—"}
          sub={peak ? `${peak.water_pixels.toLocaleString()} px` : undefined}
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

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Fractions are a percentage of the pixels observed on each date, not of
        the {water.aoi_area_ha.toFixed(1)} ha AOI, so a partly clouded date is
        not reported as dry.
      </p>

      {(clippedDates > 0 || degenerate > 0) && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-primary/80" />
          <span>
            {clippedDates > 0 && (
              <>
                The comparison Otsu threshold hit its bound on {clippedDates} of{" "}
                {water.n_dates} dates and is a bound there, not an estimate.{" "}
              </>
            )}
            {degenerate > 0 && (
              <>
                {degenerate}{" "}
                {degenerate === 1 ? "date had" : "dates had"} too few
                observations to threshold.
              </>
            )}
          </span>
        </p>
      )}
    </motion.div>
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
    <div className="ar-raised px-2.5 py-1.5">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="telemetry mt-0.5 text-sm text-foreground">{value}</div>
      {sub && (
        <div className="telemetry text-[9px] text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}
