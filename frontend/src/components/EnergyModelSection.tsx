/**
 * The photovoltaic energy model, as shown on screen.
 *
 * Exported as PAGES rather than as one section. The seven blocks below run to
 * several thousand pixels together and no container in the application is that
 * tall, so as a single column the reading was always seen through a viewport
 * holding a fraction of it. `energyModelSections` at the foot of this file is the
 * entry point; the blocks themselves are unchanged and each still carries the
 * assumption that produced its figures.
 *
 * Every grid measures the CONTAINER, not the window. The breakpoints here were
 * `sm:`/`lg:`, which read the viewport: hosted in a panel on a wide screen this
 * section took four-column layouts at widths where two columns collide, which
 * is why the reading looked both cramped and half-empty. Three query roots are
 * declared -- the section, the performance-ratio scale and the plant card --
 * because each is a different width from its parent.
 */
import type { ReactNode } from "react"
import type {
  EnergyCapacityDensity,
  EnergyModelAnalysis,
  EnergyPlantClass,
} from "@/lib/types"
import {
  Chip,
  PowerProvenanceNote,
  rampStop,
  Stat,
  StatGrid,
  WaterFigure,
} from "@/components/analysisPrimitives"
import type { ReadingSection } from "@/components/energy/readingSections"
import { areaHa, capacityMw } from "@/lib/energyFormat"
import { PALETTE_STOPS, paletteGradient } from "@/lib/palettes"
import { cn } from "@/lib/utils"

/**
 * The chain from global horizontal irradiation to delivered AC energy.
 *
 * The rail on the left is what separates the steps inside the performance
 * ratio from the ones outside it. The component-closure residual between the
 * published global horizontal irradiation and the horizontal plane rebuilt
 * from the beam and diffuse components is a property of the radiation product;
 * drawn inside the chain it reads as a plant loss the site would incur.
 */
function EnergyWaterfall({ energy }: { energy: EnergyModelAnalysis }) {
  const w = energy.loss_waterfall
  const steps = w.steps
  const factorSpan = Math.max(
    ...steps.map((s) => (s.factor == null ? 0 : Math.abs(1 - s.factor))),
    0.0001
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Loss waterfall · global horizontal to AC</p>
        <p className="telemetry text-meta text-muted-foreground">
          base {w.base.ghi_hourly_kwh_m2_year.toFixed(2)} kWh/m2/yr ·{" "}
          {w.base.hourly_window}
        </p>
      </div>

      <StatGrid>
        <Stat
          label="Daily climatology"
          value={`${w.base.climatology_window} · ${w.base.ghi_climatology_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
        />
      </StatGrid>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-0 border-l-2"
            style={{ borderColor: "rgb(var(--p-accent))" }}
          />
          inside the performance ratio
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-0 border-l-2 border-dashed"
          />
          outside it: not a plant loss and not multiplied into the ratio
        </span>
        <span>
          bar width is the departure from unity, on a common scale (largest{" "}
          {(factorSpan * 100).toFixed(1)}%)
        </span>
      </div>

      <ul className="flex flex-col gap-px">
        {steps.map((s) => {
          const inPR = s.in_performance_ratio
          const dev = s.factor == null ? 0 : s.factor - 1
          const width = (Math.abs(dev) / factorSpan) * 50
          return (
            <li
              key={s.step}
              className={cn(
                "border-l-2 py-1.5 pl-2.5 pr-1",
                inPR ? "" : "bg-background"
              )}
              style={{
                borderColor: inPR ? "rgb(var(--p-accent))" : "var(--border)",
                borderLeftStyle: inPR ? "solid" : "dashed",
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="telemetry w-5 shrink-0 text-meta text-muted-foreground">
                  {s.step}
                </span>
                <span className="min-w-[10rem] flex-1 text-xs text-foreground">
                  {s.label}
                </span>
                <Chip>{s.kind.replace(/_/g, " ")}</Chip>
                {!inPR && <Chip>outside PR</Chip>}
                <span className="telemetry w-16 shrink-0 text-right text-body text-foreground">
                  {s.factor == null ? "—" : s.factor.toFixed(6)}
                </span>
                {/* The bar needs 49rem of row before the columns beside it
                    collide, which no width this panel offers reaches; the
                    cumulative-ratio column is what carries the departure
                    there. Kept as a literal so a wider host restores it. */}
                <span className="bg-background relative hidden h-1.5 w-24 shrink-0 @min-[49rem]:block">
                  <span
                    className="absolute inset-y-0"
                    style={{
                      width: `${width}%`,
                      left: dev < 0 ? `${50 - width}%` : "50%",
                      backgroundColor:
                        dev === 0
                          ? "var(--border)"
                          : dev < 0
                            ? PALETTE_STOPS.rdbu_r[13]
                            : PALETTE_STOPS.rdbu_r[3],
                    }}
                  />
                </span>
                <span className="flex w-full justify-end gap-x-2.5 @min-[42rem]:w-auto">
                  <span className="telemetry w-36 shrink-0 text-right text-body text-foreground">
                    {s.energy_after.toFixed(2)}{" "}
                    <span className="text-muted-foreground">{s.units}</span>
                  </span>
                  <span className="telemetry w-16 shrink-0 text-right text-body text-muted-foreground">
                    {s.cumulative_ratio == null
                      ? "—"
                      : s.cumulative_ratio.toFixed(6)}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-meta text-muted-foreground">
        Outside the performance ratio:{" "}
        <span className="telemetry">{w.outside_performance_ratio.join(" · ")}</span>
      </p>
    </div>
  )
}

/**
 * The performance ratio against its external benchmark.
 *
 * The applied ratio is drawn on the same axis as the band the Global Solar
 * Atlas implies at this site, so a reader sees whether it is bracketed by an
 * external measurement or only asserted. The modelled and derived ratios are
 * on the axis too, at their distance from the band.
 */
function PerformanceRatioScale({ energy }: { energy: EnergyModelAnalysis }) {
  const pr = energy.performance_ratio
  const band = pr.gsa_implied_band
  const hasBand = band.length >= 2
  const lo = hasBand ? Math.min(...band) : 0
  const hi = hasBand ? Math.max(...band) : 0
  const marks = [
    { key: "derived", label: "derived", value: pr.derived, accent: false },
    { key: "applied", label: "applied", value: pr.applied, accent: true },
    { key: "modelled", label: "modelled", value: pr.modelled, accent: false },
  ]
  const values = marks.map((m) => m.value).concat(hasBand ? [lo, hi] : [])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || 1) * 0.12
  const left = min - pad
  const width = max - min + 2 * pad
  const pos = (v: number) => ((v - left) / width) * 100
  const bracketed = hasBand && pr.applied >= lo && pr.applied <= hi

  return (
    /* Its own container: at two columns of the outer grid this block reports
       about 342px, and the pairs below it need more than the outer section's
       width to decide by. */
    <div className="@container/pr">
      <p className="eyebrow mb-2">Performance ratio · applied against the band</p>
      <div className="relative h-9">
        <div className="bg-background absolute inset-x-0 top-4 h-1.5 rounded-sm" />
        {hasBand && (
          <div
            className="absolute top-2.5 h-4 rounded-sm"
            style={{
              left: `${pos(lo)}%`,
              width: `${pos(hi) - pos(lo)}%`,
              backgroundColor: "rgb(var(--p-accent) / 0.28)",
              border: "1px solid rgb(var(--p-accent) / 0.55)",
            }}
          />
        )}
        {marks.map((m) => (
          <div
            key={m.key}
            className="absolute top-1 h-7 w-px"
            style={{
              left: `${pos(m.value)}%`,
              backgroundColor: m.accent
                ? "rgb(var(--p-accent))"
                : "var(--muted-foreground)",
            }}
            title={`${m.label} ${m.value.toFixed(6)}`}
          />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {marks.map((m) => (
          <div key={m.key}>
            <div className="eyebrow !text-micro">{m.label}</div>
            <div
              className={cn(
                "telemetry text-sm",
                m.accent ? "text-primary" : "text-foreground"
              )}
            >
              {m.value.toFixed(4)}
            </div>
          </div>
        ))}
      </div>
      {/*
        The band, and where the applied ratio falls in it.

        The applied and derived ratios themselves are this product's headline
        and are stated once, by headlineFigures.ts, at the head of the group
        this section sits in. Printed here as well they were on screen twice at
        the same rounding, about a screen apart -- one measurement disagreeing
        with nothing, which is the reading equivalent of a duplicated source of
        truth. What the headline cannot carry is the relation between the two,
        so that travels on the band it is a relation to.
      */}
      {hasBand && (
        <StatGrid at="pr">
          <Stat
            label="Global Solar Atlas band"
            value={`${lo.toFixed(3)} – ${hi.toFixed(3)}`}
          />
          <Stat
            label="Applied ratio against the band"
            value={bracketed ? "inside" : "outside"}
          />
        </StatGrid>
      )}
      <StatGrid at="pr">
        <Stat
          label="Derived at reference optionals"
          value={pr.derived_if_optional_at_pvwatts_defaults.toFixed(4)}
        />
        <Stat label="Reporting basis" value={pr.reporting_basis} />
        <Stat
          label="Degradation factor"
          value={pr.degradation_factor.toFixed(6)}
        />
        <Stat
          label="Degradation rate"
          value={`${(pr.degradation_rate_per_year * 100).toFixed(2)}% /yr over ${pr.analysis_period_years} yr`}
        />
      </StatGrid>
    </div>
  )
}

/**
 * Identities the waterfall has to satisfy, kept apart from the loss rows.
 *
 * A checkpoint with no residual is not an identity; Go turning an absent
 * residual into 0.0 would read as one that closed exactly, so the null is
 * printed as a statement rather than as a number.
 */
function EnergyCheckpoints({ energy }: { energy: EnergyModelAnalysis }) {
  const checks = energy.loss_waterfall.checkpoints
  if (checks.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((c) => (
        <li key={c.name} className="rounded-sm border border-border bg-secondary px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="telemetry text-body text-foreground">
              {c.name.replace(/_/g, " ")}
            </span>
            <span className="telemetry text-sm text-foreground">
              {c.value.toFixed(6)}
            </span>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            <span className="telemetry">
              {c.residual == null
                ? "no residual"
                : `residual ${c.residual === 0 ? "0" : c.residual.toExponential(2)}`}
              {c.external_band.length >= 2
                ? ` · band ${Math.min(...c.external_band).toFixed(3)}–${Math.max(...c.external_band).toFixed(3)}`
                : ""}
            </span>
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * Fixed tilt against one-axis tracking.
 *
 * The two published per-hectare measurements lead, because they answer the
 * per-hectare question directly on fleets of built plants and they disagree on
 * the sign. The figure this chain derives is a third line behind them, shown
 * with the ground-coverage pair that produced it.
 */
function TrackingComparison({ energy }: { energy: EnergyModelAnalysis }) {
  const t = energy.tracking
  const pub = t.per_hectare.published_measurements
  const bol = pub.bolinger_2022
  const ong = pub.ong_2013_table5
  const md = t.per_hectare.model_derived
  const seasonSpan = Math.max(
    ...t.seasonal.rows.map((r) => Math.abs(r.gain_pct)),
    0.001
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">Fixed tilt against one-axis tracking</p>

      <div>
            <p className="eyebrow !text-micro mb-2">Per hectare, as published</p>
        <div className="grid grid-cols-1 gap-2 @min-[33.5rem]:grid-cols-2">
          <div className="rounded-sm border border-border bg-secondary px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow !text-micro">
                Bolinger and Bolinger (2022)
              </span>
              <span className="telemetry text-sm text-foreground">
                {bol.change_pct.toFixed(1)}%
              </span>
            </div>
            <div className="telemetry mt-1 text-body text-muted-foreground">
              fixed {bol.fixed_gwh_ha_year.toFixed(2)} · tracking{" "}
              {bol.tracking_gwh_ha_year.toFixed(2)} GWh/ha/yr (
              {bol.fixed_mwh_acre_year.toFixed(0)} and{" "}
              {bol.tracking_mwh_acre_year.toFixed(0)} MWh/acre/yr)
            </div>
          </div>
          <div className="rounded-sm border border-border bg-secondary px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow !text-micro">Ong et al. (2013), Table 5</span>
              <span className="telemetry text-sm text-foreground">
                {ong.band_pct.length >= 2
                  ? `${Math.min(...ong.band_pct).toFixed(1)} to ${Math.max(...ong.band_pct).toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            <div className="telemetry mt-1 text-body text-muted-foreground">
              nearest sites at this DNI of{" "}
              {ong.site_dni_kwh_m2_year.toFixed(1)} kWh/m2/yr:{" "}
              {ong.nearest_rows
                .map(
                  (r) =>
                    `${r.site} ${r.dni_kwh_m2_year.toFixed(0)} → ${r.land_use_change_pct.toFixed(1)}%`
                )
                .join(" · ")}
            </div>
                <p className="text-meta text-muted-foreground">tracking land per unit energy</p>
          </div>
        </div>
      </div>

      <div
        className="border-t pt-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow !text-micro">
            Derived here, third line · not measured
          </span>
          <span className="telemetry text-sm text-foreground">
            {md.change_pct.toFixed(2)}%
          </span>
        </div>
        <div className="telemetry mt-1 text-body text-muted-foreground">
          energy per hectare ratio {md.energy_per_hectare_ratio.toFixed(4)} at
          ground coverage {md.gcr_fixed.toFixed(3)} fixed and{" "}
          {md.gcr_tracker.toFixed(3)} tracking, a ratio of{" "}
          {md.gcr_ratio.toFixed(4)}
        </div>
        <StatGrid>
          <Stat
            label="Sign parity at tracker GCR"
            value={`${md.parity.gcr_tracker.toFixed(4)} · ${md.parity.gcr_ratio.toFixed(3)}× fixed`}
          />
          <Stat
            label="Search range"
            value={md.parity.search_range.join(" – ")}
          />
        </StatGrid>
      </div>

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">Per kWp, this site's series</p>
        <div className="grid grid-cols-1 gap-3 @min-[22rem]:grid-cols-2 @min-[45rem]:grid-cols-4">
          <WaterFigure
            label="Fixed"
            value={t.per_kwp.fixed.specific_yield_kwh_kwp_year.toFixed(0)}
            sub={`kWh/kWp/yr · tilt ${t.per_kwp.fixed.tilt_deg.toFixed(0)}° · CF ${t.per_kwp.fixed.capacity_factor_pct.toFixed(2)}%`}
          />
          <WaterFigure
            label="Tracking"
            value={t.per_kwp.tracking.specific_yield_kwh_kwp_year.toFixed(0)}
            sub={`kWh/kWp/yr · GCR ${t.per_kwp.tracking.gcr.toFixed(3)} · CF ${t.per_kwp.tracking.capacity_factor_pct.toFixed(2)}%`}
          />
          <WaterFigure
            label="Gain per kWp"
            value={`${t.per_kwp.gain_pct.toFixed(2)}%`}
            sub={`at the applied ratio ${t.performance_ratio.applied.toFixed(2)} (${t.performance_ratio.applied_source})`}
          />
          <WaterFigure
            label="Basis that inverts"
            value={t.per_hectare.inverts ? "per hectare" : "per kWp"}
            sub={
              t.per_kwp.inverts
                ? "both bases change sign across the configurations tested"
                : "the per-kWp comparison keeps its sign"
            }
          />
        </div>
      </div>

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">
          Plane-of-array gain by season, kWh/m2
        </p>
        <ul className="flex flex-col gap-1.5">
          {t.seasonal.rows.map((r) => (
            <li
              key={r.season}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="w-24 shrink-0 truncate">
                {r.season.replace(/_/g, " ")}
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-body text-muted-foreground">
                {r.fixed_poa_kwh_m2_season.toFixed(1)}
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-body text-muted-foreground">
                {r.tracker_poa_kwh_m2_season.toFixed(1)}
              </span>
              <span className="bg-background relative h-1.5 min-w-[6rem] flex-1">
                <span
                  className="absolute inset-y-0"
                  style={{
                    width: `${(Math.abs(r.gain_pct) / seasonSpan) * 50}%`,
                    left:
                      r.gain_pct < 0
                        ? `${50 - (Math.abs(r.gain_pct) / seasonSpan) * 50}%`
                        : "50%",
                    backgroundColor:
                      r.gain_pct < 0
                        ? PALETTE_STOPS.rdbu_r[13]
                        : PALETTE_STOPS.rdbu_r[3],
                  }}
                />
              </span>
              <span className="telemetry w-16 shrink-0 text-right">
                {r.gain_pct.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="border-t pt-3"
      >
        <StatGrid>
          <Stat
            label="Axis tilt / azimuth"
            value={`${t.configuration.axis_tilt_deg.toFixed(0)}° / ${t.configuration.axis_azimuth_deg.toFixed(0)}° ${t.configuration.axis_azimuth_convention}`}
          />
          <Stat
            label="Rotation limit"
            value={`${t.configuration.max_angle_deg.toFixed(0)}°`}
          />
          <Stat
            label="Backtracking"
            value={t.configuration.backtrack ? "on" : "off"}
          />
        </StatGrid>
        <StatGrid at="wide">
          {t.performance_ratio.transfer_between_configurations.map((r) => (
            <Stat
              key={r.wind}
              label={`Fixed vs tracker PR, ${r.wind} wind`}
              value={`${r.performance_ratio_fixed.toFixed(6)} / ${r.performance_ratio_tracker.toFixed(6)}, ${r.difference_pct.toFixed(4)}%`}
            />
          ))}
          <Stat label="Meteorology cell" value="0.5° × 0.625°" />
        </StatGrid>
      </div>
    </div>
  )
}

/**
 * Mean AC power by month and hour, with the monthly peak sun hours beside it.
 *
 * The hour axis is labelled on the time standard the response reports, which
 * is not local time unless an offset was supplied: a diurnal profile read on
 * the wrong standard is shifted without any sign that it is.
 */
function GenerationProfile({ energy }: { energy: EnergyModelAnalysis }) {
  const g = energy.generation_profile
  const matrix = g.mean_ac_power_by_month_and_hour
  const peak = Math.max(
    ...matrix.rows.flatMap((r) => r.mean_ac_w_kwp),
    0.0001
  )
  const psh = g.monthly.rows
  const pshMax = Math.max(...psh.map((m) => m.peak_sun_hours_day), 0.0001)
  const shareMax = Math.max(
    ...g.share_of_annual_generation_by_hour.rows.map((h) => h.share_pct),
    0.0001
  )
  const offset = g.time_standard.utc_offset_hours

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Generation profile</p>
        <p className="telemetry text-meta text-muted-foreground">
          {g.time_standard.source_standard}
          {offset == null
            ? ""
            : ` ${offset >= 0 ? "+" : ""}${offset} h`} ·{" "}
          {g.time_standard.hour_label}
        </p>
      </div>
          <p className="text-meta text-muted-foreground">before applied performance ratio</p>

      <div className="@max-[34rem]:edge-fade-x -mx-1 overflow-x-auto px-1">
        <div className="min-w-[34rem]">
          <div className="flex items-center gap-1">
            <span className="w-8 shrink-0" />
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="telemetry min-w-0 flex-1 text-center text-micro text-muted-foreground"
              >
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          {matrix.rows.map((row) => (
            <div key={row.month} className="flex items-center gap-1">
              <span className="telemetry w-8 shrink-0 text-micro text-muted-foreground">
                {String(row.month).padStart(2, "0")}
              </span>
              {Array.from({ length: 24 }, (_, h) => {
                const v = h < row.mean_ac_w_kwp.length ? row.mean_ac_w_kwp[h] : null
                return (
                  <span
                    key={h}
                    title={
                      v == null
                        ? `month ${row.month}, hour ${h}: not carried`
                        : `month ${row.month}, hour ${h}: ${v.toFixed(1)} ${matrix.units}`
                    }
                    className="h-4 min-w-0 flex-1 rounded-[1px]"
                    style={
                      v == null
                        ? {
                            background:
                              "repeating-linear-gradient(45deg,transparent,transparent 2px,rgb(var(--p-line-strong)/0.5) 2px,rgb(var(--p-line-strong)/0.5) 3px)",
                          }
                        : {
                            backgroundColor: rampStop(
                              PALETTE_STOPS.inferno,
                              v / peak
                            ),
                          }
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <span
          className="h-2 w-24 rounded-sm"
          style={{ background: paletteGradient("inferno") }}
        />
        <span className="telemetry">
          0 to {peak.toFixed(0)} {matrix.units}
        </span>
        <span>
          modelled AC power before any performance ratio is applied, so the
          shape is the model's and the level is not a reported yield
        </span>
      </div>

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">
          Peak sun hours per day, module plane
        </p>
        <ul className="flex flex-col gap-1">
          {psh.map((m) => (
            <li key={m.month} className="flex items-center gap-2 text-xs">
              <span className="telemetry w-6 shrink-0 text-meta text-muted-foreground">
                {String(m.month).padStart(2, "0")}
              </span>
              <span className="bg-background relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${(m.peak_sun_hours_day / pshMax) * 100}%`,
                    /* Measured 1.90:1 against its rail in the light theme,
                       under the 3.0 WCAG 1.4.11 floor for a graphic that
                       encodes a value by length. index.css:174-180 names this
                       exact hex as a retired series colour that failed the
                       same floor. */
                    backgroundColor: "rgb(var(--p-accent))",
                  }}
                />
              </span>
              <span className="telemetry w-14 shrink-0 text-right text-body">
                {m.peak_sun_hours_day.toFixed(2)} h
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-meta text-muted-foreground">
                {m.poa_kwh_m2_month.toFixed(1)} kWh/m2
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-meta text-muted-foreground">
                {m.ac_kwh_kwp_month.toFixed(1)} kWh/kWp
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">
          Share of annual AC energy by hour
        </p>
        <div className="flex items-end gap-1">
          {g.share_of_annual_generation_by_hour.rows.map((h) => (
            <div
              key={h.hour}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
              title={`hour ${h.hour}: ${h.share_pct.toFixed(3)} ${g.share_of_annual_generation_by_hour.units}`}
            >
              <span
                className="w-full rounded-t-[1px]"
                style={{
                  height: `${Math.max(1, (h.share_pct / shareMax) * 36)}px`,
                  backgroundColor: "rgb(var(--p-accent))",
                }}
              />
              <span className="telemetry text-micro text-muted-foreground">
                {h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-meta text-muted-foreground">
          <span className="telemetry">
            {g.share_of_annual_generation_by_hour.units}
          </span>
        </p>
      </div>
    </div>
  )
}

/** One siting class, with the assumptions that produced its energy figures. */
function PlantClassCard({
  cls,
  density,
}: {
  cls: EnergyPlantClass
  density: EnergyCapacityDensity
}) {
  return (
    <div className="@container/card rounded-sm border border-border bg-secondary px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-foreground">{cls.label}</span>
        <span className="telemetry text-sm text-foreground">
          {areaHa(cls.area_ha)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <WaterFigure
          label="Capacity"
          value={capacityMw(cls.capacity_dc_mw)}
          sub={`DC at ${density.value_mw_dc_per_ha.toFixed(4)} MW/ha, ${density.area_basis.replace(/_/g, " ")}`}
        />
        <WaterFigure
          label="Capacity"
          value={capacityMw(cls.capacity_ac_mw)}
          sub={`AC at a fleet DC/AC ratio of ${density.fleet_dc_ac_ratio.toFixed(4)}`}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <WaterFigure
          label="P50"
          value={cls.energy.p50_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
        <WaterFigure
          label="P75"
          value={cls.energy.p75_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
        <WaterFigure
          label="P90"
          value={cls.energy.p90_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
      </div>
      <StatGrid at="card">
        <Stat
          label="Specific yield"
          value={`${cls.specific_yield_kwh_kwp_year.toFixed(2)} kWh/kWp/yr`}
        />
        <Stat
          label="Performance ratio"
          value={`${cls.performance_ratio.toFixed(2)} · ${cls.reporting_basis}`}
        />
      </StatGrid>
      <StatGrid at="card">
        <Stat
          label="Largest contiguous patch"
          value={areaHa(cls.contiguity.largest_ha)}
        />
        <Stat
          label="Patches"
          value={`${cls.contiguity.n_patches} at ${cls.contiguity.connectivity}-way`}
        />
      </StatGrid>
    </div>
  )
}

/**
 * Plant energy over the sited areas.
 *
 * The suitable area and the cropland-conflict area are drawn apart and are
 * never summed: the second is the same land counted against its current use,
 * and a total would erase the trade-off that is the result. The exceedance
 * band carries only the uncertainty component listed as included.
 */
function PlantEnergy({ energy }: { energy: EnergyModelAnalysis }) {
  const p = energy.plant
  const ex = p.exceedance
  return (
    <div className="flex flex-col gap-3">
      {/* The heading is the section's, above. What is left is the basis the
          figures are reported on, which the heading does not say. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="telemetry text-meta text-muted-foreground">
          basis {p.reporting_basis} · {ex.convention} convention
        </p>
        <p className="text-meta text-muted-foreground">areas are not additive</p>
      </div>

      <div className="grid grid-cols-1 gap-2 @min-[31rem]:grid-cols-2">
        {p.suitable.area_ha > 0 && (
          <PlantClassCard cls={p.suitable} density={p.capacity_density} />
        )}
        {p.cropland_conflict.area_ha > 0 && (
          <PlantClassCard
            cls={p.cropland_conflict}
            density={p.capacity_density}
          />
        )}
      </div>

      {p.restrictive.area_ha > 0 && (
        <div className="rounded-sm border border-border bg-secondary px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-foreground">
              {p.restrictive.label}
            </span>
            <span className="telemetry text-sm text-foreground">
              {p.restrictive.area_ha.toFixed(3)} ha
            </span>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            <span className="telemetry">
              {p.restrictive.capacity_dc_mw == null
                ? "no capacity reported"
                : `${p.restrictive.capacity_dc_mw.toFixed(2)} MW DC`}
            </span>
          </p>
        </div>
      )}

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">
          Exceedance on {ex.n_years} years of annual global horizontal
          irradiation
        </p>
        <ul className="flex flex-col gap-1">
          {ex.levels.map((l) => (
            <li
              key={l.level}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="telemetry w-10 shrink-0 text-body">
                P{l.level}
              </span>
              <span className="telemetry w-28 shrink-0 text-right text-body text-foreground">
                {l.ghi_empirical_kwh_m2_year.toFixed(2)}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-body text-muted-foreground">
                ×{l.factor_empirical.toFixed(6)}
              </span>
              <span className="telemetry w-28 shrink-0 text-right text-meta text-muted-foreground">
                normal fit {l.ghi_normal_kwh_m2_year.toFixed(2)}
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-meta text-muted-foreground">
                ±{l.normal_fit_standard_error_kwh_m2.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <StatGrid>
          <Stat label="Method" value={ex.method_applied} />
          <Stat
            label="Mean"
            value={`${ex.mean_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
          />
          <Stat
            label="Standard deviation"
            value={ex.std_kwh_m2_year.toFixed(2)}
          />
          <Stat label="Coefficient of variation" value={`${ex.cv_pct.toFixed(3)}%`} />
        </StatGrid>
        <StatGrid>
          <Stat
            label={`Normality · ${ex.normality.test}`}
            value={`W ${ex.normality.statistic.toFixed(5)} · p ${ex.normality.p_value.toFixed(4)}`}
          />
        </StatGrid>
        <StatGrid>
          <Stat
            label="Exceedance P90"
            value={`${ex.crosswalk.exceedance_p90_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
          />
          <Stat
            label="Statistical P10"
            value={`${ex.crosswalk.statistical_p10_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
          />
        </StatGrid>
      </div>

      <div
        className="border-t pt-3"
      >
        <p className="eyebrow !text-micro mb-2">
          What the band does and does not carry
        </p>
        <div className="grid grid-cols-1 gap-2 @min-[33.5rem]:grid-cols-2">
          <div>
            <div className="eyebrow !text-micro">included</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-meta text-muted-foreground">
              {p.uncertainty.included.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow !text-micro">excluded</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-meta text-muted-foreground">
              {p.uncertainty.excluded.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        </div>
            <p className="mt-2 text-meta text-muted-foreground">
              resource variability only · dominant term{" "}
              <span className="telemetry">{p.uncertainty.dominant_term}</span>
            </p>
      </div>

      <div
        className="border-t pt-3"
      >
        <StatGrid>
          <Stat
            label="Capacity density"
            value={`${p.capacity_density.value_mw_dc_per_ha.toFixed(6)} MW DC/ha`}
          />
          <Stat
            label="Area basis"
            value={p.capacity_density.area_basis.replace(/_/g, " ")}
          />
          <Stat
            label="Mounting"
            value={p.capacity_density.mounting.replace(/_/g, " ")}
          />
          <Stat
            label="Buildable fraction"
            value={p.capacity_density.buildable_fraction.toFixed(2)}
          />
        </StatGrid>
        <StatGrid>
          <Stat
            label="Fleet DC/AC ratio"
            value={p.capacity_density.fleet_dc_ac_ratio.toFixed(6)}
          />
          <Stat
            label="Energy density, site"
            value={`${p.energy_density_cross_check.site_mwh_ha_year.toFixed(1)} MWh/ha/yr`}
          />
          <Stat
            label="Energy density, published"
            value={`${p.energy_density_cross_check.reference_mwh_ha_year.toFixed(1)} MWh/ha/yr`}
          />
          <Stat
            label={`Ratio, ${p.energy_density_cross_check.area_basis.replace(/_/g, " ")} basis`}
            value={p.energy_density_cross_check.ratio.toFixed(3)}
          />
          {/*
            "not applied" is not a formatting choice: a derate of 1.0000 that
            was never applied and one applied at 1.0000 are different claims
            about whether the horizon was looked at.
          */}
          <Stat
            label={`Horizon shading derate, ${p.shading.applied ? "applied" : "not applied"}`}
            value={p.shading.derate.toFixed(4)}
          />
          <Stat
            label="Slope limits, legal constraints not checked"
            value={`${p.thresholds.slope_acceptable_deg}° / ${p.thresholds.slope_restrictive_deg}°`}
          />
        </StatGrid>
      </div>
    </div>
  )
}

/**
 * The photovoltaic energy model over the AOI.
 *
 * Shares the radiation chain and the reported optimum with the solar resource
 * card above, so the two cannot disagree about one AOI. Every figure is shown
 * with the assumption that produced it, and the applied and derived yields are
 * shown together because they answer under different assumptions rather than
 * one correcting the other.
 */
/** The four figures the model is read by, and the chain that produced them. */
function DeliveredYield({ energy }: { energy: EnergyModelAnalysis }) {
  const d = energy.loss_waterfall.delivered
  const g = energy.geometry
  return (
    <>
      <div className="grid grid-cols-1 gap-3 @min-[24rem]:grid-cols-2 @min-[48rem]:grid-cols-4">
        <WaterFigure
          label="Specific yield, applied"
          value={d.applied_kwh_kwp_year.toFixed(2)}
          sub={`kWh/kWp/yr at PR ${energy.performance_ratio.applied.toFixed(2)} (${energy.performance_ratio.applied_source}), basis ${d.reporting_basis}`}
        />
        <WaterFigure
          label="Specific yield, derived"
          value={d.derived_kwh_kwp_year.toFixed(2)}
          sub={`kWh/kWp/yr at PR ${energy.performance_ratio.derived.toFixed(4)}, this chain plus its declared terms`}
        />
        <WaterFigure
          label="Capacity factor"
          value={`${d.applied_capacity_factor_pct.toFixed(3)}%`}
          sub={`${d.derived_capacity_factor_pct.toFixed(3)}% on the derived ratio, a difference of ${d.difference_pct.toFixed(3)}%`}
        />
        <WaterFigure
          label="Optimum tilt"
          value={`${g.optimal_tilt_deg.toFixed(0)}°`}
          sub={`azimuth ${g.surface_azimuth_deg.toFixed(0)}° · plane-of-array ${g.poa_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
        />
      </div>

      <div className="mt-4 border-t pt-4">
        <EnergyWaterfall energy={energy} />
      </div>
    </>
  )
}

/** What the chain was computed under, and where the series came from. */
function ModelAssumptions({ energy }: { energy: EnergyModelAnalysis }) {
  const g = energy.geometry
  const mt = energy.module_type
  return (
    <>
      <StatGrid>
        <Stat
          label="Horizontal plane, hourly window"
          value={`${g.ghi_hourly_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
        />
        <Stat
          label="Same array laid flat"
          value={`${g.poa_horizontal_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
        />
      </StatGrid>
      <StatGrid>
        <Stat
          label="Temperature coefficient"
          value={`${mt.gamma_pdc_per_c} /°C`}
        />
        <Stat label="Module type" value={mt.module_type ?? "custom"} />
        {Object.entries(mt.alternatives).map(([k, v]) => (
          <Stat key={k} label={`Alternative, ${k}`} value={`${v} /°C`} />
        ))}
        <Stat
          label="Transposition"
          value={energy.loss_waterfall.assumptions.transposition_model.value}
        />
        <Stat
          label="Ground albedo"
          value={String(energy.loss_waterfall.assumptions.albedo.value)}
        />
        {/*
          The wind qualifier stays: WS2M alone reads as the wind the model
          wants, and the Faiman coefficient expects a module-height wind. The
          height mismatch is the figure's meaning, not commentary on it.
        */}
        <Stat
          label="Wind field, 2 m not module height"
          value={energy.loss_waterfall.assumptions.wind_source.value}
        />
        <Stat
          label="Physical vs flat loss placement"
          value={`${energy.loss_waterfall.assumptions.flat_placement_bias_pct.value}%`}
        />
        <Stat label="Radiation cell" value="1°, one cell over the AOI" />
        <Stat label="Meteorology cell" value="0.5° × 0.625°" />
      </StatGrid>
      <PowerProvenanceNote provenance={energy.power_provenance} />
    </>
  )
}

/**
 * The energy model as sections of one reading, in the order it is read.
 *
 * It was one section of seven blocks, several thousand pixels tall, and no
 * container in the application is that tall -- so it was always read through a
 * viewport showing a fraction of it, with the fold landing wherever the content
 * put it. The blocks were already authored as blocks; this states that.
 *
 * EACH SECTION IS NAMED FOR WHAT IS IN IT. Every one of the six used to open
 * with the same heading, "Photovoltaic energy model", and the same provenance
 * line, because each was a page read alone -- so a reader four blocks in had
 * the product's name on screen and no way to see which block they were in. The
 * product's name, its provenance and its four headline figures are stated once
 * by the host, at the head of the group; the title below names the block, and
 * is what the column's index addresses.
 */
export function energyModelSections(
  energy: EnergyModelAnalysis
): ReadingSection[] {
  const section = (
    id: string,
    title: string,
    short: string,
    node: ReactNode
  ): ReadingSection => ({ id: `energy-${id}`, title, short, node })

  return [
    section(
      "delivered",
      "Delivered yield and loss waterfall",
      "Delivered",
      <DeliveredYield energy={energy} />
    ),
    section(
      "ratio",
      "Performance ratio and checkpoints",
      "Ratio",
      <div className="flex flex-col gap-4">
        <div>
          <p className="eyebrow mb-2">Checkpoints, outside the loss rows</p>
          <EnergyCheckpoints energy={energy} />
        </div>
        <PerformanceRatioScale energy={energy} />
      </div>
    ),
    section(
      "tracking",
      "Fixed tilt against tracking",
      "Tracking",
      <TrackingComparison energy={energy} />
    ),
    section(
      "profile",
      "Generation profile",
      "Profile",
      <GenerationProfile energy={energy} />
    ),
    section("plant", "Plant energy", "Plant", <PlantEnergy energy={energy} />),
    section(
      "assumptions",
      "Model assumptions",
      "Assumptions",
      <ModelAssumptions energy={energy} />
    ),
  ]
}
