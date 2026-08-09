/**
 * The wind screening, as shown on screen.
 *
 * Lives outside AnalysisPage so the energy screen and the analysis screen render
 * it from one definition. Duplicating it would let the two drift, and this is
 * the block whose figures each carry the assumption that produced them.
 */
import type { WindAnalysis } from "@/lib/types"
import { Chip, PowerProvenanceNote, rampStop, WaterFigure } from "@/components/analysisPrimitives"
import { PALETTE_STOPS } from "@/lib/palettes"
import { cn } from "@/lib/utils"

/**
 * The wind screening, in its own section.
 *
 * Its capacity factor is gross, carries no external validation and rests on a
 * power-law extrapolation above the highest level the reanalysis holds, while
 * the photovoltaic figure beside it is computed at a ratio benchmarked against
 * the Global Solar Atlas. The two are never placed in a shared comparison and
 * the qualifier is printed before the first number.
 */
export function WindScreening({ wind }: { wind: WindAnalysis }) {
  const m = wind.measured
  const h = wind.hub
  const q = wind.data_quality
  const shear = q.shear
  const roseMax = Math.max(
    ...m.direction_energy_rose_50m.map((s) => Math.max(s.energy_pct, s.hours_pct)),
    0.001
  )
  const speedMax = Math.max(
    ...m.monthly_mean_speed_50m.map((r) => r.mean_speed_ms),
    0.001
  )

  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="eyebrow">Wind screening</p>
          <Chip>separate product</Chip>
          <Chip>gross</Chip>
          <Chip>unvalidated</Chip>
        </div>
        <p className="telemetry text-[10px] text-muted-foreground">
          {wind.record_window} · {wind.record_years.toFixed(3)} years · cell
          centre {wind.grid_cell_centre[1]?.toFixed(3)},{" "}
          {wind.grid_cell_centre[0]?.toFixed(3)}
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {wind.qualifier}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {wind.assumptions.comparison_note}
      </p>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Carried by the reanalysis · no height extrapolation
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Mean speed 10 m"
            value={`${m.mean_speed_10m_ms.toFixed(4)} m/s`}
            sub="level held in the record"
          />
          <WaterFigure
            label="Mean speed 50 m"
            value={`${m.mean_speed_50m_ms.toFixed(4)} m/s`}
            sub="highest level held in the record"
          />
          <WaterFigure
            label="Weibull 50 m"
            value={`k ${m.weibull_k_50m.toFixed(4)}`}
            sub={`c ${m.weibull_c_50m_ms.toFixed(4)} m/s · ${m.weibull_fit_check_50m.estimator}`}
          />
          <WaterFigure
            label="Power density 50 m"
            value={`${m.wind_power_density_50m_w_m2.toFixed(2)} W/m2`}
            sub={`energy pattern factor ${m.energy_pattern_factor_50m.toFixed(4)}`}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {m.qualifier}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Weibull fit against the record: mean{" "}
          {m.weibull_fit_check_50m.weibull_mean_ms.toFixed(4)} against{" "}
          {m.weibull_fit_check_50m.empirical_mean_ms.toFixed(4)} m/s (
          {m.weibull_fit_check_50m.mean_error_pct.toFixed(3)}%), mean cube{" "}
          {m.weibull_fit_check_50m.weibull_mean_cube_m3s3.toFixed(3)} against{" "}
          {m.weibull_fit_check_50m.empirical_mean_cube_m3s3.toFixed(3)} m3/s3 (
          {m.weibull_fit_check_50m.mean_cube_error_pct.toFixed(3)}%). Air
          density mean {m.air_density_mean_kg_m3.toFixed(4)} kg/m3, range{" "}
          {m.air_density_min_kg_m3.toFixed(4)} to{" "}
          {m.air_density_max_kg_m3.toFixed(4)}. {m.humidity_note}
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          At the {wind.hub_height_m.toFixed(0)} m hub · extrapolated
        </p>
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          {h.extrapolation.statement}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Hub speed"
            value={`${h.mean_speed_ms.toFixed(4)} m/s`}
            sub={`power law at ${wind.assumptions.shear_exponent.toFixed(4)}, ${h.extrapolation.height_ratio.toFixed(1)}x above the top level`}
          />
          <WaterFigure
            label="Gross capacity factor"
            value={`${h.gross_capacity_factor_pct.toFixed(3)}%`}
            sub={`no plant loss applied; ${h.gross_capacity_factor_no_density_correction_pct.toFixed(3)}% without the density correction`}
          />
          <WaterFigure
            label="Gross annual energy"
            value={`${h.gross_annual_energy_mwh_per_turbine.toFixed(1)} MWh`}
            sub={`per turbine over ${h.hours_per_year.toFixed(0)} hours; not to be multiplied by a plant size`}
          />
          <WaterFigure
            label="Power density"
            value={`${h.wind_power_density_w_m2.toFixed(2)} W/m2`}
            sub={`Weibull k ${h.weibull_k.toFixed(4)}, c ${h.weibull_c_ms.toFixed(4)} m/s`}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Operating regime: above cut-in{" "}
          {h.operating_regime.above_cut_in_pct.toFixed(3)}% of hours, at or
          above rated {h.operating_regime.at_or_above_rated_pct.toFixed(3)}%,
          above cut-out {h.operating_regime.above_cut_out_pct.toFixed(3)}%, on a
          curve with cut-in {h.operating_regime.cut_in_ms.toFixed(1)}, rated{" "}
          {h.operating_regime.rated_ms.toFixed(4)} and cut-out{" "}
          {h.operating_regime.cut_out_ms.toFixed(1)} m/s.
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {h.density_normalisation_note} {h.hours_per_year_note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Excluded from these figures: {h.excluded_losses.join("; ")}.
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">Field diagnostics</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label={`Hours below ${q.calm_threshold_ms} m/s`}
            value={`${(q.calm_fraction_pct["10m"] ?? 0).toFixed(3)}%`}
            sub={`at 10 m; 50 m ${(q.calm_fraction_pct["50m"] ?? 0).toFixed(3)}%, 2 m ${(q.calm_fraction_pct["2m"] ?? 0).toFixed(3)}%`}
          />
          <WaterFigure
            label="Record maximum 10 m"
            value={`${(q.record_maximum_ms["10m"] ?? 0).toFixed(2)} m/s`}
            sub={`over ${q.record_hours} hours; floor ${q.record_maximum_floor_ms.toFixed(1)} m/s, ${q.record_maximum_plausible ? "met" : "not met"}`}
          />
          <WaterFigure
            label="Shear exponent"
            value={shear.shear_exponent.toFixed(4)}
            sub={`10 m to 50 m long-term means; day ${shear.shear_exponent_day.toFixed(4)}, night ${shear.shear_exponent_night.toFixed(4)}`}
          />
          {/* Null when the exponent lies outside what a neutral logarithmic
              profile between 10 m and 50 m can produce for any roughness
              length. Rendered as a number it printed "0.000 m", a physically
              meaningful-looking roughness that was never computed, beside the
              flag stating that the inversion has no root. */}
          <WaterFigure
            label="Implied roughness"
            value={
              shear.implied_roughness_length_m == null
                ? "—"
                : `${shear.implied_roughness_length_m.toFixed(3)} m`
            }
            sub={
              shear.implied_roughness_length_m == null
                ? `no roughness length inverts this exponent; assumed cover ${shear.assumed_roughness_band_m.join(" to ")} m`
                : `assumed cover ${shear.assumed_roughness_band_m.join(" to ")} m, ${shear.consistent_with_assumed_cover ? "consistent" : "not consistent"}`
            }
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          The assumed roughness band supports a shear exponent of{" "}
          {shear.expected_shear_exponent_band.map((v) => v.toFixed(3)).join(" to ")}
          . {shear.roughness_band_note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {q.record_maximum_floor_note} {q.calm_fraction_2m_note}
        </p>
        {q.flags.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {q.flags.map((f) => (
              <li
                key={f}
                className="border-l-2 pl-2 text-[10px] leading-relaxed text-muted-foreground"
                style={{ borderColor: PALETTE_STOPS.rdbu_r[14] }}
              >
                {f}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {q.all_checks_passed
            ? "Every record check passed."
            : `${q.flags.length} record check${q.flags.length === 1 ? "" : "s"} did not pass, so the hub figures rest on a series the checks do not support.`}{" "}
          Record {q.record_hours} hours against {q.expected_hours} expected.
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Hub result across the shear exponent
        </p>
        <ul className="flex flex-col gap-1">
          {wind.shear_sensitivity.map((s) => (
            <li
              key={`${s.basis}-${s.shear_exponent}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="telemetry w-16 shrink-0 text-[11px] text-foreground">
                {s.shear_exponent.toFixed(4)}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                {s.roughness_length_m == null
                  ? "—"
                  : `${s.roughness_length_m.toFixed(2)} m`}
              </span>
              <span className="min-w-[10rem] flex-1 truncate text-[10px] text-muted-foreground">
                {s.basis}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[11px]">
                {s.hub_speed_ms.toFixed(4)} m/s
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                {s.capacity_factor_pct.toFixed(3)}%
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                {s.annual_energy_mwh.toFixed(1)} MWh
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2"
           style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Mean speed at 50 m by month, m/s
          </p>
          <ul className="flex flex-col gap-1">
            {m.monthly_mean_speed_50m.map((r) => (
              <li key={r.month} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-6 shrink-0 text-[10px] text-muted-foreground">
                  {String(r.month).padStart(2, "0")}
                </span>
                <span className="bg-background relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${(r.mean_speed_ms / speedMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[3],
                    }}
                  />
                </span>
                <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                  {r.mean_speed_ms.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Direction at 50 m · share of energy against share of hours
          </p>
          <ul className="flex flex-col gap-1">
            {m.direction_energy_rose_50m.map((s) => (
              <li key={s.sector} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-10 shrink-0 text-[10px] text-muted-foreground">
                  {s.centre_deg.toFixed(1)}°
                </span>
                <span className="bg-background relative h-3 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{
                      width: `${(s.energy_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[2],
                    }}
                  />
                  <span
                    className="absolute inset-x-0 bottom-0 h-1.5"
                    style={{
                      width: `${(s.hours_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[6],
                    }}
                  />
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px]">
                  {s.energy_pct.toFixed(2)}%
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                  {s.hours_pct.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Upper bar energy, lower bar hours; they differ because the power
            flux goes as the cube of speed. {m.direction.convention_note}{" "}
            Circular mean {m.direction.circular_mean_deg_50m.toFixed(2)}° at 50
            m and {m.direction.circular_mean_deg_10m.toFixed(2)}° at 10 m,
            median turning {m.direction.median_turning_deg.toFixed(1)}°.
          </p>
        </div>
      </div>

      <div
        className="mt-3 border-t pt-3 text-[10px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--border)" }}
      >
        <p>
          Reference power curve: {wind.turbine.name},{" "}
          {(wind.turbine.rated_power_w / 1e6).toFixed(3)} MW,{" "}
          {wind.turbine.rotor_diameter_m.toFixed(0)} m rotor,{" "}
          {wind.turbine.blades} blades, {wind.turbine.iec_class} turbulence
          class {wind.turbine.turbulence_class}, hub{" "}
          {wind.turbine.hub_height_m.toFixed(0)} m,{" "}
          {wind.turbine.power_curve_points} curve points read from the{" "}
          {wind.turbine.power_curve_column} column. It is a reference curve, not
          a turbine selected for this site. {wind.turbine.drivetrain_note}
        </p>
        <p className="mt-1">{wind.turbine.citation}</p>
        <p className="mt-1">
          Hub height {wind.assumptions.hub_height_m.toFixed(0)} m:{" "}
          {wind.assumptions.hub_height_source} Shear exponent{" "}
          {wind.assumptions.shear_exponent.toFixed(4)}:{" "}
          {wind.assumptions.shear_exponent_source}
        </p>
        <p className="mt-1">{wind.assumptions.conventions_note}</p>
        <p className="mt-1">{wind.loads_note}</p>
        <p className="mt-1">{wind.grid_note}</p>
        <PowerProvenanceNote provenance={wind.power_provenance} />
      </div>
    </section>
  )
}
