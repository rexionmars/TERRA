package analysis

// Wind screening: the measured record, the hub extrapolation and the turbine.
//
// Split out of types.go, which had grown to 2,631 lines. The package is the
// unit in Go, so this moves nothing across a boundary -- it only lets a reader
// open the subject they are after.

// WindRequest selects an AOI for wind resource screening. The reanalysis cell
// is 0.5 by 0.625 degrees, so the request resolves to the cell the AOI centroid
// falls in and the response reports that cell centre, not the centroid.
type WindRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	RecordYears    int              `json:"record_years,omitempty"`
	// Project convention, user-editable. No turbine has been selected for any
	// site, so this is the reference turbine's hub height and nothing more.
	HubHeightM       *float64 `json:"hub_height_m,omitempty"`
	CalmThresholdMS  *float64 `json:"calm_threshold_ms,omitempty"`
	RecordMaxFloorMS *float64 `json:"record_max_floor_ms,omitempty"`
	// Two roughness lengths in metres, the assumed land-cover band the derived
	// shear exponent is checked against.
	RoughnessBandM []float64 `json:"roughness_band_m,omitempty"`
	Label          string    `json:"label,omitempty"`
	RunLabel       string    `json:"run_label,omitempty"`
	ProjectID      string    `json:"project_id,omitempty"`
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
}

// WindWeibullFitCheck compares the fitted distribution against the record it
// was fitted to, on the mean and on the mean cube. The mean cube is what the
// power calculation depends on, so it is checked separately.
type WindWeibullFitCheck struct {
	EmpiricalMeanMS       float64 `json:"empirical_mean_ms"`
	WeibullMeanMS         float64 `json:"weibull_mean_ms"`
	MeanErrorPct          float64 `json:"mean_error_pct"`
	EmpiricalMeanCubeM3S3 float64 `json:"empirical_mean_cube_m3s3"`
	WeibullMeanCubeM3S3   float64 `json:"weibull_mean_cube_m3s3"`
	MeanCubeErrorPct      float64 `json:"mean_cube_error_pct"`
	Estimator             string  `json:"estimator"`
}

// WindMonthlySpeed is one calendar month of the 50 m mean speed.
type WindMonthlySpeed struct {
	Month       int     `json:"month"`
	MeanSpeedMS float64 `json:"mean_speed_ms"`
}

// WindDirection reports the circular means. The convention is the direction the
// wind comes from, stated because the opposite convention is also in use.
type WindDirection struct {
	ConventionNote     string  `json:"convention_note"`
	CircularMeanDeg10m float64 `json:"circular_mean_deg_10m"`
	CircularMeanDeg50m float64 `json:"circular_mean_deg_50m"`
	MedianTurningDeg   float64 `json:"median_turning_deg"`
}

// WindRoseSector is one of the sixteen sectors of the energy rose. EnergyPct
// and HoursPct differ because energy goes as the cube of the speed.
type WindRoseSector struct {
	Sector    int     `json:"sector"`
	CentreDeg float64 `json:"centre_deg"`
	EnergyPct float64 `json:"energy_pct"`
	HoursPct  float64 `json:"hours_pct"`
}

// WindMeasured are the quantities the reanalysis carries directly at 10 m and
// 50 m. They involve no extrapolation.
type WindMeasured struct {
	Qualifier              string              `json:"qualifier"`
	MeanSpeed10mMS         float64             `json:"mean_speed_10m_ms"`
	MeanSpeed50mMS         float64             `json:"mean_speed_50m_ms"`
	ShearExponent          float64             `json:"shear_exponent"`
	WeibullK50m            float64             `json:"weibull_k_50m"`
	WeibullC50mMS          float64             `json:"weibull_c_50m_ms"`
	WeibullFitCheck50m     WindWeibullFitCheck `json:"weibull_fit_check_50m"`
	EnergyPatternFactor50m float64             `json:"energy_pattern_factor_50m"`
	WindPowerDensity50mWM2 float64             `json:"wind_power_density_50m_w_m2"`
	AirDensityMeanKgM3     float64             `json:"air_density_mean_kg_m3"`
	AirDensityMinKgM3      float64             `json:"air_density_min_kg_m3"`
	AirDensityMaxKgM3      float64             `json:"air_density_max_kg_m3"`
	MonthlyMeanSpeed50m    []WindMonthlySpeed  `json:"monthly_mean_speed_50m"`
	Direction              WindDirection       `json:"direction"`
	DirectionEnergyRose50m []WindRoseSector    `json:"direction_energy_rose_50m"`
}

// WindExtrapolation states how far above the highest measured level the hub
// figures sit. The reanalysis carries 10 m and 50 m; anything above 50 m is a
// power-law extrapolation.
type WindExtrapolation struct {
	HubHeightM            float64 `json:"hub_height_m"`
	InterpolationCeilingM float64 `json:"interpolation_ceiling_m"`
	HeightRatio           float64 `json:"height_ratio"`
	IsExtrapolation       bool    `json:"is_extrapolation"`
	Statement             string  `json:"statement"`
}

// WindOperatingRegime is the share of hours in each part of the power curve.
type WindOperatingRegime struct {
	AboveCutInPct     float64 `json:"above_cut_in_pct"`
	AtOrAboveRatedPct float64 `json:"at_or_above_rated_pct"`
	AboveCutOutPct    float64 `json:"above_cut_out_pct"`
	CutInMS           float64 `json:"cut_in_ms"`
	RatedMS           float64 `json:"rated_ms"`
	CutOutMS          float64 `json:"cut_out_ms"`
}

// WindHub is the hub-height result. Gross: no wake, availability, electrical,
// icing or curtailment loss is applied, and there is no external validation.
type WindHub struct {
	Qualifier                                 string              `json:"qualifier"`
	Extrapolation                             WindExtrapolation   `json:"extrapolation"`
	MeanSpeedMS                               float64             `json:"mean_speed_ms"`
	WeibullK                                  float64             `json:"weibull_k"`
	WeibullCMS                                float64             `json:"weibull_c_ms"`
	WindPowerDensityWM2                       float64             `json:"wind_power_density_w_m2"`
	GrossCapacityFactorPct                    float64             `json:"gross_capacity_factor_pct"`
	GrossCapacityFactorNoDensityCorrectionPct float64             `json:"gross_capacity_factor_no_density_correction_pct"`
	GrossAnnualEnergyMWhPerTurbine            float64             `json:"gross_annual_energy_mwh_per_turbine"`
	OperatingRegime                           WindOperatingRegime `json:"operating_regime"`
	HoursPerYear                              float64             `json:"hours_per_year"`
	ExcludedLosses                            []string            `json:"excluded_losses"`
}

// WindShearRow is the hub result under one shear assumption. RoughnessLengthM
// is null on the row derived from the record itself, which inverts to a
// roughness rather than assuming one.
type WindShearRow struct {
	ShearExponent     float64  `json:"shear_exponent"`
	RoughnessLengthM  *float64 `json:"roughness_length_m"`
	Basis             string   `json:"basis"`
	HubSpeedMS        float64  `json:"hub_speed_ms"`
	CapacityFactorPct float64  `json:"capacity_factor_pct"`
	AnnualEnergyMWh   float64  `json:"annual_energy_mwh"`
}

// WindShearDiagnostics inverts the derived shear exponent to a roughness length
// and checks it against the assumed land cover. A disagreement here is the
// strongest single reason not to read the hub figures as a measurement.
type WindShearDiagnostics struct {
	ShearExponent float64 `json:"shear_exponent"`
	// A pointer because the inversion has no answer for every exponent: the
	// sidecar returns null when the shear falls outside the range the log
	// profile can invert. Decoded into a bare float64 that null became zero,
	// and the panel printed a roughness of 0.000 m that does not exist.
	ImpliedRoughnessLengthM    *float64  `json:"implied_roughness_length_m"`
	AssumedRoughnessBandM      []float64 `json:"assumed_roughness_band_m"`
	ExpectedShearExponentBand  []float64 `json:"expected_shear_exponent_band"`
	ConsistentWithAssumedCover bool      `json:"consistent_with_assumed_cover"`
	ShearExponentHourlyMean    float64   `json:"shear_exponent_hourly_mean"`
	ShearExponentHourlyMedian  float64   `json:"shear_exponent_hourly_median"`
	ShearExponentDay           float64   `json:"shear_exponent_day"`
	ShearExponentNight         float64   `json:"shear_exponent_night"`
	LocalUTCOffsetHours        int       `json:"local_utc_offset_hours"`
}

// WindDataQuality is the record's own account of itself. AllChecksPassed false
// with a populated Flags list is the signal that the hub figures rest on a
// series the checks do not support.
type WindDataQuality struct {
	RecordHours            int                  `json:"record_hours"`
	ExpectedHours          int                  `json:"expected_hours"`
	MeanSpeedMS            map[string]float64   `json:"mean_speed_ms"`
	CalmFractionPct        map[string]float64   `json:"calm_fraction_pct"`
	CalmThresholdMS        float64              `json:"calm_threshold_ms"`
	RecordMaximumMS        map[string]float64   `json:"record_maximum_ms"`
	RecordMaximumFloorMS   float64              `json:"record_maximum_floor_ms"`
	RecordMaximumPlausible bool                 `json:"record_maximum_plausible"`
	CalmFraction2mFlagPct  float64              `json:"calm_fraction_2m_flag_pct"`
	NaNCount               map[string]int       `json:"nan_count"`
	Shear                  WindShearDiagnostics `json:"shear"`
	Flags                  []string             `json:"flags"`
	AllChecksPassed        bool                 `json:"all_checks_passed"`
}

// WindTurbine is the reference power curve the capacity factor was computed on.
// A reference turbine, not a selection for this site.
type WindTurbine struct {
	Name              string  `json:"name"`
	RatedPowerW       float64 `json:"rated_power_w"`
	RotorDiameterM    float64 `json:"rotor_diameter_m"`
	HubHeightM        float64 `json:"hub_height_m"`
	Blades            int     `json:"blades"`
	IECClass          string  `json:"iec_class"`
	TurbulenceClass   string  `json:"turbulence_class"`
	CutInMS           float64 `json:"cut_in_ms"`
	RatedSpeedMS      float64 `json:"rated_speed_ms"`
	CutOutMS          float64 `json:"cut_out_ms"`
	PowerCurvePoints  int     `json:"power_curve_points"`
	PowerCurveColumn  string  `json:"power_curve_column"`
	Citation          string  `json:"citation"`
	CitationURL       string  `json:"citation_url"`
	CurveSourceURL    string  `json:"curve_source_url"`
	CurveSourceCommit string  `json:"curve_source_commit"`
}

// WindAssumptions repeats the conventions the figures rest on, including the
// statement that the wind capacity factor is not comparable with the
// photovoltaic one.
type WindAssumptions struct {
	HubHeightM          float64   `json:"hub_height_m"`
	HubHeightSource     string    `json:"hub_height_source"`
	RecordYears         int       `json:"record_years"`
	RecordWindow        string    `json:"record_window"`
	ShearExponent       float64   `json:"shear_exponent"`
	ShearExponentSource string    `json:"shear_exponent_source"`
	RoughnessBandM      []float64 `json:"roughness_band_m"`
	CalmThresholdMS     float64   `json:"calm_threshold_ms"`
	RecordMaxFloorMS    float64   `json:"record_max_floor_ms"`
	Qualifier           string    `json:"qualifier"`
	ExcludedLosses      []string  `json:"excluded_losses"`
	ComparisonNote      string    `json:"comparison_note"`
}

// WindAnalysis is a wind resource screening at the AOI, from reanalysis hourly
// wind. It is a screening indication and not a resource assessment: the hub
// figures are gross, carry no external validation, and rest on an
// extrapolation above the highest level the data carries.
type WindAnalysis struct {
	// The row this run was recorded as, or empty where it was not recorded.
	//
	// saveRun withdraws its claim to have saved by returning nothing, and
	// until this field existed the withdrawal had nowhere to go: the frontend
	// read every one of these runs as unrecorded, and the studio's live area
	// reported the sentinel "current" for it. Same field and same meaning as
	// WaterAnalysis.RunID, which states it at length.
	//
	// A line comment and not a block: frontend/scripts/check-types.ts parses
	// these structs and refuses a "/*" it cannot read a JSON name from,
	// rather than skipping the field in silence.
	RunID string  `json:"run_id,omitempty"`
	Lon   float64 `json:"lon"`
	Lat   float64 `json:"lat"`
	// Centre of the reanalysis cell the AOI resolves to, [lon, lat].
	GridCellCentre []float64 `json:"grid_cell_centre"`
	GridNote       string    `json:"grid_note"`
	RecordYears    float64   `json:"record_years"`
	RecordWindow   string    `json:"record_window"`
	HubHeightM     float64   `json:"hub_height_m"`
	Qualifier      string    `json:"qualifier"`

	Measured         WindMeasured    `json:"measured"`
	Hub              WindHub         `json:"hub"`
	ShearSensitivity []WindShearRow  `json:"shear_sensitivity"`
	DataQuality      WindDataQuality `json:"data_quality"`
	Turbine          WindTurbine     `json:"turbine"`
	Assumptions      WindAssumptions `json:"assumptions"`
	// Whether the series behind these figures was fetched or read from cache.
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
}

// NDates reports the whole years of hourly record behind the screening, so a
// saved wind run states its basis the way the other kinds do.
func (w *WindAnalysis) NDates() int { return int(w.RecordYears) }
