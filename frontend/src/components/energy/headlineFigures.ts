/**
 * The four figures a product is read by, and the assumption behind them.
 *
 * ONE DEFINITION, ONE SITE. These lived inside the status panel on the foot of
 * the map, so that panel was the only surface that could state a product's
 * headline, and the reading beside it restated them out of its own sections --
 * which is how the same four terrain numbers came to be printed twice on one
 * screen under character-identical labels.
 *
 * They are read from here by the group heading in the reading column, and the
 * sections render none of them: whatever appears in this file is removed from
 * the block below it. A figure has one home.
 */
import {
  areaHa,
  capacityFactorPct,
  capacityMw,
  energyGwh,
  energyMwh,
  recordYears,
  speedMs,
} from "@/lib/energyFormat"
import type { SolarProductId, SolarResults } from "@/lib/energyState"
import type { WindAnalysis } from "@/lib/types"

export interface HeadlineFigure {
  label: string
  value: string
  sub?: string
}

export interface Headline {
  figures: HeadlineFigure[]
  /**
   * The assumption the figures were read under. Travels with them everywhere.
   *
   * Optional, because a product whose only assumption is its provenance has
   * that stated already: the group states the window, the source and the place
   * once, at its head, and a note repeating them under the same four figures
   * is the same sentence twice within one screen.
   */
  note?: string
}

export function solarFigures(
  product: SolarProductId,
  results: SolarResults
): Headline | null {
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
          sub: `${r.resource.n_years} years · modelled PR ${r.pv.performance_ratio_modelled.toFixed(3)}`,
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
      /*
        No note. What this one carried was `${t.season} · ${t.dem_source}`,
        which is a prefix of the group's own provenance line -- season, source
        and window -- printed a few centimetres below it.

        It used to end "Drawn on the scale reported with the raster, not on
        this layer's own range." The sidecar shares a domain only between
        winter and summer -- `render_scale` returns basis "own" for everything
        else -- so on an annual layer the sentence denied what the ramp showed,
        while `scale.basis` and `scale.shared_with`, which the payload carries
        to answer exactly this, went unread. It now travels under the ramp it
        describes, in SolarSections, where there is a ramp to describe.
      */
    }
  }
  if (product === "siting" && results.siting) {
    const s = results.siting
    return {
      figures: [
        {
          label: "Suitable, no conflict",
          value: areaHa(s.suitable_no_conflict_ha),
        },
        {
          label: "Suitable, on cropland",
          value: areaHa(s.suitable_cropland_ha),
          sub: "reported apart, never summed",
        },
      ],
      /* The slope limits are stated as figures in the block below, beside the
         one thing the classes do not account for. Only what the block does not
         say is carried here. */
      note: s.thresholds.note,
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
          value: capacityMw(e.plant.suitable.capacity_dc_mw),
          sub: `${areaHa(e.plant.suitable.area_ha)}, no conflict`,
        },
        {
          label: "Energy P50",
          value: energyGwh(e.plant.suitable.energy.p50_exceedance_gwh_year),
          sub: `P90 ${e.plant.suitable.energy.p90_exceedance_gwh_year.toFixed(2)}`,
        },
      ],
      note: e.plant.uncertainty.statement,
    }
  }
  return null
}

export function windFigures(w: WindAnalysis): Headline {
  return {
    figures: [
      {
        label: "Mean speed",
        value: speedMs(w.hub.mean_speed_ms),
        sub: `at ${w.hub_height_m.toFixed(0)} m`,
      },
      {
        label: "Gross capacity factor",
        value: capacityFactorPct(w.hub.gross_capacity_factor_pct),
        sub: "gross, per turbine",
      },
      {
        label: "Gross annual energy",
        value: energyMwh(w.hub.gross_annual_energy_mwh_per_turbine),
        sub: "per turbine",
      },
      {
        label: "Record",
        value: recordYears(w.record_years),
        sub: w.record_window,
      },
    ],
    note: w.qualifier,
  }
}
