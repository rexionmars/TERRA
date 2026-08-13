package backend

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const researchExportSchemaVersion = 1

// researchTableColumns is the header row of every CSV the research pack can
// write, keyed by file name.
//
// frontend/src/lib/analysisTables.ts must define the same files with the same
// column keys in the same order: what the application shows on screen and what
// it exports have to be the same table, or a figure read on screen cannot be
// cited from the exported CSV. Nothing enforced that until
// TestResearchTableParity, which reads the TypeScript file and fails when the
// two drift. Keeping the headers here rather than inline is what makes that
// check possible.
var researchTableColumns = map[string][]string{
	"class_stats.csv": {"class_id", "name", "color", "pixels", "pct", "area_ha"},
	"vi_series.csv": {
		"date", "ndvi_mean", "ndvi_std", "evi_mean", "evi_std", "savi_mean", "savi_std",
	},
	"phenology.csv": {
		"sos_doy", "pos_doy", "eos_doy", "los_days", "peak", "base", "amplitude",
	},
	"phenology_states.csv": {"date", "state", "state_name", "color", "ndvi_mean"},
	"temporal.csv": {
		"date", "n_dates_stack", "soja_ndvi_mean", "soja_retention_pct", "dominant",
	},
	"lulc_metrics.csv": {
		"year", "source",
		"area_ha", "n_pixels", "n_classes", "shannon_h", "pielou_j",
		"dominant_class", "dominant_pct", "soja_pct", "outras_lav_pct", "agricola_pct",
	},
	"lulc_composition.csv": {
		"class_id", "name", "color", "group", "pixels", "pct", "area_ha",
	},
	"lulc_groups.csv": {"group", "color", "pct", "area_ha"},
	// pixels_ref counts 10 m pixels; n_reference_cells counts the native 30 m
	// MapBiomas cells behind them. An agreement statistic computed from this
	// table must use the cell count as its denominator.
	"lulc_pred_vs_ref.csv": {
		"class_id", "name", "color", "pct_ref", "pct_pred",
		"pixels_ref", "n_reference_cells",
	},
	// Compact domain fingerprint cached at classify (no raw sample matrix).
	"domain_fingerprint.csv": {
		"space", "n_features", "n_pixels", "n_sample",
		"mean_l2", "ndvi_hist_entropy",
	},
	// observed_pixels is the denominator of water_fraction_pct: the AOI pixels
	// actually seen on that date. A fraction cannot be recomputed against the
	// AOI area without it.
	"water_series.csv": {
		"date", "scene_id", "cloud_cover", "observed_pixels",
		"threshold_fixed", "threshold_otsu", "threshold_clipped",
		"threshold_degenerate", "water_fraction_pct",
		"water_fraction_otsu_pct", "water_pixels", "area_ha",
	},
	"solar_monthly.csv":        {"month", "ghi", "dni", "dhi", "kt"},
	"solar_tilt_tolerance.csv": {"deviation_deg", "loss_pct"},
	"solar_siting_classes.csv": {"code", "name", "color", "pixels", "area_ha", "pct"},

	// One row: the terrain layer's own statistics. The four value columns are
	// the layer named in `layer` and are in `unit`, which is not always an
	// irradiation: the shading layer carries a blocked fraction and the
	// anisotropy layer a winter-over-summer ratio, so a column named poa_mean
	// would assert a quantity two of the layers do not report.
	//
	// The two shading columns are the loss as a share of BEAM irradiation, not
	// of the plane-of-array total (sidecar/solar.py shading_loss_fraction).
	// beam_fraction sits beside them because it is the factor that converts one
	// to the other; without it the pair reads as a loss of the total and
	// overstates the effect on yield.
	"solar_terrain.csv": {
		"layer", "unit", "value_min", "value_max", "value_mean", "value_std_pct",
		"slope_mean_deg", "slope_max_deg", "pixels", "dem_source", "hourly_years",
		"shading_mean_pct_of_beam", "shading_max_pct_of_beam", "beam_fraction",
		"horizon_max_dist_m",
		"sky_view_applied", "sky_view_mean_horizon_deg", "sky_view_max_horizon_deg",
		"sky_view_threshold_deg", "sky_view_diffuse_loss_mean_pct",
		"sky_view_diffuse_loss_max_pct",
	},

	// factor and cumulative_ratio are empty on context rows, which are not
	// multiplied in; in_performance_ratio says whether a step is inside the
	// ratio or outside it, which is what makes the waterfall reconcilable.
	"energy_loss_waterfall.csv": {
		"step", "label", "factor", "energy_after", "units",
		"cumulative_ratio", "kind", "in_performance_ratio", "source",
	},
	"energy_declared_losses.csv": {
		"key", "label", "loss_pct", "factor", "kind", "source", "user_editable",
	},
	"energy_tracking_seasonal.csv": {
		"season", "fixed_poa_kwh_m2_season", "tracker_poa_kwh_m2_season", "gain_pct",
	},
	"energy_generation_monthly.csv": {
		"month", "peak_sun_hours_day", "poa_kwh_m2_month", "ac_kwh_kwp_month",
	},
	"energy_generation_hourly_share.csv": {"hour", "share_pct"},
	// One row per month, one column per hour of the day, in W per kWp. The hour
	// columns are labelled on the time standard reported in the response.
	"energy_generation_profile.csv": {
		"month",
		"h00", "h01", "h02", "h03", "h04", "h05", "h06", "h07",
		"h08", "h09", "h10", "h11", "h12", "h13", "h14", "h15",
		"h16", "h17", "h18", "h19", "h20", "h21", "h22", "h23",
	},
	// uncertainty_statement repeats on every row because a CSV is read on its
	// own: the band these levels describe propagates measured interannual
	// variability of the resource only, and a P90 read without that reads as a
	// P90 used for project finance, which is a wider band.
	"energy_exceedance.csv": {
		"level", "ghi_empirical_kwh_m2_year", "factor_empirical",
		"ghi_normal_kwh_m2_year", "factor_normal",
		"normal_fit_standard_error_kwh_m2", "convention", "uncertainty_statement",
	},
	// The classes are never summed: cropland_conflict is the same land counted
	// against its current use, not additional capacity. restrictive carries an
	// area and nothing else.
	//
	// That rule and the width of the exceedance band are carried as columns
	// rather than left to the manifest, for the same reason: a reader opening
	// this file alone sees a suitable row and a cropland_conflict row, each
	// with an area and a p90, and nothing else on the page says they must not
	// be added together or what the band leaves out.
	"energy_plant_capacity.csv": {
		"class", "label", "area_ha", "capacity_dc_mw", "capacity_ac_mw",
		"specific_yield_kwh_kwp_year", "p50_exceedance_gwh_year",
		"p75_exceedance_gwh_year", "p90_exceedance_gwh_year",
		"largest_patch_ha", "n_patches", "reporting_basis",
		"performance_ratio", "performance_ratio_source",
		"class_note", "areas_note", "uncertainty_statement",
	},
	"wind_monthly_speed.csv": {"month", "mean_speed_ms"},
	// energy_pct and hours_pct differ because energy goes as the cube of speed.
	"wind_direction_rose.csv": {"sector", "centre_deg", "energy_pct", "hours_pct"},
	// roughness_length_m is empty on the row derived from the record itself,
	// which inverts to a roughness rather than assuming one.
	//
	// The capacity factor and the energy carry the same two qualifiers the
	// manifest gives them, in the column names: gross of the losses listed in
	// excluded_losses (sidecar/wind.py capacity_factor, "Gross of all losses"),
	// and per turbine (annual_energy_mwh, "Per turbine only. Array wake losses
	// are not modelled"). A bare capacity_factor_pct column read on its own is
	// taken for a plant figure, which is the reading both qualifiers exist to
	// prevent.
	"wind_shear_sensitivity.csv": {
		"shear_exponent", "roughness_length_m", "basis", "hub_speed_ms",
		"gross_capacity_factor_pct", "gross_annual_energy_mwh_per_turbine",
		"excluded_losses",
	},
}

// researchHeader returns the registered header row for a CSV, as the first row
// of a table under construction. It panics on an unregistered name so a table
// cannot be written outside the registry the parity check reads.
func researchHeader(csvName string) [][]string {
	cols, ok := researchTableColumns[csvName]
	if !ok {
		panic("export_research: no column list registered for " + csvName)
	}
	return [][]string{cols}
}

// BuildResearchPackZIP builds a portable ZIP with CSVs, manifest, optional AOI,
// and optional classification GeoTIFF for an external training workspace.
// dataDir is used to resolve relative RasterTIF paths (e.g. runs/<id>/…).
func BuildResearchPackZIP(meta ResearchExportMeta, result *PredictResult, dataDir string) ([]byte, error) {
	if result == nil {
		return nil, fmt.Errorf("no analysis result to export")
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := map[string]any{
		"schema_version":  researchExportSchemaVersion,
		"exported_at":     time.Now().UTC().Format(time.RFC3339),
		"model_kind":      strings.TrimSpace(meta.ModelKind),
		"area_id":         strings.TrimSpace(meta.AreaID),
		"aoi_label":       strings.TrimSpace(meta.AoiLabel),
		"n_dates":         result.NDates,
		"date_range":      result.DateRange,
		"mean_confidence": result.MeanConfidence,
		"extent":          result.Extent,
	}
	// Sample size of the MapBiomas comparison. The reference is native at 30 m
	// and is resampled onto the 10 m grid, so the pixel count overstates the
	// number of independent label observations by roughly nine times.
	if sol := result.Solar; sol != nil {
		// Every solar figure travels with the assumption that produced it.
		manifest["solar_ghi_annual_kwh_m2"] = sol.Resource.GHIAnnualKWhM2
		manifest["solar_n_years"] = sol.Resource.NYears
		manifest["solar_optimal_tilt_deg"] = sol.Geometry.OptimalTiltDeg
		manifest["solar_surface_azimuth_deg"] = sol.Geometry.SurfaceAzimuthDeg
		manifest["solar_specific_yield_kwh_kwp_year"] = sol.PV.SpecificYieldKWhKWpYear
		manifest["solar_performance_ratio"] = sol.PV.PerformanceRatio
		manifest["solar_performance_ratio_source"] = sol.PV.PerformanceRatioSource
		manifest["solar_performance_ratio_modelled"] = sol.PV.PerformanceRatioModelled
		manifest["solar_grid_note"] = sol.GridNote
	}
	if tr := result.SolarTerrain; tr != nil {
		// The layer and its unit come first because the value statistics are
		// not always an irradiation: on the shading layer they are a blocked
		// fraction of beam, on the anisotropy layer a winter-over-summer ratio.
		manifest["solar_terrain_layer"] = tr.Season
		manifest["solar_terrain_unit"] = tr.Unit
		manifest["solar_terrain_value_mean"] = tr.POAMean
		manifest["solar_terrain_value_min"] = tr.POAMin
		manifest["solar_terrain_value_max"] = tr.POAMax
		manifest["solar_terrain_value_std_pct"] = tr.POAStdPct
		manifest["solar_terrain_slope_mean_deg"] = tr.SlopeMeanDeg
		manifest["solar_terrain_slope_max_deg"] = tr.SlopeMaxDeg
		manifest["solar_terrain_pixels"] = tr.Pixels
		manifest["solar_terrain_dem_source"] = tr.DEMSource
		manifest["solar_terrain_hourly_years"] = tr.HourlyYears
		// Named for what they are: a share of the beam, not of the total.
		// beam_fraction is what converts the pair to a share of the total.
		manifest["solar_terrain_shading_mean_pct_of_beam"] = tr.ShadingMeanPct
		manifest["solar_terrain_shading_max_pct_of_beam"] = tr.ShadingMaxPct
		manifest["solar_terrain_beam_fraction"] = tr.BeamFraction
		manifest["solar_terrain_horizon_max_dist_m"] = tr.HorizonMaxDistM
	}
	if st := result.SolarSiting; st != nil {
		// Reported apart, never summed.
		manifest["solar_siting_suitable_no_conflict_ha"] = st.SuitableNoConflictHa
		manifest["solar_siting_suitable_cropland_ha"] = st.SuitableCroplandHa
		manifest["solar_siting_thresholds"] = st.Thresholds
	}
	if w := result.Water; w != nil && len(w.Series) > 0 {
		manifest["water_index"] = w.Index
		manifest["water_threshold"] = w.ThresholdFixed
		manifest["water_n_dates"] = w.NDates
		manifest["water_peak_date"] = w.PeakDate
		manifest["water_peak_fraction_pct"] = w.PeakWaterPct
		manifest["water_ephemeral_area_ha"] = w.EphemeralAreaHa
		manifest["water_persistent_area_ha"] = w.PersistentAreaHa
		manifest["water_aoi_area_ha"] = w.AOIAreaHa
	}
	if e := result.EnergyModel; e != nil {
		// The applied ratio, its provenance and the reporting basis are what
		// make every energy figure in this pack interpretable; a yield exported
		// without them is not a figure.
		manifest["energy_performance_ratio_applied"] = e.PerformanceRatio.Applied
		manifest["energy_performance_ratio_source"] = e.PerformanceRatio.AppliedSource
		manifest["energy_performance_ratio_modelled"] = e.PerformanceRatio.Modelled
		manifest["energy_performance_ratio_derived"] = e.PerformanceRatio.Derived
		manifest["energy_reporting_basis"] = e.ReportingBasis
		manifest["energy_degradation_factor"] = e.PerformanceRatio.DegradationFactor
		manifest["energy_optimal_tilt_deg"] = e.Geometry.OptimalTiltDeg
		manifest["energy_poa_kwh_m2_year"] = e.Geometry.POAKWhM2Year
		manifest["energy_specific_yield_kwh_kwp_year"] = e.LossWaterfall.Delivered.AppliedKWhKWpYear
		manifest["energy_capacity_factor_pct"] = e.LossWaterfall.Delivered.AppliedCapacityFactorPct
		manifest["energy_capacity_density_basis"] = e.CapacityDensity.Basis
		manifest["energy_capacity_density_mw_dc_per_ha"] = e.CapacityDensity.ValueMWDCPerHa
		manifest["energy_capacity_density_area_basis"] = e.CapacityDensity.AreaBasis
		manifest["energy_hourly_window"] = e.HourlyWindow
		manifest["energy_climatology_window"] = e.ClimatologyWindow
		manifest["energy_plant_limitations"] = e.Plant.Limitations
		manifest["energy_grid_note"] = e.GridNote
		// The two statements that stop the plant figures being read wrongly.
		// areas_note is the rule that the three class areas are reported apart
		// and never summed; the uncertainty block states that the exceedance
		// band propagates measured interannual variability of the resource
		// only, which makes it narrower than a P90 used for project finance.
		// Exported without them the areas invite a sum and the band invites the
		// standing of a bankable P90.
		manifest["energy_areas_note"] = e.Plant.AreasNote
		manifest["energy_uncertainty_statement"] = e.Plant.Uncertainty.Statement
		manifest["energy_uncertainty_included"] = e.Plant.Uncertainty.Included
		manifest["energy_uncertainty_excluded"] = e.Plant.Uncertainty.Excluded
		manifest["energy_uncertainty_dominant_term"] = e.Plant.Uncertainty.DominantTerm
		// P90 is the value exceeded in 90 percent of years and is therefore
		// below P50. Without the convention the levels read as statistical
		// percentiles, under which the labels invert.
		manifest["energy_exceedance_convention"] = e.Plant.Exceedance.Convention
		manifest["energy_exceedance_convention_note"] = e.Plant.Exceedance.ConventionNote
		manifest["energy_exceedance_linearity_assumption"] = e.Plant.Exceedance.LinearityAssumption
	}
	if wd := result.Wind; wd != nil {
		// The qualifier and the failed-check list travel with the capacity
		// factor. Read without them the figure has the standing of the
		// photovoltaic one, which it does not have.
		manifest["wind_qualifier"] = wd.Qualifier
		manifest["wind_record_window"] = wd.RecordWindow
		manifest["wind_hub_height_m"] = wd.HubHeightM
		manifest["wind_hub_height_source"] = wd.Assumptions.HubHeightSource
		manifest["wind_mean_speed_50m_ms"] = wd.Measured.MeanSpeed50mMS
		manifest["wind_shear_exponent"] = wd.Measured.ShearExponent
		manifest["wind_shear_exponent_source"] = wd.Assumptions.ShearExponentSource
		manifest["wind_is_extrapolation"] = wd.Hub.Extrapolation.IsExtrapolation
		manifest["wind_height_ratio"] = wd.Hub.Extrapolation.HeightRatio
		manifest["wind_gross_capacity_factor_pct"] = wd.Hub.GrossCapacityFactorPct
		manifest["wind_gross_annual_energy_mwh_per_turbine"] = wd.Hub.GrossAnnualEnergyMWhPerTurbine
		manifest["wind_turbine"] = wd.Turbine.Name
		manifest["wind_turbine_citation"] = wd.Turbine.Citation
		// Which power curve, from where, at which revision. The citation names
		// the turbine; these say which file the numbers were read from, which
		// is what a reader needs to obtain the same curve.
		manifest["wind_turbine_citation_url"] = wd.Turbine.CitationURL
		manifest["wind_turbine_curve_source_url"] = wd.Turbine.CurveSourceURL
		manifest["wind_turbine_curve_source_commit"] = wd.Turbine.CurveSourceCommit
		manifest["wind_excluded_losses"] = wd.Hub.ExcludedLosses
		manifest["wind_all_checks_passed"] = wd.DataQuality.AllChecksPassed
		manifest["wind_flags"] = wd.DataQuality.Flags
		manifest["wind_comparison_note"] = wd.Assumptions.ComparisonNote
		manifest["wind_grid_note"] = wd.GridNote
	}
	if result.LULC != nil && result.LULC.CompareReferenceCells > 0 {
		manifest["compare_pixels"] = result.LULC.ComparePixels
		manifest["compare_reference_cells"] = result.LULC.CompareReferenceCells
	}
	if err := writeZipJSON(zw, "manifest.json", manifest); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if poly := strings.TrimSpace(meta.PolygonGeoJSON); poly != "" && poly != "null" {
		aoiPayload, err := normalizeAOIGeoJSON(poly)
		if err != nil {
			_ = zw.Close()
			return nil, fmt.Errorf("aoi geojson: %w", err)
		}
		if err := writeZipBytes(zw, "aoi.geojson", aoiPayload); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.ClassStats) > 0 {
		rows := researchHeader("class_stats.csv")
		for _, c := range result.ClassStats {
			rows = append(rows, []string{
				strconv.Itoa(c.ClassID),
				c.Name,
				c.Color,
				strconv.Itoa(c.Pixels),
				formatFloat(c.Pct),
				formatFloat(c.AreaHa),
			})
		}
		if err := writeZipCSV(zw, "class_stats.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.VISeries) > 0 {
		rows := researchHeader("vi_series.csv")
		for _, p := range result.VISeries {
			rows = append(rows, []string{
				p.Date,
				formatFloat(p.NDVIMean),
				formatFloat(p.NDVIStd),
				formatFloat(p.EVIMean),
				formatFloat(p.EVIStd),
				formatFloat(p.SAVIMean),
				formatFloat(p.SAVIStd),
			})
		}
		if err := writeZipCSV(zw, "vi_series.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if hasPhenology(result.Phenology) {
		rows := researchHeader("phenology.csv")
		ph := result.Phenology
		rows = append(rows, []string{
			formatFloatPtr(ph.SOSDOY),
			formatFloatPtr(ph.POSDOY),
			formatFloatPtr(ph.EOSDOY),
			formatFloatPtr(ph.LOSDays),
			formatFloatPtr(ph.Peak),
			formatFloatPtr(ph.Base),
			formatFloatPtr(ph.Amplitude),
		})
		if err := writeZipCSV(zw, "phenology.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.PhenologyStates) > 0 {
		rows := researchHeader("phenology_states.csv")
		for _, s := range result.PhenologyStates {
			rows = append(rows, []string{
				s.Date,
				strconv.Itoa(s.State),
				s.StateName,
				s.Color,
				formatFloatPtr(s.NDVIMean),
			})
		}
		if err := writeZipCSV(zw, "phenology_states.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.Temporal) > 0 {
		rows := researchHeader("temporal.csv")
		for _, t := range result.Temporal {
			dom := ""
			if t.Dominant != nil {
				dom = *t.Dominant
			}
			rows = append(rows, []string{
				t.Date,
				strconv.Itoa(t.NDatesStack),
				formatFloatPtr(t.SojaNDVIMean),
				formatFloatPtr(t.SojaRetentionPct),
				dom,
			})
		}
		if err := writeZipCSV(zw, "temporal.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if result.LULC != nil {
		lulc := result.LULC
		m := lulc.Metrics
		metricRows := researchHeader("lulc_metrics.csv")
		metricRows = append(metricRows, []string{
			strconv.Itoa(lulc.Year),
			lulc.Source,
			formatFloat(m.AreaHa),
			strconv.Itoa(m.NPixels),
			strconv.Itoa(m.NClasses),
			formatFloat(m.ShannonH),
			formatFloat(m.PielouJ),
			m.DominantClass,
			formatFloat(m.DominantPct),
			formatFloat(m.SojaPct),
			formatFloat(m.OutrasLavPct),
			formatFloat(m.AgricolaPct),
		})
		if err := writeZipCSV(zw, "lulc_metrics.csv", metricRows); err != nil {
			_ = zw.Close()
			return nil, err
		}

		if len(lulc.Composition) > 0 {
			rows := researchHeader("lulc_composition.csv")
			for _, c := range lulc.Composition {
				rows = append(rows, []string{
					strconv.Itoa(c.ClassID),
					c.Name,
					c.Color,
					c.Group,
					strconv.Itoa(c.Pixels),
					formatFloat(c.Pct),
					formatFloat(c.AreaHa),
				})
			}
			if err := writeZipCSV(zw, "lulc_composition.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(lulc.Groups) > 0 {
			rows := researchHeader("lulc_groups.csv")
			for _, g := range lulc.Groups {
				rows = append(rows, []string{
					g.Group,
					g.Color,
					formatFloat(g.Pct),
					formatFloat(g.AreaHa),
				})
			}
			if err := writeZipCSV(zw, "lulc_groups.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(lulc.PredVsRef) > 0 {
			rows := researchHeader("lulc_pred_vs_ref.csv")
			for _, r := range lulc.PredVsRef {
				rows = append(rows, []string{
					strconv.Itoa(r.ClassID),
					r.Name,
					r.Color,
					formatFloat(r.PctRef),
					formatFloat(r.PctPred),
					strconv.Itoa(r.PixelsRef),
					strconv.Itoa(r.NReferenceCells),
				})
			}
			if err := writeZipCSV(zw, "lulc_pred_vs_ref.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if fp := result.DomainFingerprint; fp != nil {
		rows := researchHeader("domain_fingerprint.csv")
		meanL2 := 0.0
		for _, v := range fp.Mean {
			meanL2 += v * v
		}
		meanL2 = math.Sqrt(meanL2)
		entropy := 0.0
		if fp.NDVIHist != nil {
			for _, p := range fp.NDVIHist.Probs {
				if p > 0 {
					entropy -= p * math.Log(p)
				}
			}
		}
		rows = append(rows, []string{
			fp.Space,
			strconv.Itoa(fp.NFeatures),
			strconv.Itoa(fp.NPixels),
			strconv.Itoa(fp.NSample),
			formatFloat(meanL2),
			formatFloat(entropy),
		})
		if err := writeZipCSV(zw, "domain_fingerprint.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if w := result.Water; w != nil && len(w.Series) > 0 {
		rows := researchHeader("water_series.csv")
		for _, d := range w.Series {
			rows = append(rows, []string{
				d.Date,
				d.SceneID,
				formatFloat(d.CloudCover),
				strconv.Itoa(d.ObservedPixels),
				formatFloat(d.ThresholdFixed),
				formatFloat(d.ThresholdOtsu),
				strconv.FormatBool(d.ThresholdClipped),
				strconv.FormatBool(d.ThresholdDegenerate),
				formatFloat(d.WaterFractionPct),
				formatFloat(d.WaterFractionOtsu),
				strconv.Itoa(d.WaterPixels),
				formatFloat(d.AreaHa),
			})
		}
		if err := writeZipCSV(zw, "water_series.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if sol := result.Solar; sol != nil && len(sol.Resource.Monthly) > 0 {
		rows := researchHeader("solar_monthly.csv")
		for _, m := range sol.Resource.Monthly {
			rows = append(rows, []string{
				strconv.Itoa(m.Month),
				formatFloatPtr(m.GHI),
				formatFloatPtr(m.DNI),
				formatFloatPtr(m.DHI),
				formatFloatPtr(m.KT),
			})
		}
		if err := writeZipCSV(zw, "solar_monthly.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}

		// The tilt tolerance is what says how much the optimum matters: a
		// figure quoted without it reads as a requirement rather than a peak.
		tol := researchHeader("solar_tilt_tolerance.csv")
		for _, t := range sol.Geometry.TiltTolerance {
			tol = append(tol, []string{
				formatFloat(t.DeviationDeg), formatFloat(t.LossPct),
			})
		}
		if len(tol) > 1 {
			if err := writeZipCSV(zw, "solar_tilt_tolerance.csv", tol); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	// A terrain layer is one row of statistics rather than a series, so it is
	// written the way phenology.csv is. Before this, a terrain-only AOI reached
	// BuildResearchPackZIP with no branch to match and the export reported
	// success over a ZIP holding manifest.json alone.
	if tr := result.SolarTerrain; tr != nil && tr.Pixels > 0 {
		rows := researchHeader("solar_terrain.csv")
		skyApplied, skyMean, skyMax, skyThr, skyDiffMean, skyDiffMax := "", "", "", "", "", ""
		if sv := tr.SkyView; sv != nil {
			if sv.Applied {
				skyApplied = "yes"
			} else {
				skyApplied = "no"
			}
			skyMean = formatFloat(sv.MeanHorizonDeg)
			skyMax = formatFloat(sv.MaxHorizonDeg)
			skyThr = formatFloat(sv.ThresholdDeg)
			skyDiffMean = formatFloatPtr(sv.DiffuseLossMeanPct)
			skyDiffMax = formatFloatPtr(sv.DiffuseLossMaxPct)
		}
		rows = append(rows, []string{
			tr.Season,
			tr.Unit,
			formatFloat(tr.POAMin),
			formatFloat(tr.POAMax),
			formatFloat(tr.POAMean),
			formatFloat(tr.POAStdPct),
			formatFloat(tr.SlopeMeanDeg),
			formatFloat(tr.SlopeMaxDeg),
			strconv.Itoa(tr.Pixels),
			tr.DEMSource,
			strconv.Itoa(tr.HourlyYears),
			formatFloatPtr(tr.ShadingMeanPct),
			formatFloatPtr(tr.ShadingMaxPct),
			formatFloat(tr.BeamFraction),
			formatFloat(tr.HorizonMaxDistM),
			skyApplied,
			skyMean,
			skyMax,
			skyThr,
			skyDiffMean,
			skyDiffMax,
		})
		if err := writeZipCSV(zw, "solar_terrain.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if st := result.SolarSiting; st != nil && len(st.Classes) > 0 {
		rows := researchHeader("solar_siting_classes.csv")
		for _, c := range st.Classes {
			rows = append(rows, []string{
				strconv.Itoa(c.Code), c.Name, c.Color,
				strconv.Itoa(c.Pixels), formatFloat(c.AreaHa), formatFloat(c.Pct),
			})
		}
		if err := writeZipCSV(zw, "solar_siting_classes.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if e := result.EnergyModel; e != nil {
		if len(e.LossWaterfall.Steps) > 0 {
			rows := researchHeader("energy_loss_waterfall.csv")
			for _, s := range e.LossWaterfall.Steps {
				rows = append(rows, []string{
					strconv.Itoa(s.Step),
					s.Label,
					formatFloatPtr(s.Factor),
					formatFloat(s.EnergyAfter),
					s.Units,
					formatFloatPtr(s.CumulativeRatio),
					s.Kind,
					strconv.FormatBool(s.InPerformanceRatio),
					s.Source,
				})
			}
			if err := writeZipCSV(zw, "energy_loss_waterfall.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.PerformanceRatio.DeclaredLosses) > 0 {
			rows := researchHeader("energy_declared_losses.csv")
			for _, l := range e.PerformanceRatio.DeclaredLosses {
				rows = append(rows, []string{
					l.Key, l.Label,
					formatFloat(l.LossPct), formatFloat(l.Factor),
					l.Kind, l.Source, strconv.FormatBool(l.UserEditable),
				})
			}
			if err := writeZipCSV(zw, "energy_declared_losses.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.Tracking.Seasonal.Rows) > 0 {
			rows := researchHeader("energy_tracking_seasonal.csv")
			for _, s := range e.Tracking.Seasonal.Rows {
				rows = append(rows, []string{
					s.Season,
					formatFloat(s.FixedPOAKWhM2Season),
					formatFloat(s.TrackerPOAKWhM2Season),
					formatFloat(s.GainPct),
				})
			}
			if err := writeZipCSV(zw, "energy_tracking_seasonal.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.GenerationProfile.Monthly.Rows) > 0 {
			rows := researchHeader("energy_generation_monthly.csv")
			for _, m := range e.GenerationProfile.Monthly.Rows {
				rows = append(rows, []string{
					strconv.Itoa(m.Month),
					formatFloat(m.PeakSunHoursDay),
					formatFloat(m.POAKWhM2Month),
					formatFloat(m.ACKWhKWpMonth),
				})
			}
			if err := writeZipCSV(zw, "energy_generation_monthly.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.GenerationProfile.ShareOfAnnualByHour.Rows) > 0 {
			rows := researchHeader("energy_generation_hourly_share.csv")
			for _, h := range e.GenerationProfile.ShareOfAnnualByHour.Rows {
				rows = append(rows, []string{
					strconv.Itoa(h.Hour), formatFloat(h.SharePct),
				})
			}
			if err := writeZipCSV(zw, "energy_generation_hourly_share.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.GenerationProfile.MeanACPowerByMonthAndHour.Rows) > 0 {
			// A short row is padded rather than dropped: a month that carried
			// fewer than 24 hours must still line up under the hour columns.
			rows := researchHeader("energy_generation_profile.csv")
			for _, m := range e.GenerationProfile.MeanACPowerByMonthAndHour.Rows {
				row := make([]string, 0, 25)
				row = append(row, strconv.Itoa(m.Month))
				for h := 0; h < 24; h++ {
					if h < len(m.MeanACWKWp) {
						row = append(row, formatFloat(m.MeanACWKWp[h]))
					} else {
						row = append(row, "")
					}
				}
				rows = append(rows, row)
			}
			if err := writeZipCSV(zw, "energy_generation_profile.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(e.Plant.Exceedance.Levels) > 0 {
			rows := researchHeader("energy_exceedance.csv")
			for _, l := range e.Plant.Exceedance.Levels {
				rows = append(rows, []string{
					strconv.Itoa(l.Level),
					formatFloat(l.GHIEmpiricalKWhM2Year),
					formatFloat(l.FactorEmpirical),
					formatFloat(l.GHINormalKWhM2Year),
					formatFloat(l.FactorNormal),
					formatFloat(l.NormalFitStandardErrorKWhM2),
					// Repeated on every row: the level column is a bare integer
					// and carries neither the convention that puts P90 below
					// P50 nor what the band excludes.
					e.Plant.Exceedance.Convention,
					e.Plant.Uncertainty.Statement,
				})
			}
			if err := writeZipCSV(zw, "energy_exceedance.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if rows := energyPlantCapacityRows(&e.Plant); len(rows) > 1 {
			if err := writeZipCSV(zw, "energy_plant_capacity.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if wd := result.Wind; wd != nil {
		if len(wd.Measured.MonthlyMeanSpeed50m) > 0 {
			rows := researchHeader("wind_monthly_speed.csv")
			for _, m := range wd.Measured.MonthlyMeanSpeed50m {
				rows = append(rows, []string{
					strconv.Itoa(m.Month), formatFloat(m.MeanSpeedMS),
				})
			}
			if err := writeZipCSV(zw, "wind_monthly_speed.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(wd.Measured.DirectionEnergyRose50m) > 0 {
			rows := researchHeader("wind_direction_rose.csv")
			for _, s := range wd.Measured.DirectionEnergyRose50m {
				rows = append(rows, []string{
					strconv.Itoa(s.Sector),
					formatFloat(s.CentreDeg),
					formatFloat(s.EnergyPct),
					formatFloat(s.HoursPct),
				})
			}
			if err := writeZipCSV(zw, "wind_direction_rose.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(wd.ShearSensitivity) > 0 {
			rows := researchHeader("wind_shear_sensitivity.csv")
			// What "gross" leaves out, on every row: the column name states
			// that losses are excluded, and this states which.
			excluded := strings.Join(wd.Hub.ExcludedLosses, "; ")
			for _, s := range wd.ShearSensitivity {
				rows = append(rows, []string{
					formatFloat(s.ShearExponent),
					formatFloatPtr(s.RoughnessLengthM),
					s.Basis,
					formatFloat(s.HubSpeedMS),
					formatFloat(s.CapacityFactorPct),
					formatFloat(s.AnnualEnergyMWh),
					excluded,
				})
			}
			if err := writeZipCSV(zw, "wind_shear_sensitivity.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if rasterPath := ResolveRasterPath(result.RasterTIF, dataDir); rasterPath != "" {
		if err := writeZipFile(zw, "rasters/classification.tif", rasterPath); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ResolveRasterPath returns an existing filesystem path for a classification
// GeoTIFF, or "" when missing / data-URI-only.
func ResolveRasterPath(rasterTIF, dataDir string) string {
	src := strings.TrimSpace(rasterTIF)
	if src == "" || strings.HasPrefix(src, "data:") {
		return ""
	}
	candidates := []string{src}
	if !filepath.IsAbs(src) && strings.TrimSpace(dataDir) != "" {
		candidates = append(candidates, filepath.Join(dataDir, src))
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// DefaultResearchPackFilename builds terra-export-<slug>-YYYYMMDD.zip.
func DefaultResearchPackFilename(aoiLabel string) string {
	slug := slugify(aoiLabel)
	if slug == "" {
		slug = "analysis"
	}
	stamp := time.Now().Format("20060102")
	return fmt.Sprintf("terra-export-%s-%s.zip", slug, stamp)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlug.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 48 {
		s = strings.Trim(s[:48], "-")
	}
	return s
}

// energyPlantCapacityRows lays the three siting classes out as one table, with
// a class column so the rows stay distinguishable.
//
// They are never summed: cropland_conflict is the same land counted against its
// current use rather than additional capacity, and restrictive is area only
// because siting on slopes near the limit needs racking the capacity density
// does not cover. A class with no area is omitted rather than written as zero.
//
// The last three columns are that rule and the width of the band, written onto
// every row. They are constant down the table, which is the cost of a flat CSV;
// the alternative is a table whose areas can be added together and whose p90
// column carries the standing of a project finance P90, with the correction
// living somewhere the reader does not have open.
func energyPlantCapacityRows(p *EnergyPlant) [][]string {
	rows := researchHeader("energy_plant_capacity.csv")
	sited := func(class string, c *EnergyPlantClass) {
		if c.AreaHa <= 0 {
			return
		}
		rows = append(rows, []string{
			class,
			c.Label,
			formatFloat(c.AreaHa),
			formatFloat(c.CapacityDCMW),
			formatFloat(c.CapacityACMW),
			formatFloat(c.SpecificYieldKWhKWpYear),
			formatFloat(c.Energy.P50GWhYear),
			formatFloat(c.Energy.P75GWhYear),
			formatFloat(c.Energy.P90GWhYear),
			formatFloat(c.Contiguity.LargestHa),
			strconv.Itoa(c.Contiguity.NPatches),
			c.ReportingBasis,
			formatFloat(c.PerformanceRatio),
			c.PerformanceRatioSource,
			c.Note,
			p.AreasNote,
			p.Uncertainty.Statement,
		})
	}
	sited("suitable", &p.Suitable)
	sited("cropland_conflict", &p.CroplandConflict)
	if p.Restrictive.AreaHa > 0 {
		rows = append(rows, []string{
			"restrictive",
			p.Restrictive.Label,
			formatFloat(p.Restrictive.AreaHa),
			formatFloatPtr(p.Restrictive.CapacityDCMW),
			"", "", "", "", "", "", "", "", "", "",
			// The restrictive row carries no energy, so the band statement does
			// not apply to it; its own note and the never-summed rule do.
			p.Restrictive.Note,
			p.AreasNote,
			"",
		})
	}
	return rows
}

func hasPhenology(p PhenologyMetrics) bool {
	return p.SOSDOY != nil || p.POSDOY != nil || p.EOSDOY != nil ||
		p.LOSDays != nil || p.Peak != nil || p.Base != nil || p.Amplitude != nil
}

func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func formatFloatPtr(v *float64) string {
	if v == nil {
		return ""
	}
	return formatFloat(*v)
}

func normalizeAOIGeoJSON(raw string) ([]byte, error) {
	var anyJSON any
	if err := json.Unmarshal([]byte(raw), &anyJSON); err != nil {
		return nil, err
	}
	m, ok := anyJSON.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected GeoJSON object")
	}
	// Already a Feature or FeatureCollection — keep as-is.
	if t, _ := m["type"].(string); t == "Feature" || t == "FeatureCollection" {
		return json.MarshalIndent(m, "", "  ")
	}
	// Geometry → wrap as Feature.
	if _, hasCoords := m["coordinates"]; hasCoords || m["type"] != nil {
		feat := map[string]any{
			"type":       "Feature",
			"properties": map[string]any{},
			"geometry":   m,
		}
		return json.MarshalIndent(feat, "", "  ")
	}
	return json.MarshalIndent(m, "", "  ")
}

func writeZipJSON(zw *zip.Writer, name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeZipBytes(zw, name, b)
}

func writeZipCSV(zw *zip.Writer, name string, rows [][]string) error {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.WriteAll(rows); err != nil {
		return err
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return err
	}
	return writeZipBytes(zw, name, buf.Bytes())
}

func writeZipBytes(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func writeZipFile(zw *zip.Writer, name, srcPath string) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, in)
	return err
}
