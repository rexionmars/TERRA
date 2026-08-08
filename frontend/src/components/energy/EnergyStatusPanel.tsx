/**
 * The energy result, in the bottom slot the map screen already uses.
 *
 * Classification, surface water and compositions all report into a panel at the
 * foot of the map, and the energy screen reported into a column beside a boxed
 * map instead -- the same kind of answer given two shapes, which is what made
 * the two screens read as two applications.
 *
 * It carries the headline figures and sends the reader on. The loss waterfall,
 * the generation profile and the tracking comparison are long, and a panel that
 * tried to hold them would either scroll for a page or crowd the map they are
 * measured over. The analysis screen renders them from the same components, so
 * there is one rendering and this is a route to it rather than a second copy.
 */
import { forwardRef, useState } from "react"
import { motion } from "motion/react"
import { ChartColumn, ChevronDown, ChevronUp, Trash2, X } from "lucide-react"
import type { SolarProductId, SolarResults } from "@/lib/energyState"
import type { WindAnalysis } from "@/lib/types"
import { solarProduct } from "@/components/energy/solarProducts"
import { cn } from "@/lib/utils"
import { btnIcon } from "@/components/ui/buttons"

function Figure({
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
      <div className="eyebrow !text-micro">{label}</div>
      <div className="telemetry mt-0.5 truncate text-emphasis text-foreground">
        {value}
      </div>
      {sub && (
        <div className="telemetry truncate text-micro text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  )
}

/** Headline figures per product, each next to the assumption behind it. */
function solarFigures(
  product: SolarProductId,
  results: SolarResults
): { figures: { label: string; value: string; sub?: string }[]; note: string } | null {
  if (product === "resource" && results.resource) {
    const r = results.resource
    return {
      figures: [
        {
          label: "GHI",
          value: r.resource.ghi_annual_kwh_m2.toFixed(0),
          sub: `kWh/m2/yr · CV ${r.resource.ghi_cv_pct.toFixed(1)}%`,
        },
        {
          label: "Optimum tilt",
          value: `${r.geometry.optimal_tilt_deg.toFixed(0)}°`,
          sub: `${r.geometry.gain_over_horizontal_pct.toFixed(1)}% over horizontal`,
        },
        {
          label: "Specific yield",
          value: r.pv.specific_yield_kwh_kwp_year.toFixed(0),
          sub: `kWh/kWp/yr at PR ${r.pv.performance_ratio.toFixed(2)}`,
        },
        {
          label: "Capacity factor",
          value: `${r.pv.capacity_factor_pct.toFixed(1)}%`,
          sub: `${r.resource.n_years} years`,
        },
      ],
      note: r.grid_note,
    }
  }
  if (product === "terrain" && results.terrain) {
    const t = results.terrain
    return {
      figures: [
        { label: "Minimum", value: t.poa_min.toFixed(0) },
        { label: "Mean", value: t.poa_mean.toFixed(0), sub: t.unit },
        { label: "Maximum", value: t.poa_max.toFixed(0) },
        {
          label: "Spatial spread",
          value: `${t.poa_std_pct.toFixed(1)}%`,
          sub: "standard deviation",
        },
      ],
      note: `${t.season} · ${t.dem_source}. Drawn on the scale reported with the raster, not on this layer's own range.`,
    }
  }
  if (product === "siting" && results.siting) {
    const s = results.siting
    return {
      figures: [
        {
          label: "Suitable, no conflict",
          value: `${s.suitable_no_conflict_ha.toFixed(1)} ha`,
        },
        {
          label: "Suitable, on cropland",
          value: `${s.suitable_cropland_ha.toFixed(1)} ha`,
          sub: "reported apart, never summed",
        },
      ],
      note: `Slope limits ${s.thresholds.slope_acceptable_deg} and ${s.thresholds.slope_restrictive_deg} degrees. ${s.thresholds.note}`,
    }
  }
  if (product === "energy" && results.energy) {
    const e = results.energy
    const pr = e.performance_ratio
    return {
      figures: [
        {
          label: "Applied ratio",
          value: pr.applied.toFixed(3),
          sub: pr.applied_source,
        },
        {
          label: "Derived ratio",
          value: pr.derived.toFixed(4),
          sub: `modelled ${pr.modelled.toFixed(4)}`,
        },
        {
          label: "Suitable capacity",
          value: `${e.plant.suitable.capacity_dc_mw.toFixed(1)} MW`,
          sub: `${e.plant.suitable.area_ha.toFixed(0)} ha, no conflict`,
        },
        {
          label: "Energy P50",
          value: `${e.plant.suitable.energy.p50_exceedance_gwh_year.toFixed(1)} GWh/yr`,
          sub: `P90 ${e.plant.suitable.energy.p90_exceedance_gwh_year.toFixed(1)}`,
        },
      ],
      note: e.plant.uncertainty.statement,
    }
  }
  return null
}

function windFigures(w: WindAnalysis) {
  return {
    figures: [
      {
        label: "Mean speed",
        value: `${w.hub.mean_speed_ms.toFixed(2)} m/s`,
        sub: `at ${w.hub_height_m.toFixed(0)} m`,
      },
      {
        label: "Gross capacity factor",
        value: `${w.hub.gross_capacity_factor_pct.toFixed(1)}%`,
        sub: "gross, per turbine",
      },
      {
        label: "Gross annual energy",
        value: `${w.hub.gross_annual_energy_mwh_per_turbine.toFixed(0)} MWh`,
        sub: "per turbine",
      },
      {
        label: "Record",
        value: `${w.record_years.toFixed(0)} years`,
        sub: w.record_window,
      },
    ],
    note: w.qualifier,
  }
}

export interface EnergyStatusPanelProps {
  tab: "solar" | "wind"
  selected: SolarProductId
  results: SolarResults
  wind: WindAnalysis | null
  onClear: () => void
  onOpenAnalysis: () => void
  /** Left edge, so the panel clears the setup column beside it. */
  leftOffsetClass?: string
}

export const EnergyStatusPanel = forwardRef<
  HTMLDivElement,
  EnergyStatusPanelProps
>(function EnergyStatusPanel(
  { tab, selected, results, wind, onClear, onOpenAnalysis, leftOffsetClass = "left-[23.5rem]" },
  ref
) {
  const [collapsed, setCollapsed] = useState(false)

  const data =
    tab === "wind"
      ? wind
        ? windFigures(wind)
        : null
      : solarFigures(selected, results)
  if (!data) return null

  const title =
    tab === "wind" ? "Wind screening" : solarProduct(selected).label

  return (
    <motion.div
      ref={ref}
      className={cn(
        "panel app-no-drag absolute bottom-[calc(var(--map-foot,0px)+0.75rem)] right-16 z-[1000] mx-auto max-w-[40rem] rounded-md",
        leftOffsetClass
      )}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="eyebrow !text-foreground">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenAnalysis}
            className="flex h-7 items-center gap-1 rounded-sm px-2 text-body text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="Open the full result on the analysis screen"
          >
            <ChartColumn className="size-3.5" />
            Analysis
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex h-7 items-center gap-1 rounded-sm px-2 text-body text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="Clear this result"
          >
            <Trash2 className="size-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand result" : "Collapse result"}
            className={btnIcon}
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
            aria-label="Close result"
            className={btnIcon}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <hr className="hairline" />
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.figures.map((f) => (
                <Figure key={f.label} {...f} />
              ))}
            </div>
            {/* The assumption travels with the figures, here as everywhere. */}
            <p className="text-micro leading-relaxed text-muted-foreground">
              {data.note}
            </p>
          </div>
        </>
      )}
    </motion.div>
  )
})
