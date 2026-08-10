/**
 * The three solar result sections, as shown on screen.
 *
 * Live outside AnalysisPage so the energy screen and the analysis screen render
 * them from one definition. Duplicating them would let the two drift, and these
 * are the blocks whose figures each carry the assumption that produced them:
 * the ramp drawn on the sidecar's scale rather than the layer's own range, the
 * beam share behind the shading figure, and the siting thresholds being project
 * conventions.
 *
 * Each takes only the payload it renders, so none of them can read page state.
 */
import type {
  SolarAnalysis,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
} from "@/lib/types"
import {
  ContinuousRamp,
  PanelTile,
  PowerProvenanceNote,
  WaterFigure,
} from "@/components/analysisPrimitives"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Label,
} from "recharts"

/**
 * The point solar resource.
 *
 * Needs no scene, so it can be the only product a run carries. Every figure is
 * shown with the assumption behind it.
 */
export function SolarResourceSection({ solar }: { solar: SolarAnalysis }) {
  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Solar resource</p>
        <p className="telemetry text-[10px] text-muted-foreground">
          {solar.resource.n_years} years ·{" "}
          {solar.lat.toFixed(2)}, {solar.lon.toFixed(2)}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={solar.resource.monthly.map((m) => ({
            month: String(m.month).padStart(2, "0"),
            ghi: m.ghi,
            dni: m.dni,
            dhi: m.dhi,
          }))}
          margin={{ top: 6, right: 14, left: 4, bottom: 22 }}
        >
          {/*
            The month axis stays categorical, and that is correct here: this is
            a twelve-value climatology on evenly spaced months, not an
            irregular acquisition calendar. The index charts had to move to a
            numeric time axis for exactly the opposite reason.
          */}
          <XAxis
            dataKey="month"
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickMargin={6}
          >
            <Label
              value="Month"
              position="insideBottom"
              offset={-14}
              style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            />
          </XAxis>
          <YAxis
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => v.toFixed(1)}
            width={52}
          >
            {/* The unit was in a caption below the chart. Nature requires it on
                the axis, and a reader reading a value should not have to look
                somewhere else to know what it is. */}
            <Label
              value="Irradiation (kWh m⁻² d⁻¹)"
              angle={-90}
              position="insideLeft"
              style={{
                fontSize: 12,
                fill: "var(--muted-foreground)",
                textAnchor: "middle",
              }}
            />
          </YAxis>
          <Tooltip
            formatter={(v: number) => v.toFixed(2)}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 11,
            }}
          />
          {/* Above the plot: a bottom legend shares the band the axis title
              occupies, and "Month" was drawn through the series keys. */}
          <Legend
            verticalAlign="top"
            align="right"
            height={20}
            wrapperStyle={{ fontSize: 11, paddingBottom: 2 }}
            iconType="plainline"
          />
          {/* The verified triple, and a dash each: GHI, DNI and DHI are not
              independent -- GHI is the sum of DHI and the projected DNI -- so
              they are read together and have to stay separable in greyscale. */}
          {[
            { key: "ghi", label: "GHI", stroke: "var(--series-ndvi)", dash: undefined },
            { key: "dni", label: "DNI", stroke: "var(--series-evi)", dash: "6 3" },
            { key: "dhi", label: "DHI", stroke: "var(--series-savi)", dash: "2 3" },
          ].map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.stroke}
              strokeWidth={1.8}
              strokeDasharray={s.dash}
              dot={{ r: 1.8, strokeWidth: 0, fill: s.stroke }}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div
        className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4"
        style={{ borderColor: "var(--border)" }}
      >
        <WaterFigure
          label="GHI"
          value={solar.resource.ghi_annual_kwh_m2.toFixed(0)}
          sub={`kWh/m2/yr · CV ${solar.resource.ghi_cv_pct.toFixed(1)}%`}
        />
        <WaterFigure
          label="Optimum tilt"
          value={`${solar.geometry.optimal_tilt_deg.toFixed(0)}°`}
          sub={`+${solar.geometry.gain_over_horizontal_pct.toFixed(1)}% over flat`}
        />
        <WaterFigure
          label="Specific yield"
          value={solar.pv.specific_yield_kwh_kwp_year.toFixed(0)}
          sub={`kWh/kWp/yr · PR ${solar.pv.performance_ratio.toFixed(2)}`}
        />
        <WaterFigure
          label="Capacity factor"
          value={`${solar.pv.capacity_factor_pct.toFixed(1)}%`}
          sub={`modelled PR ${solar.pv.performance_ratio_modelled.toFixed(3)}`}
        />
      </div>

      {solar.geometry.tilt_tolerance.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Tilt tolerance:{" "}
          {solar.geometry.tilt_tolerance
            .map(
              (t) =>
                `${t.deviation_deg.toFixed(0)}° costs ${t.loss_pct.toFixed(2)}%`
            )
            .join(" · ")}
        </p>
      )}

      {/*
        The grid cell, kept where the paragraph about it was removed: two AOIs
        tens of kilometres apart resolve to one radiation cell and return the
        same series, so identical numbers would otherwise have no explanation.
      */}
      <div className="mt-2 text-[10px] text-muted-foreground">
        <p className="telemetry">1° radiation cell, not site-specific</p>
        <PowerProvenanceNote provenance={solar.power_provenance} />
      </div>
    </section>
  )
}

/** Terrain irradiation: the raster, its ramp and the figures over the area. */
export function SolarTerrainSection({
  terrain,
}: {
  terrain: SolarTerrainAnalysis
}) {
  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">
          Terrain irradiation · {terrain.season}
        </p>
        <p className="telemetry text-[10px] text-muted-foreground">
          {terrain.dem_source} ·{" "}
          {terrain.hourly_years} years
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <PanelTile
            title={`Plane-of-array · ${terrain.unit}`}
            uri={terrain.overlay_uri}
            empty="No terrain raster"
          />
          {/* Endpoints come from the scale the sidecar drew on, not
              from this layer's own range: a seasonal layer shares its
              domain with the other season and is narrower than it. */}
          <ContinuousRamp
            palette={terrain.scale.palette}
            lowLabel={terrain.scale.min.toFixed(
              terrain.scale.decimals
            )}
            highLabel={terrain.scale.max.toFixed(
              terrain.scale.decimals
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 self-start">
          <WaterFigure
            label="Minimum"
            value={terrain.poa_min.toFixed(0)}
          />
          <WaterFigure
            label="Maximum"
            value={terrain.poa_max.toFixed(0)}
          />
          <WaterFigure
            label="Mean"
            value={terrain.poa_mean.toFixed(0)}
            sub={terrain.unit}
          />
          <WaterFigure
            label="Spatial spread"
            value={`${terrain.poa_std_pct.toFixed(1)}%`}
            sub="standard deviation"
          />
          <WaterFigure
            label="Mean slope"
            value={`${terrain.slope_mean_deg.toFixed(1)}°`}
            sub={`max ${terrain.slope_max_deg.toFixed(1)}°`}
          />
          {terrain.shading_mean_pct !== null && (
            <WaterFigure
              label="Horizon shading"
              value={`${terrain.shading_mean_pct.toFixed(2)}%`}
              sub={
                terrain.shading_max_pct !== null
                  ? `max ${terrain.shading_max_pct.toFixed(1)}% of beam`
                  : "of beam irradiance"
              }
            />
          )}
        </div>
      </div>
      {/* The beam share as a figure. It was a paragraph explaining that the
          atmospheric resource has no structure at this scale and that what
          varies is the inclined surface -- method, and the same sentence for
          every AOI. The number it ended on is what changes. */}
      {terrain.beam_fraction > 0 && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          <span className="telemetry">
            Beam share {(terrain.beam_fraction * 100).toFixed(0)}%
          </span>{" "}
          of horizontal irradiation · horizon shading applies to this component
        </p>
      )}
      <PowerProvenanceNote
        provenance={terrain.power_provenance}
      />
    </section>
  )
}

/** Photovoltaic siting: the class raster, the two areas and the class list. */
export function SolarSitingSection({
  siting,
}: {
  siting: SolarSitingAnalysis
}) {
  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <p className="eyebrow mb-3">Photovoltaic siting</p>
      {/* Full-width, like the water occurrence tile: a 4:3 box across a whole
          panel runs off the bottom of the window on a wide screen. */}
      <PanelTile
        title="Suitability classes"
        uri={siting.overlay_uri}
        empty="No siting raster"
        fullWidth
      />
      <div className="mb-3 mt-3 grid grid-cols-2 gap-3">
        <WaterFigure
          label="Suitable, no conflict"
          value={`${siting.suitable_no_conflict_ha.toFixed(1)} ha`}
        />
        <WaterFigure
          label="Suitable, on cropland"
          value={`${siting.suitable_cropland_ha.toFixed(1)} ha`}
          sub="reported apart, never summed"
        />
      </div>
      <ul className="flex flex-col gap-1.5">
        {siting.classes.map((c) => (
          <li key={c.code} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: c.color }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="telemetry w-20 shrink-0 text-right">
              {c.area_ha.toFixed(1)} ha
            </span>
            <span className="telemetry w-12 shrink-0 text-right text-muted-foreground">
              {c.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      {/* The thresholds as figures, and the one thing the classes do not
          account for -- without it "suitable" reads as permitted. */}
      <p className="mt-3 text-[10px] text-muted-foreground">
        <span className="telemetry">
          Slope limits {siting.thresholds.slope_acceptable_deg}° /{" "}
          {siting.thresholds.slope_restrictive_deg}°
        </span>{" "}
        · legal constraints not checked
      </p>
    </section>
  )
}
