import { forwardRef, useState } from "react"
import { motion } from "motion/react"
import { AlertTriangle, ChevronDown, ChevronUp, Trash2, X } from "lucide-react"
import type {
  SolarAnalysis,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
} from "@/lib/types"
import { RDYLGN_STOPS } from "@/lib/compositeCatalog"

interface SolarStatusPanelProps {
  solar: SolarAnalysis | null
  /** Present when a terrain map is on the map; carries its own range. */
  terrain?: SolarTerrainAnalysis | null
  /** Present when a siting map is on the map; carries its own classes. */
  siting?: SolarSitingAnalysis | null
  onClear: () => void
}

/**
 * Key for the terrain raster.
 *
 * The ramp is imported rather than restated so it cannot drift from the image
 * it describes, and the labels carry the actual range because the raster is
 * stretched to its own percentiles.
 */
function Ramp({ lowLabel, highLabel }: { lowLabel: string; highLabel: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2 w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${RDYLGN_STOPS.join(", ")})`,
        }}
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
 * Solar resource summary, in the shared bottom bar.
 *
 * Every figure is shown with the assumption that produced it: the grid the
 * radiation resolves on, and the performance ratio behind the yield.
 */
export const SolarStatusPanel = forwardRef<
  HTMLDivElement,
  SolarStatusPanelProps
>(function SolarStatusPanel({ solar, terrain, siting, onClear }, ref) {
  const [collapsed, setCollapsed] = useState(false)
  const hasResult = !!solar || !!terrain || !!siting

  const trendSignificant =
    !!solar && solar.resource.trend_p_value < 0.05

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
            Solar resource
          </span>
          <span className="telemetry truncate text-[11px] text-muted-foreground">
            {siting
              ? `siting · ${siting.dem_source}`
              : terrain
                ? `${terrain.season} · ${terrain.dem_source}`
                : solar
                  ? `${solar.resource.n_years} years · ${solar.lat.toFixed(2)}, ${solar.lon.toFixed(2)}`
                  : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasResult}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
            title="Clear solar result"
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
            title="Clear solar result"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {!collapsed && (terrain || siting) && (
        <>
          <hr className="hairline" />
          <div className="flex flex-col gap-3 p-3">
            {siting ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Metric
                    label="Suitable, no conflict"
                    value={`${siting.suitable_no_conflict_ha.toFixed(1)} ha`}
                  />
                  <Metric
                    label="Suitable, on cropland"
                    value={`${siting.suitable_cropland_ha.toFixed(1)} ha`}
                    sub="reported apart, never summed"
                  />
                </div>
                <ul className="flex flex-col gap-1">
                  {siting.classes.map((c) => (
                    <li
                      key={c.code}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {c.name}
                      </span>
                      <span className="telemetry shrink-0 text-foreground">
                        {c.area_ha.toFixed(1)} ha
                      </span>
                      <span className="telemetry w-12 shrink-0 text-right text-muted-foreground">
                        {c.pct.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-primary/80" />
                  <span>
                    Slope limits {siting.thresholds.slope_acceptable_deg} and{" "}
                    {siting.thresholds.slope_restrictive_deg} degrees.{" "}
                    {siting.thresholds.note}
                  </span>
                </p>
              </>
            ) : terrain ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label="Minimum"
                    value={terrain.poa_min.toFixed(0)}
                    sub={terrain.unit}
                  />
                  <Metric
                    label="Mean"
                    value={terrain.poa_mean.toFixed(0)}
                    sub={`spread ${terrain.poa_std_pct.toFixed(1)}%`}
                  />
                  <Metric
                    label="Maximum"
                    value={terrain.poa_max.toFixed(0)}
                    sub={terrain.unit}
                  />
                  <Metric
                    label="Slope"
                    value={`${terrain.slope_mean_deg.toFixed(1)}°`}
                    sub={`max ${terrain.slope_max_deg.toFixed(0)}°`}
                  />
                </div>
                <Ramp
                  lowLabel={`${terrain.poa_min.toFixed(0)} ${terrain.unit}`}
                  highLabel={`${terrain.poa_max.toFixed(0)} ${terrain.unit}`}
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Stretched between its own 2nd and 98th percentiles: the spread
                  within an AOI is a few percent, so a fixed scale would render
                  every AOI flat. Terrain from {terrain.dem_source}.
                </p>
              </>
            ) : null}
          </div>
        </>
      )}

      {!collapsed && solar && !terrain && !siting && (
        <>
          <hr className="hairline" />
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric
                label="GHI"
                value={`${solar.resource.ghi_annual_kwh_m2.toFixed(0)}`}
                sub={`kWh/m2/yr · CV ${solar.resource.ghi_cv_pct.toFixed(1)}%`}
              />
              <Metric
                label="Optimum tilt"
                value={`${solar.geometry.optimal_tilt_deg.toFixed(0)}°`}
                sub={`+${solar.geometry.gain_over_horizontal_pct.toFixed(1)}% over flat`}
              />
              <Metric
                label="Specific yield"
                value={`${solar.pv.specific_yield_kwh_kwp_year.toFixed(0)}`}
                sub="kWh/kWp/yr"
              />
              <Metric
                label="Capacity factor"
                value={`${solar.pv.capacity_factor_pct.toFixed(1)}%`}
                sub={`PR ${solar.pv.performance_ratio.toFixed(2)}`}
              />
            </div>

            {/* The assumption behind the yield, stated rather than implied. */}
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-primary/80" />
              <span>
                Yield computed at a performance ratio of{" "}
                {solar.pv.performance_ratio.toFixed(2)} (
                {solar.pv.performance_ratio_source}). This chain models{" "}
                {solar.pv.performance_ratio_modelled.toFixed(3)}, which runs high
                because soiling, inter-row shading, degradation, availability and
                cabling are not modelled.
              </span>
            </p>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {solar.grid_note}
            </p>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              P10 to P90 {solar.resource.ghi_p10.toFixed(0)} to{" "}
              {solar.resource.ghi_p90.toFixed(0)} kWh/m2/yr over{" "}
              {solar.resource.n_years} years
              {trendSignificant
                ? ` · trend ${solar.resource.trend_per_year > 0 ? "+" : ""}${solar.resource.trend_per_year.toFixed(2)} per year (p = ${solar.resource.trend_p_value.toFixed(3)})`
                : ` · no detectable trend (p = ${solar.resource.trend_p_value.toFixed(3)})`}
              {solar.resource.clear_sky_index != null
                ? ` · clear-sky index ${solar.resource.clear_sky_index.toFixed(3)}`
                : ""}
            </p>
          </div>
        </>
      )}
    </motion.div>
  )
})
