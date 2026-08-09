/**
 * Table definitions for the analysis data views.
 *
 * Column names, order and value formatting mirror backend/export_research.go,
 * which writes the same tables into the research pack ZIP. What the application
 * shows on screen and what it exports must be the same table, so a figure read
 * here can be cited from the exported CSV without re-deriving it.
 *
 * Edit both together. The CSV file name on each definition is the file the Go
 * writer produces, and backend/export_parity_test.go reads this file to check
 * the names, the column keys and their order still agree with the Go writer's
 * researchTableColumns. The row-construction rules are not covered by that
 * check and are restated on each definition that has one.
 */
import type {
  ClassStat,
  EnergyModelAnalysis,
  SolarAnalysis,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WaterAnalysis,
  LULCAnalysis,
  PhenologyMetrics,
  PhenologyStatePoint,
  PredictResult,
  TemporalPoint,
  VISeriesPoint,
  WindAnalysis,
} from "@/lib/types"

export type CellValue = string | number | null | undefined

export interface TableColumn {
  /** Column name, identical to the CSV header written by the Go exporter. */
  key: string
  /** Right-align and use the monospace face for numeric columns. */
  numeric?: boolean
  /** Render a colour swatch from this cell's hex value instead of the text. */
  swatch?: boolean
}

export interface DataTable {
  id: string
  /** File name in the research pack; the anchor for parity with Go. */
  csvName: string
  columns: TableColumn[]
  rows: CellValue[][]
}

/**
 * Go writes floats with strconv.FormatFloat(v, 'f', -1, 64): the shortest
 * decimal that round-trips, with no exponent and no thousands separator.
 * JavaScript's default number-to-string is also shortest-round-trip but uses
 * exponential notation outside 1e-7..1e21, so those are expanded here.
 */
export function formatNumber(v: CellValue): string {
  if (v === null || v === undefined || v === "") return ""
  if (typeof v === "string") return v
  if (!Number.isFinite(v)) return ""
  const s = String(v)
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/)
  if (!m) return s
  // Expand the exponent by moving the point, rather than toFixed, which is
  // itself exponential at or above 1e21.
  const [, sign, intPart, fracPart = "", expPart] = m
  const exp = Number(expPart)
  const digits = intPart + fracPart
  if (exp >= 0) {
    const point = intPart.length + exp
    return (
      sign +
      (point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
    )
  }
  return `${sign}0.${"0".repeat(-exp - intPart.length)}${digits}`
}

function table(
  id: string,
  csvName: string,
  columns: TableColumn[],
  rows: CellValue[][]
): DataTable | null {
  return rows.length ? { id, csvName, columns, rows } : null
}

const num = (key: string): TableColumn => ({ key, numeric: true })

export function classStatsTable(stats: ClassStat[]): DataTable | null {
  return table(
    "class_stats",
    "class_stats.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pixels"),
      num("pct"),
      num("area_ha"),
    ],
    (stats ?? []).map((c) => [
      c.class_id,
      c.name,
      c.color,
      c.pixels,
      c.pct,
      c.area_ha,
    ])
  )
}

export function viSeriesTable(series: VISeriesPoint[]): DataTable | null {
  return table(
    "vi_series",
    "vi_series.csv",
    [
      { key: "date" },
      num("ndvi_mean"),
      num("ndvi_std"),
      num("evi_mean"),
      num("evi_std"),
      num("savi_mean"),
      num("savi_std"),
    ],
    (series ?? []).map((p) => [
      p.date,
      p.ndvi_mean,
      p.ndvi_std,
      p.evi_mean,
      p.evi_std,
      p.savi_mean,
      p.savi_std,
    ])
  )
}

/** True when at least one metric is present; matches hasPhenology in Go. */
export function hasPhenology(ph?: PhenologyMetrics | null): boolean {
  if (!ph) return false
  return [
    ph.sos_doy,
    ph.pos_doy,
    ph.eos_doy,
    ph.los_days,
    ph.peak,
    ph.base,
    ph.amplitude,
  ].some((v) => v !== null && v !== undefined)
}

export function phenologyTable(
  ph?: PhenologyMetrics | null
): DataTable | null {
  if (!hasPhenology(ph) || !ph) return null
  return table(
    "phenology",
    "phenology.csv",
    [
      num("sos_doy"),
      num("pos_doy"),
      num("eos_doy"),
      num("los_days"),
      num("peak"),
      num("base"),
      num("amplitude"),
    ],
    [
      [
        ph.sos_doy,
        ph.pos_doy,
        ph.eos_doy,
        ph.los_days,
        ph.peak,
        ph.base,
        ph.amplitude,
      ],
    ]
  )
}

export function phenologyStatesTable(
  states: PhenologyStatePoint[]
): DataTable | null {
  return table(
    "phenology_states",
    "phenology_states.csv",
    [
      { key: "date" },
      num("state"),
      { key: "state_name" },
      { key: "color", swatch: true },
      num("ndvi_mean"),
    ],
    (states ?? []).map((s) => [
      s.date,
      s.state,
      s.state_name,
      s.color,
      s.ndvi_mean,
    ])
  )
}

export function temporalTable(points: TemporalPoint[]): DataTable | null {
  return table(
    "temporal",
    "temporal.csv",
    [
      { key: "date" },
      num("n_dates_stack"),
      num("soja_ndvi_mean"),
      num("soja_retention_pct"),
      { key: "dominant" },
    ],
    (points ?? []).map((t) => [
      t.date,
      t.n_dates_stack,
      t.soja_ndvi_mean,
      t.soja_retention_pct,
      t.dominant ?? "",
    ])
  )
}

export function lulcMetricsTable(lulc?: LULCAnalysis | null): DataTable | null {
  if (!lulc?.metrics) return null
  const m = lulc.metrics
  return table(
    "lulc_metrics",
    "lulc_metrics.csv",
    [
      num("year"),
      { key: "source" },
      num("area_ha"),
      num("n_pixels"),
      num("n_classes"),
      num("shannon_h"),
      num("pielou_j"),
      { key: "dominant_class" },
      num("dominant_pct"),
      num("soja_pct"),
      num("outras_lav_pct"),
      num("agricola_pct"),
    ],
    [
      [
        lulc.year,
        lulc.source,
        m.area_ha,
        m.n_pixels,
        m.n_classes,
        m.shannon_h,
        m.pielou_j,
        m.dominant_class,
        m.dominant_pct,
        m.soja_pct,
        m.outras_lav_pct,
        m.agricola_pct,
      ],
    ]
  )
}

export function lulcCompositionTable(
  lulc?: LULCAnalysis | null
): DataTable | null {
  return table(
    "lulc_composition",
    "lulc_composition.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      { key: "group" },
      num("pixels"),
      num("pct"),
      num("area_ha"),
    ],
    (lulc?.composition ?? []).map((c) => [
      c.class_id,
      c.name,
      c.color,
      c.group,
      c.pixels,
      c.pct,
      c.area_ha,
    ])
  )
}

export function lulcGroupsTable(lulc?: LULCAnalysis | null): DataTable | null {
  return table(
    "lulc_groups",
    "lulc_groups.csv",
    [
      { key: "group" },
      { key: "color", swatch: true },
      num("pct"),
      num("area_ha"),
    ],
    (lulc?.groups ?? []).map((g) => [g.group, g.color, g.pct, g.area_ha])
  )
}

export function lulcPredVsRefTable(
  lulc?: LULCAnalysis | null
): DataTable | null {
  return table(
    "lulc_pred_vs_ref",
    "lulc_pred_vs_ref.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pct_ref"),
      num("pct_pred"),
      // pixels_ref counts 10 m pixels; n_reference_cells counts the native 30 m
      // MapBiomas cells behind them, which is the agreement sample size.
      num("pixels_ref"),
      num("n_reference_cells"),
    ],
    (lulc?.pred_vs_ref ?? []).map((r) => [
      r.class_id,
      r.name,
      r.color,
      r.pct_ref,
      r.pct_pred,
      r.pixels_ref ?? 0,
      r.n_reference_cells ?? 0,
    ])
  )
}

export function waterSeriesTable(
  water?: WaterAnalysis | null
): DataTable | null {
  return table(
    "water_series",
    "water_series.csv",
    [
      { key: "date" },
      { key: "scene_id" },
      num("cloud_cover"),
      // The denominator of water_fraction_pct: AOI pixels seen on that date.
      num("observed_pixels"),
      num("threshold_fixed"),
      num("threshold_otsu"),
      { key: "threshold_clipped" },
      { key: "threshold_degenerate" },
      num("water_fraction_pct"),
      num("water_fraction_otsu_pct"),
      num("water_pixels"),
      num("area_ha"),
    ],
    (water?.series ?? []).map((d) => [
      d.date,
      d.scene_id,
      d.cloud_cover,
      d.observed_pixels,
      d.threshold_fixed,
      d.threshold_otsu,
      String(d.threshold_clipped),
      String(d.threshold_degenerate),
      d.water_fraction_pct,
      d.water_fraction_otsu_pct,
      d.water_pixels,
      d.area_ha,
    ])
  )
}

export function solarMonthlyTable(
  solar?: SolarAnalysis | null
): DataTable | null {
  return table(
    "solar_monthly",
    "solar_monthly.csv",
    [num("month"), num("ghi"), num("dni"), num("dhi"), num("kt")],
    (solar?.resource.monthly ?? []).map((m) => [
      m.month,
      m.ghi,
      m.dni,
      m.dhi,
      m.kt,
    ])
  )
}

export function solarTiltToleranceTable(
  solar?: SolarAnalysis | null
): DataTable | null {
  // What says how much the optimum matters: a tilt quoted without it reads as
  // a requirement rather than a peak.
  return table(
    "solar_tilt_tolerance",
    "solar_tilt_tolerance.csv",
    [num("deviation_deg"), num("loss_pct")],
    (solar?.geometry.tilt_tolerance ?? []).map((t) => [
      t.deviation_deg,
      t.loss_pct,
    ])
  )
}

/**
 * One row: the terrain layer's own statistics, written the way phenology is.
 *
 * The four value columns hold the layer named in `layer`, in `unit`, which is
 * not always an irradiation: the shading layer carries a blocked fraction and
 * the anisotropy layer a winter-over-summer ratio, so a column named poa_mean
 * would assert a quantity two of the layers do not report.
 *
 * The two shading columns are the loss as a share of BEAM irradiation, not of
 * the plane-of-array total. beam_fraction sits beside them because it is the
 * factor that converts one to the other; without it the pair reads as a loss of
 * the total and overstates the effect on yield.
 */
export function solarTerrainTable(
  terrain?: SolarTerrainAnalysis | null
): DataTable | null {
  return table(
    "solar_terrain",
    "solar_terrain.csv",
    [
      { key: "layer" },
      { key: "unit" },
      num("value_min"),
      num("value_max"),
      num("value_mean"),
      num("value_std_pct"),
      num("slope_mean_deg"),
      num("slope_max_deg"),
      num("pixels"),
      { key: "dem_source" },
      num("hourly_years"),
      num("shading_mean_pct_of_beam"),
      num("shading_max_pct_of_beam"),
      num("beam_fraction"),
      num("horizon_max_dist_m"),
    ],
    terrain && terrain.pixels > 0
      ? [
          [
            terrain.season,
            terrain.unit,
            terrain.poa_min,
            terrain.poa_max,
            terrain.poa_mean,
            terrain.poa_std_pct,
            terrain.slope_mean_deg,
            terrain.slope_max_deg,
            terrain.pixels,
            terrain.dem_source,
            terrain.hourly_years,
            terrain.shading_mean_pct,
            terrain.shading_max_pct,
            terrain.beam_fraction,
            terrain.horizon_max_dist_m,
          ],
        ]
      : []
  )
}

export function solarSitingTable(
  siting?: SolarSitingAnalysis | null
): DataTable | null {
  return table(
    "solar_siting_classes",
    "solar_siting_classes.csv",
    [
      num("code"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pixels"),
      num("area_ha"),
      num("pct"),
    ],
    (siting?.classes ?? []).map((c) => [
      c.code,
      c.name,
      c.color,
      c.pixels,
      c.area_ha,
      c.pct,
    ])
  )
}

/**
 * The chain from global horizontal irradiation to delivered AC energy.
 *
 * factor and cumulative_ratio are empty on context rows, which are not
 * multiplied in; in_performance_ratio says whether a step is inside the ratio
 * or outside it, which is what makes the chain reconcilable from the CSV alone.
 */
export function energyLossWaterfallTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_loss_waterfall",
    "energy_loss_waterfall.csv",
    [
      num("step"),
      { key: "label" },
      num("factor"),
      num("energy_after"),
      { key: "units" },
      num("cumulative_ratio"),
      { key: "kind" },
      { key: "in_performance_ratio" },
      { key: "source" },
    ],
    (energy?.loss_waterfall.steps ?? []).map((s) => [
      s.step,
      s.label,
      s.factor,
      s.energy_after,
      s.units,
      s.cumulative_ratio,
      s.kind,
      String(s.in_performance_ratio),
      s.source,
    ])
  )
}

/**
 * The PVWatts v5 loss stack this chain declares rather than models.
 *
 * Only the declared terms, matching the Go writer. The two optional terms
 * default to zero and are carried as their own type; they reach the export
 * through the waterfall rows, where their factor of 1.0 is visible.
 */
export function energyDeclaredLossesTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_declared_losses",
    "energy_declared_losses.csv",
    [
      { key: "key" },
      { key: "label" },
      num("loss_pct"),
      num("factor"),
      { key: "kind" },
      { key: "source" },
      { key: "user_editable" },
    ],
    (energy?.performance_ratio.declared_losses ?? []).map((l) => [
      l.key,
      l.label,
      l.loss_pct,
      l.factor,
      l.kind,
      l.source,
      String(l.user_editable),
    ])
  )
}

export function energyTrackingSeasonalTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_tracking_seasonal",
    "energy_tracking_seasonal.csv",
    [
      { key: "season" },
      num("fixed_poa_kwh_m2_season"),
      num("tracker_poa_kwh_m2_season"),
      num("gain_pct"),
    ],
    (energy?.tracking.seasonal.rows ?? []).map((s) => [
      s.season,
      s.fixed_poa_kwh_m2_season,
      s.tracker_poa_kwh_m2_season,
      s.gain_pct,
    ])
  )
}

export function energyGenerationMonthlyTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_generation_monthly",
    "energy_generation_monthly.csv",
    [
      num("month"),
      num("peak_sun_hours_day"),
      num("poa_kwh_m2_month"),
      num("ac_kwh_kwp_month"),
    ],
    (energy?.generation_profile.monthly.rows ?? []).map((m) => [
      m.month,
      m.peak_sun_hours_day,
      m.poa_kwh_m2_month,
      m.ac_kwh_kwp_month,
    ])
  )
}

export function energyGenerationHourlyShareTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_generation_hourly_share",
    "energy_generation_hourly_share.csv",
    [num("hour"), num("share_pct")],
    (energy?.generation_profile.share_of_annual_generation_by_hour.rows ?? []).map(
      (h) => [h.hour, h.share_pct]
    )
  )
}

/**
 * Mean AC power by month and hour, one row per month and one column per hour.
 *
 * A month carrying fewer than 24 hours is padded rather than dropped, so every
 * row still lines up under the hour columns. The hours are labelled on the time
 * standard the response reports, which is not necessarily local time.
 */
export function energyGenerationProfileTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  return table(
    "energy_generation_profile",
    "energy_generation_profile.csv",
    [
      num("month"),
      num("h00"),
      num("h01"),
      num("h02"),
      num("h03"),
      num("h04"),
      num("h05"),
      num("h06"),
      num("h07"),
      num("h08"),
      num("h09"),
      num("h10"),
      num("h11"),
      num("h12"),
      num("h13"),
      num("h14"),
      num("h15"),
      num("h16"),
      num("h17"),
      num("h18"),
      num("h19"),
      num("h20"),
      num("h21"),
      num("h22"),
      num("h23"),
    ],
    (energy?.generation_profile.mean_ac_power_by_month_and_hour.rows ?? []).map(
      (m) => [
        m.month,
        ...Array.from({ length: 24 }, (_, h) =>
          h < m.mean_ac_w_kwp.length ? m.mean_ac_w_kwp[h] : null
        ),
      ]
    )
  )
}

/**
 * convention and uncertainty_statement repeat on every row: the level column is
 * a bare integer and carries neither the convention that puts P90 below P50 nor
 * what the band excludes.
 */
export function energyExceedanceTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  const convention = energy?.plant.exceedance.convention ?? ""
  const statement = energy?.plant.uncertainty.statement ?? ""
  return table(
    "energy_exceedance",
    "energy_exceedance.csv",
    [
      num("level"),
      num("ghi_empirical_kwh_m2_year"),
      num("factor_empirical"),
      num("ghi_normal_kwh_m2_year"),
      num("factor_normal"),
      num("normal_fit_standard_error_kwh_m2"),
      { key: "convention" },
      { key: "uncertainty_statement" },
    ],
    (energy?.plant.exceedance.levels ?? []).map((l) => [
      l.level,
      l.ghi_empirical_kwh_m2_year,
      l.factor_empirical,
      l.ghi_normal_kwh_m2_year,
      l.factor_normal,
      l.normal_fit_standard_error_kwh_m2,
      convention,
      statement,
    ])
  )
}

/**
 * The three siting classes as one table, with a class column so the rows stay
 * distinguishable.
 *
 * They are never summed: cropland_conflict is the same land counted against its
 * current use rather than additional capacity. A class with no area is omitted
 * rather than written as zero, and restrictive fills the first four columns
 * only, because siting on slopes near the limit needs racking the capacity
 * density references do not cover.
 */
export function energyPlantCapacityTable(
  energy?: EnergyModelAnalysis | null
): DataTable | null {
  const plant = energy?.plant
  const rows: CellValue[][] = []
  if (plant) {
    for (const [name, c] of [
      ["suitable", plant.suitable],
      ["cropland_conflict", plant.cropland_conflict],
    ] as const) {
      if (c.area_ha <= 0) continue
      rows.push([
        name,
        c.label,
        c.area_ha,
        c.capacity_dc_mw,
        c.capacity_ac_mw,
        c.specific_yield_kwh_kwp_year,
        c.energy.p50_exceedance_gwh_year,
        c.energy.p75_exceedance_gwh_year,
        c.energy.p90_exceedance_gwh_year,
        c.contiguity.largest_ha,
        c.contiguity.n_patches,
        c.reporting_basis,
        c.performance_ratio,
        c.performance_ratio_source,
        c.note,
        plant.areas_note,
        plant.uncertainty.statement,
      ])
    }
    if (plant.restrictive.area_ha > 0) {
      rows.push([
        "restrictive",
        plant.restrictive.label,
        plant.restrictive.area_ha,
        // Null, never 0: this class carries no capacity figure at all.
        plant.restrictive.capacity_dc_mw,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        plant.restrictive.note,
        plant.areas_note,
        // The restrictive row carries no energy, so the band statement does
        // not apply to it; its own note and the never-summed rule do.
        "",
      ])
    }
  }
  return table(
    "energy_plant_capacity",
    "energy_plant_capacity.csv",
    [
      { key: "class" },
      { key: "label" },
      num("area_ha"),
      num("capacity_dc_mw"),
      num("capacity_ac_mw"),
      num("specific_yield_kwh_kwp_year"),
      num("p50_exceedance_gwh_year"),
      num("p75_exceedance_gwh_year"),
      num("p90_exceedance_gwh_year"),
      num("largest_patch_ha"),
      num("n_patches"),
      { key: "reporting_basis" },
      num("performance_ratio"),
      { key: "performance_ratio_source" },
      // A row read on its own carries neither the class's own qualifier, nor
      // the rule that the areas are never summed, nor what the exceedance band
      // leaves out.
      { key: "class_note" },
      { key: "areas_note" },
      { key: "uncertainty_statement" },
    ],
    rows
  )
}

export function windMonthlySpeedTable(
  wind?: WindAnalysis | null
): DataTable | null {
  return table(
    "wind_monthly_speed",
    "wind_monthly_speed.csv",
    [num("month"), num("mean_speed_ms")],
    (wind?.measured.monthly_mean_speed_50m ?? []).map((m) => [
      m.month,
      m.mean_speed_ms,
    ])
  )
}

/** energy_pct and hours_pct differ because energy goes as the cube of speed. */
export function windDirectionRoseTable(
  wind?: WindAnalysis | null
): DataTable | null {
  return table(
    "wind_direction_rose",
    "wind_direction_rose.csv",
    [num("sector"), num("centre_deg"), num("energy_pct"), num("hours_pct")],
    (wind?.measured.direction_energy_rose_50m ?? []).map((s) => [
      s.sector,
      s.centre_deg,
      s.energy_pct,
      s.hours_pct,
    ])
  )
}

/**
 * Hub-height result across the shear exponent.
 *
 * roughness_length_m is empty on the row derived from the record itself, which
 * inverts to a roughness rather than assuming one.
 *
 * The two result columns carry the gross and per-turbine qualifiers in their
 * names, and excluded_losses repeats on every row: read from the CSV alone,
 * "capacity_factor_pct" and "annual_energy_mwh" gave no sign that no plant loss
 * is applied and that the energy is one turbine's.
 */
export function windShearSensitivityTable(
  wind?: WindAnalysis | null
): DataTable | null {
  const excluded = (wind?.hub.excluded_losses ?? []).join("; ")
  return table(
    "wind_shear_sensitivity",
    "wind_shear_sensitivity.csv",
    [
      num("shear_exponent"),
      num("roughness_length_m"),
      { key: "basis" },
      num("hub_speed_ms"),
      num("gross_capacity_factor_pct"),
      num("gross_annual_energy_mwh_per_turbine"),
      { key: "excluded_losses" },
    ],
    (wind?.shear_sensitivity ?? []).map((s) => [
      s.shear_exponent,
      s.roughness_length_m,
      s.basis,
      s.hub_speed_ms,
      s.capacity_factor_pct,
      s.annual_energy_mwh,
      excluded,
    ])
  )
}

/** Every table a result can produce, in the order the ZIP writes them. */
export function allAnalysisTables(result: PredictResult): DataTable[] {
  return [
    classStatsTable(result.class_stats ?? []),
    viSeriesTable(result.vi_series ?? []),
    phenologyTable(result.phenology),
    phenologyStatesTable(result.phenology_states ?? []),
    temporalTable(result.temporal ?? []),
    lulcMetricsTable(result.lulc),
    lulcCompositionTable(result.lulc),
    lulcGroupsTable(result.lulc),
    lulcPredVsRefTable(result.lulc),
    waterSeriesTable(result.water),
    solarMonthlyTable(result.solar),
    solarTiltToleranceTable(result.solar),
    solarTerrainTable(result.solar_terrain),
    solarSitingTable(result.solar_siting),
    energyLossWaterfallTable(result.energy_model),
    energyDeclaredLossesTable(result.energy_model),
    energyTrackingSeasonalTable(result.energy_model),
    energyGenerationMonthlyTable(result.energy_model),
    energyGenerationHourlyShareTable(result.energy_model),
    energyGenerationProfileTable(result.energy_model),
    energyExceedanceTable(result.energy_model),
    energyPlantCapacityTable(result.energy_model),
    windMonthlySpeedTable(result.wind),
    windDirectionRoseTable(result.wind),
    windShearSensitivityTable(result.wind),
  ].filter((t): t is DataTable => t !== null)
}

/** RFC 4180 quoting, matching encoding/csv on the Go side. */
export function tableToCSV(t: DataTable): string {
  const esc = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const lines = [t.columns.map((c) => esc(c.key)).join(",")]
  for (const row of t.rows) {
    lines.push(row.map((cell) => esc(formatNumber(cell))).join(","))
  }
  return lines.join("\n")
}
