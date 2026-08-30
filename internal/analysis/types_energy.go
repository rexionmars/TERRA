package analysis

// Energy modelling: plant configuration, losses, generation and the exceedance tables.
//
// Split out of types.go, which had grown to 2,631 lines. The package is the
// unit in Go, so this moves nothing across a boundary -- it only lets a reader
// open the subject they are after.

// EnergyModelRequest selects an AOI for the photovoltaic energy model: the
// loss waterfall behind the performance ratio, the single-axis tracking
// comparison, the diurnal generation profile and the plant energy over the
// suitable area.
//
// "energy_model" is the sidecar action identifier, kept verbatim so the
// request, the payload key, the stored run and the exported manifest all name
// the same thing. It is not a claim about the method.
type EnergyModelRequest struct {
	PolygonGeoJSON   *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	ClimatologyYears int              `json:"climatology_years,omitempty"`
	HourlyYears      int              `json:"hourly_years,omitempty"`
	// 0 is north, the southern-hemisphere default.
	SurfaceAzimuth float64 `json:"surface_azimuth"`
	// Null applies the reference ratio; a value overrides it. The response
	// always reports which was used and what it was derived from.
	PerformanceRatio *float64 `json:"performance_ratio,omitempty"`
	// "year_one" or "lifetime_mean". Degradation is a basis for the whole
	// chain, not a loss row, so every energy figure carries the basis it was
	// computed on. Empty selects year_one.
	ReportingBasis         string   `json:"reporting_basis,omitempty"`
	DegradationRatePerYear *float64 `json:"degradation_rate_per_year,omitempty"`
	AnalysisPeriodYears    int      `json:"analysis_period_years,omitempty"`
	// Per-term overrides of the PVWatts v5 loss stack, keyed by the term name
	// the response reports. Maps rather than named fields so the set of terms
	// stays defined in one place, the sidecar. An empty map is dropped by the
	// Runner and leaves every term at its documented default; a key present
	// with value 0 is an explicit zero and is applied as one.
	DeclaredLossPct map[string]float64 `json:"declared_loss_pct,omitempty"`
	OptionalLossPct map[string]float64 `json:"optional_loss_pct,omitempty"`
	// Ground coverage ratios for the per-hectare comparison. Pointers because a
	// caller that leaves them unset must get the sidecar default rather than a
	// zero, and zero is not a usable coverage ratio.
	GCRFixed           *float64 `json:"gcr_fixed,omitempty"`
	GCRTracker         *float64 `json:"gcr_tracker,omitempty"`
	TrackerMaxAngleDeg *float64 `json:"tracker_max_angle_deg,omitempty"`
	// Key into the sidecar's capacity-density table; the response echoes the
	// resolved value, its area basis and its source.
	CapacityDensityBasis string   `json:"capacity_density_basis,omitempty"`
	BuildableFraction    *float64 `json:"buildable_fraction,omitempty"`
	// Local offset used to label the diurnal profile. Pointer because 0 means
	// UTC, which is a different statement from "not supplied".
	UTCOffsetHours *float64 `json:"utc_offset_hours,omitempty"`
	// Siting conventions, applied only when no classification is supplied.
	// Project conventions, not verified legal restrictions.
	SlopeAcceptableDeg  float64 `json:"slope_acceptable_deg,omitempty"`
	SlopeRestrictiveDeg float64 `json:"slope_restrictive_deg,omitempty"`
	ExcludedCover       []int   `json:"excluded_cover,omitempty"`
	CroplandCover       []int   `json:"cropland_cover,omitempty"`
	// GeoTIFF written by a previous siting run. Supplying it reuses that
	// classification instead of re-fetching the DEM and the land cover, and it
	// makes the capacity figure and the raster that published the area behind
	// it come from one classification rather than two.
	SitingRasterTIF string `json:"siting_raster_tif,omitempty"`
	// Horizon shading over the suitable pixels, from a terrain run. Applied
	// only when ShadingApplied is set, so an unshaded run says so.
	ShadingDerate  *float64 `json:"shading_derate,omitempty"`
	ShadingApplied bool     `json:"shading_applied,omitempty"`
	// Recorded with the saved run, matching the other analyses.
	Label     string `json:"label,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
}

// EnergyGeometry is the fixed-tilt optimum the energy model was computed on.
type EnergyGeometry struct {
	OptimalTiltDeg         float64 `json:"optimal_tilt_deg"`
	SurfaceAzimuthDeg      float64 `json:"surface_azimuth_deg"`
	POAKWhM2Year           float64 `json:"poa_kwh_m2_year"`
	POAHorizontalKWhM2Year float64 `json:"poa_horizontal_kwh_m2_year"`
	GHIHourlyKWhM2Year     float64 `json:"ghi_hourly_kwh_m2_year"`
}

// EnergyLossTerm is one declared loss in the PVWatts v5 stack this chain does
// not model, with the reference it is taken from.
type EnergyLossTerm struct {
	Key          string  `json:"key"`
	Label        string  `json:"label"`
	LossPct      float64 `json:"loss_pct"`
	Factor       float64 `json:"factor"`
	Kind         string  `json:"kind"`
	Source       string  `json:"source"`
	UserEditable bool    `json:"user_editable"`
}

// EnergyOptionalLossTerm is a loss defaulted to zero, with the non-zero value
// the reference suggests reported beside it rather than silently applied.
type EnergyOptionalLossTerm struct {
	Key                 string  `json:"key"`
	Label               string  `json:"label"`
	LossPct             float64 `json:"loss_pct"`
	Factor              float64 `json:"factor"`
	Kind                string  `json:"kind"`
	DefaultPct          float64 `json:"default_pct"`
	PVWattsSuggestedPct float64 `json:"pvwatts_suggested_pct"`
	Source              string  `json:"source"`
	UserEditable        bool    `json:"user_editable"`
}

// EnergyPRFactors are the three modelled factors and the energy at each plane.
// The product of the factors equals the modelled ratio; TelescopingResidual is
// that identity's residual and is the check that the chain closed.
type EnergyPRFactors struct {
	EnergyPOAKWhM2Year       float64 `json:"energy_poa_kwh_m2_year"`
	EnergyEffectiveKWhM2Year float64 `json:"energy_effective_kwh_m2_year"`
	EnergyDCKWhKWpYear       float64 `json:"energy_dc_kwh_kwp_year"`
	EnergyACKWhKWpYear       float64 `json:"energy_ac_kwh_kwp_year"`
	FIAM                     float64 `json:"f_iam"`
	FTemp                    float64 `json:"f_temp"`
	FInverter                float64 `json:"f_inverter"`
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
	TelescopingResidual      float64 `json:"telescoping_residual"`
	TempCellIrradianceWtdC   float64 `json:"temp_cell_irradiance_weighted_c"`
}

// EnergyPerformanceRatio is the resolved ratio and its provenance. Applied is
// the one every downstream figure was computed at; Modelled and Derived are
// reported beside it so a figure is never read without its basis.
type EnergyPerformanceRatio struct {
	Applied                            float64                  `json:"applied"`
	AppliedSource                      string                   `json:"applied_source"`
	Reference                          float64                  `json:"reference"`
	Modelled                           float64                  `json:"modelled"`
	Derived                            float64                  `json:"derived"`
	DerivedIfOptionalAtPVWattsDefaults float64                  `json:"derived_if_optional_at_pvwatts_defaults"`
	DeclaredLossFactor                 float64                  `json:"declared_loss_factor"`
	OptionalLossFactor                 float64                  `json:"optional_loss_factor"`
	Factors                            EnergyPRFactors          `json:"factors"`
	DeclaredLosses                     []EnergyLossTerm         `json:"declared_losses"`
	OptionalLosses                     []EnergyOptionalLossTerm `json:"optional_losses"`
	ReportingBasis                     string                   `json:"reporting_basis"`
	DegradationFactor                  float64                  `json:"degradation_factor"`
	DegradationRatePerYear             float64                  `json:"degradation_rate_per_year"`
	AnalysisPeriodYears                int                      `json:"analysis_period_years"`
	// Ratio implied by the Global Solar Atlas benchmark at this site, as a
	// two-element band. The only external validation the applied ratio has.
	GSAImpliedBand []float64 `json:"gsa_implied_band"`
}

// EnergyModuleType records which PVWatts v5 module type the temperature
// coefficient came from. It is a selection, not a measurement at this site.
type EnergyModuleType struct {
	GammaPDCPerC float64            `json:"gamma_pdc_per_c"`
	ModuleType   string             `json:"module_type"`
	Alternatives map[string]float64 `json:"alternatives"`
	Source       string             `json:"source"`
	UserEditable bool               `json:"user_editable"`
}

// EnergyWaterfallBase states which series the waterfall descends from. The
// hourly window is the base; the daily climatology is a different product over
// a different window and is carried as context only.
type EnergyWaterfallBase struct {
	GHIHourlyKWhM2Year      float64 `json:"ghi_hourly_kwh_m2_year"`
	HourlyWindow            string  `json:"hourly_window"`
	GHIClimatologyKWhM2Year float64 `json:"ghi_climatology_kwh_m2_year"`
	ClimatologyWindow       string  `json:"climatology_window"`
	Note                    string  `json:"note"`
}

// EnergyWaterfallStep is one row of the loss waterfall. Factor and
// CumulativeRatio are null on context rows, which are not multiplied in.
type EnergyWaterfallStep struct {
	Step               int      `json:"step"`
	Label              string   `json:"label"`
	Factor             *float64 `json:"factor"`
	EnergyAfter        float64  `json:"energy_after"`
	Units              string   `json:"units"`
	CumulativeRatio    *float64 `json:"cumulative_ratio"`
	Kind               string   `json:"kind"`
	InPerformanceRatio bool     `json:"in_performance_ratio"`
	Source             string   `json:"source"`
	Note               string   `json:"note"`
}

// EnergyWaterfallCheckpoint asserts an identity the waterfall must satisfy.
//
// Residual is what the identity failed to close by, and is a pointer because
// not every checkpoint is an identity: a plain float64 turns the absent
// residual of the derived-ratio row into 0.0, which reads as an identity that
// closed exactly. ExternalBand is the benchmark the checkpoint is read
// against, carried on the row so the value and its band cannot be separated.
type EnergyWaterfallCheckpoint struct {
	Name         string    `json:"name"`
	Value        float64   `json:"value"`
	Residual     *float64  `json:"residual"`
	Note         string    `json:"note"`
	ExternalBand []float64 `json:"external_band"`
}

// EnergyWaterfallPR is the ratio block repeated inside the waterfall so a
// waterfall read on its own still carries the ratio it descends to.
type EnergyWaterfallPR struct {
	Applied           float64 `json:"applied"`
	AppliedSource     string  `json:"applied_source"`
	Modelled          float64 `json:"modelled"`
	Derived           float64 `json:"derived"`
	ReportingBasis    string  `json:"reporting_basis"`
	DegradationFactor float64 `json:"degradation_factor"`
}

// EnergyDelivered is the specific yield at the applied ratio and at the derived
// ratio. Both are correct under their own assumption; the difference is the
// cost of choosing one, and is reported rather than resolved.
type EnergyDelivered struct {
	AppliedKWhKWpYear        float64 `json:"applied_kwh_kwp_year"`
	AppliedCapacityFactorPct float64 `json:"applied_capacity_factor_pct"`
	DerivedKWhKWpYear        float64 `json:"derived_kwh_kwp_year"`
	DerivedCapacityFactorPct float64 `json:"derived_capacity_factor_pct"`
	DifferencePct            float64 `json:"difference_pct"`
	ReportingBasis           string  `json:"reporting_basis"`
	Note                     string  `json:"note"`
}

// EnergyNumberSource and EnergyTextSource carry a value with the reference or
// convention it came from, so no constant reaches the screen unattributed.
type EnergyNumberSource struct {
	Value  float64 `json:"value"`
	Source string  `json:"source"`
}

type EnergyTextSource struct {
	Value  string `json:"value"`
	Source string `json:"source"`
}

// EnergyWaterfallAssumptions are the modelling choices behind the waterfall.
type EnergyWaterfallAssumptions struct {
	ModuleType           EnergyModuleType   `json:"module_type"`
	Albedo               EnergyNumberSource `json:"albedo"`
	TranspositionModel   EnergyTextSource   `json:"transposition_model"`
	WindSource           EnergyTextSource   `json:"wind_source"`
	FlatPlacementBiasPct EnergyNumberSource `json:"flat_placement_bias_pct"`
}

// EnergyLossWaterfall traces global horizontal irradiation down to delivered
// AC energy, marking which steps are inside the performance ratio.
type EnergyLossWaterfall struct {
	Base                    EnergyWaterfallBase         `json:"base"`
	Steps                   []EnergyWaterfallStep       `json:"steps"`
	Checkpoints             []EnergyWaterfallCheckpoint `json:"checkpoints"`
	OutsidePerformanceRatio []string                    `json:"outside_performance_ratio"`
	PerformanceRatio        EnergyWaterfallPR           `json:"performance_ratio"`
	Delivered               EnergyDelivered             `json:"delivered"`
	Assumptions             EnergyWaterfallAssumptions  `json:"assumptions"`
}

// EnergyTrackerConfiguration records the tracker geometry the comparison ran
// on, including that backtracking is always on and why.
type EnergyTrackerConfiguration struct {
	AxisTiltDeg           float64 `json:"axis_tilt_deg"`
	AxisAzimuthDeg        float64 `json:"axis_azimuth_deg"`
	AxisAzimuthConvention string  `json:"axis_azimuth_convention"`
	MaxAngleDeg           float64 `json:"max_angle_deg"`
	Backtrack             bool    `json:"backtrack"`
	Terrain               string  `json:"terrain"`
}

// EnergyFixedYield and EnergyTrackerYield are the two configurations compared
// per installed kWp.
type EnergyFixedYield struct {
	TiltDeg                  float64 `json:"tilt_deg"`
	AzimuthDeg               float64 `json:"azimuth_deg"`
	POAKWhM2Year             float64 `json:"poa_kwh_m2_year"`
	SpecificYieldKWhKWpYear  float64 `json:"specific_yield_kwh_kwp_year"`
	CapacityFactorPct        float64 `json:"capacity_factor_pct"`
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
}

type EnergyTrackerYield struct {
	GCR                      float64 `json:"gcr"`
	POAKWhM2Year             float64 `json:"poa_kwh_m2_year"`
	SpecificYieldKWhKWpYear  float64 `json:"specific_yield_kwh_kwp_year"`
	CapacityFactorPct        float64 `json:"capacity_factor_pct"`
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
}

// EnergyPerKWp is the tracking comparison on the installed-capacity basis.
// Inverts records whether the comparison changes sign on this basis.
type EnergyPerKWp struct {
	Fixed    EnergyFixedYield   `json:"fixed"`
	Tracking EnergyTrackerYield `json:"tracking"`
	GainPct  float64            `json:"gain_pct"`
	Inverts  bool               `json:"inverts"`
	Note     string             `json:"note"`
}

// EnergySeasonRow is one window of the seasonal tracking comparison. The annual
// gain is a summer gain, so the windows are reported apart.
type EnergySeasonRow struct {
	Season                string  `json:"season"`
	Months                []int   `json:"months"`
	FixedPOAKWhM2Season   float64 `json:"fixed_poa_kwh_m2_season"`
	TrackerPOAKWhM2Season float64 `json:"tracker_poa_kwh_m2_season"`
	GainPct               float64 `json:"gain_pct"`
}

type EnergySeasonal struct {
	Rows []EnergySeasonRow `json:"rows"`
	Note string            `json:"note"`
}

// EnergyBolingerDensity is the measured fleet energy density from Bolinger and
// Bolinger (2022), reported as published rather than re-derived.
type EnergyBolingerDensity struct {
	FixedGWhHaYear      float64 `json:"fixed_gwh_ha_year"`
	TrackingGWhHaYear   float64 `json:"tracking_gwh_ha_year"`
	FixedMWhAcreYear    float64 `json:"fixed_mwh_acre_year"`
	TrackingMWhAcreYear float64 `json:"tracking_mwh_acre_year"`
	ChangePct           float64 `json:"change_pct"`
	Source              string  `json:"source"`
	Note                string  `json:"note"`
}

// EnergyOngRow is one Ong et al. (2013) Table 5 site near this site's DNI.
type EnergyOngRow struct {
	Site             string  `json:"site"`
	DNIKWhM2Year     int     `json:"dni_kwh_m2_year"`
	LandUseChangePct float64 `json:"land_use_change_pct"`
}

type EnergyOngTable5 struct {
	SiteDNIKWhM2Year float64        `json:"site_dni_kwh_m2_year"`
	NearestRows      []EnergyOngRow `json:"nearest_rows"`
	BandPct          []float64      `json:"band_pct"`
	Source           string         `json:"source"`
	Note             string         `json:"note"`
}

// EnergyPublishedLandUse carries both published per-hectare measurements. They
// disagree on the sign, which is stated rather than averaged away.
type EnergyPublishedLandUse struct {
	Bolinger2022 EnergyBolingerDensity `json:"bolinger_2022"`
	OngTable5    EnergyOngTable5       `json:"ong_2013_table5"`
	Disagreement string                `json:"disagreement"`
}

// EnergyParityGCR is the tracker ground coverage ratio at which the per-hectare
// comparison changes sign.
type EnergyParityGCR struct {
	GCRTracker  float64   `json:"gcr_tracker"`
	GCRRatio    float64   `json:"gcr_ratio"`
	SearchRange []float64 `json:"search_range"`
	Note        string    `json:"note"`
}

// EnergyModelDerivedLandUse is the third line: this site's own yields combined
// with the two ground coverage ratios. Reported after the published
// measurements, not instead of them.
type EnergyModelDerivedLandUse struct {
	EnergyPerHectareRatio float64         `json:"energy_per_hectare_ratio"`
	ChangePct             float64         `json:"change_pct"`
	GCRFixed              float64         `json:"gcr_fixed"`
	GCRTracker            float64         `json:"gcr_tracker"`
	GCRRatio              float64         `json:"gcr_ratio"`
	Basis                 string          `json:"basis"`
	Note                  string          `json:"note"`
	Parity                EnergyParityGCR `json:"parity"`
}

// EnergyPerHectare is the tracking comparison on the land basis, which is the
// basis that inverts.
type EnergyPerHectare struct {
	PublishedMeasurements EnergyPublishedLandUse    `json:"published_measurements"`
	ModelDerived          EnergyModelDerivedLandUse `json:"model_derived"`
	Inverts               bool                      `json:"inverts"`
	Note                  string                    `json:"note"`
}

// EnergyPRTransfer is the modelled ratio of each configuration under one wind
// assumption. The applied ratio was calibrated on a fixed-tilt benchmark, so
// the transfer to a tracker is measured across the wind assumption, not once.
type EnergyPRTransfer struct {
	Wind                    string  `json:"wind"`
	PerformanceRatioFixed   float64 `json:"performance_ratio_fixed"`
	PerformanceRatioTracker float64 `json:"performance_ratio_tracker"`
	DifferencePct           float64 `json:"difference_pct"`
}

type EnergyTrackingPR struct {
	Applied                       float64            `json:"applied"`
	AppliedSource                 string             `json:"applied_source"`
	ReportingBasis                string             `json:"reporting_basis"`
	TransferBetweenConfigurations []EnergyPRTransfer `json:"transfer_between_configurations"`
	TransferRangePct              []float64          `json:"transfer_range_pct"`
	Note                          string             `json:"note"`
}

// EnergyTracking compares single-axis tracking against the fixed-tilt optimum
// on two bases that answer different questions and can disagree in sign.
type EnergyTracking struct {
	Configuration    EnergyTrackerConfiguration `json:"configuration"`
	PerKWp           EnergyPerKWp               `json:"per_kwp"`
	Seasonal         EnergySeasonal             `json:"seasonal"`
	PerHectare       EnergyPerHectare           `json:"per_hectare"`
	PerformanceRatio EnergyTrackingPR           `json:"performance_ratio"`
	Excluded         string                     `json:"excluded"`
}

// EnergyTimeStandard labels the diurnal profile. UTCOffsetHours is null when
// no offset was supplied, in which case the hours are UTC.
type EnergyTimeStandard struct {
	SourceStandard string   `json:"source_standard"`
	HourLabel      string   `json:"hour_label"`
	UTCOffsetHours *float64 `json:"utc_offset_hours"`
	Note           string   `json:"note"`
}

// EnergyProfileMonthRow is one month of the 12 by 24 mean AC power matrix.
type EnergyProfileMonthRow struct {
	Month      int       `json:"month"`
	MeanACWKWp []float64 `json:"mean_ac_w_kwp"`
}

type EnergyProfileMatrix struct {
	Units string                  `json:"units"`
	Rows  []EnergyProfileMonthRow `json:"rows"`
}

type EnergyMonthlyProfileRow struct {
	Month           int     `json:"month"`
	PeakSunHoursDay float64 `json:"peak_sun_hours_day"`
	POAKWhM2Month   float64 `json:"poa_kwh_m2_month"`
	ACKWhKWpMonth   float64 `json:"ac_kwh_kwp_month"`
}

type EnergyMonthlyProfile struct {
	Units map[string]string         `json:"units"`
	Rows  []EnergyMonthlyProfileRow `json:"rows"`
	Note  string                    `json:"note"`
}

type EnergyHourlyShareRow struct {
	Hour     int     `json:"hour"`
	SharePct float64 `json:"share_pct"`
}

type EnergyHourlyShare struct {
	Units string                 `json:"units"`
	Rows  []EnergyHourlyShareRow `json:"rows"`
}

// EnergyGenerationProfile is the shape of generation through the day and the
// year, computed before any performance ratio is applied.
type EnergyGenerationProfile struct {
	TimeStandard              EnergyTimeStandard   `json:"time_standard"`
	MeanACPowerByMonthAndHour EnergyProfileMatrix  `json:"mean_ac_power_by_month_and_hour"`
	Monthly                   EnergyMonthlyProfile `json:"monthly"`
	ShareOfAnnualByHour       EnergyHourlyShare    `json:"share_of_annual_generation_by_hour"`
	Note                      string               `json:"note"`
}

// EnergyCapacityDensity is the resolved installed capacity per hectare with the
// area basis it is measured on. The basis moves the answer further than the
// exceedance band does, so it is never reported without it.
type EnergyCapacityDensity struct {
	Basis             string  `json:"basis"`
	ValueMWPerHa      float64 `json:"value_mw_per_ha"`
	Units             string  `json:"units"`
	ValueMWDCPerHa    float64 `json:"value_mw_dc_per_ha"`
	AreaBasis         string  `json:"area_basis"`
	Mounting          string  `json:"mounting"`
	Source            string  `json:"source"`
	AcreConversion    string  `json:"acre_conversion"`
	BuildableFraction float64 `json:"buildable_fraction"`
	// Separately sourced from the model-internal inverter oversizing factor:
	// the two are unrelated quantities and must not be substituted.
	FleetDCACRatio          float64 `json:"fleet_dc_ac_ratio"`
	ACToDCConversionApplied bool    `json:"ac_to_dc_conversion_applied"`
	Note                    string  `json:"note"`
}

// EnergyContiguity reports whether an area is one block or several. A capacity
// computed from a total area assumes it is buildable as one plant.
type EnergyContiguity struct {
	LargestHa    float64 `json:"largest_ha"`
	NPatches     int     `json:"n_patches"`
	Connectivity int     `json:"connectivity"`
	Note         string  `json:"note"`
}

// EnergyExceedanceEnergy is the annual energy at three exceedance levels. P90
// is the value exceeded in 90 percent of years and is therefore below P50.
type EnergyExceedanceEnergy struct {
	P50GWhYear float64 `json:"p50_exceedance_gwh_year"`
	P75GWhYear float64 `json:"p75_exceedance_gwh_year"`
	P90GWhYear float64 `json:"p90_exceedance_gwh_year"`
}

// EnergyPlantClass is one siting class costed out. The classes are reported
// apart and are never summed: cropland conflict is the same land counted
// against its current use, not additional capacity.
type EnergyPlantClass struct {
	Label                   string                 `json:"label"`
	AreaHa                  float64                `json:"area_ha"`
	CapacityDCMW            float64                `json:"capacity_dc_mw"`
	CapacityACMW            float64                `json:"capacity_ac_mw"`
	SpecificYieldKWhKWpYear float64                `json:"specific_yield_kwh_kwp_year"`
	Energy                  EnergyExceedanceEnergy `json:"energy"`
	ReportingBasis          string                 `json:"reporting_basis"`
	PerformanceRatio        float64                `json:"performance_ratio"`
	PerformanceRatioSource  string                 `json:"performance_ratio_source"`
	Note                    string                 `json:"note"`
	Contiguity              EnergyContiguity       `json:"contiguity"`
}

// EnergyRestrictiveClass is area only. CapacityDCMW is null because siting on
// slopes near the limit needs non-standard racking this density does not cover.
type EnergyRestrictiveClass struct {
	Label        string   `json:"label"`
	AreaHa       float64  `json:"area_ha"`
	CapacityDCMW *float64 `json:"capacity_dc_mw"`
	Note         string   `json:"note"`
}

type EnergyShading struct {
	Derate  float64 `json:"derate"`
	Applied bool    `json:"applied"`
	Note    string  `json:"note"`
}

// EnergyExceedanceLevel is one exceedance level of annual irradiation, computed
// both empirically and from a normal fit so the two can be compared.
type EnergyExceedanceLevel struct {
	Level                       int     `json:"level"`
	GHIEmpiricalKWhM2Year       float64 `json:"ghi_empirical_kwh_m2_year"`
	FactorEmpirical             float64 `json:"factor_empirical"`
	GHINormalKWhM2Year          float64 `json:"ghi_normal_kwh_m2_year"`
	FactorNormal                float64 `json:"factor_normal"`
	NormalFitStandardErrorKWhM2 float64 `json:"normal_fit_standard_error_kwh_m2"`
}

// EnergyNormality is the test behind using a normal fit at all, reported rather
// than assumed.
type EnergyNormality struct {
	Test      string  `json:"test"`
	Statistic float64 `json:"statistic"`
	PValue    float64 `json:"p_value"`
}

// EnergyExceedanceCrosswalk states that the exceedance P90 and the statistical
// 10th percentile are the same number under two conventions.
type EnergyExceedanceCrosswalk struct {
	ExceedanceP90KWhM2Year  float64 `json:"exceedance_p90_kwh_m2_year"`
	StatisticalP10KWhM2Year float64 `json:"statistical_p10_kwh_m2_year"`
	ExceedanceP10KWhM2Year  float64 `json:"exceedance_p10_kwh_m2_year"`
	StatisticalP90KWhM2Year float64 `json:"statistical_p90_kwh_m2_year"`
	Note                    string  `json:"note"`
}

type EnergyExceedance struct {
	MethodApplied       string                    `json:"method_applied"`
	Convention          string                    `json:"convention"`
	ConventionNote      string                    `json:"convention_note"`
	NYears              int                       `json:"n_years"`
	MeanKWhM2Year       float64                   `json:"mean_kwh_m2_year"`
	StdKWhM2Year        float64                   `json:"std_kwh_m2_year"`
	CVPct               float64                   `json:"cv_pct"`
	Levels              []EnergyExceedanceLevel   `json:"levels"`
	Normality           EnergyNormality           `json:"normality"`
	Crosswalk           EnergyExceedanceCrosswalk `json:"crosswalk"`
	LinearityAssumption string                    `json:"linearity_assumption"`
}

// EnergyUncertainty states what the exceedance band does and does not cover.
type EnergyUncertainty struct {
	Included     []string `json:"included"`
	Excluded     []string `json:"excluded"`
	Statement    string   `json:"statement"`
	DominantTerm string   `json:"dominant_term"`
}

// EnergyDensityCrossCheck compares this site's energy per hectare against the
// published fleet median, on the direct array basis whatever basis the headline
// figure uses.
type EnergyDensityCrossCheck struct {
	SiteMWhHaYear      float64 `json:"site_mwh_ha_year"`
	ReferenceMWhHaYear float64 `json:"reference_mwh_ha_year"`
	Ratio              float64 `json:"ratio"`
	AreaBasis          string  `json:"area_basis"`
	Source             string  `json:"source"`
	Note               string  `json:"note"`
}

// EnergyPlant is the resource and land ceiling over the suitable area. Not an
// interconnectable or permitted capacity.
type EnergyPlant struct {
	Suitable                EnergyPlantClass        `json:"suitable"`
	CroplandConflict        EnergyPlantClass        `json:"cropland_conflict"`
	Restrictive             EnergyRestrictiveClass  `json:"restrictive"`
	AreasNote               string                  `json:"areas_note"`
	CapacityDensity         EnergyCapacityDensity   `json:"capacity_density"`
	Shading                 EnergyShading           `json:"shading"`
	Exceedance              EnergyExceedance        `json:"exceedance"`
	Uncertainty             EnergyUncertainty       `json:"uncertainty"`
	EnergyDensityCrossCheck EnergyDensityCrossCheck `json:"energy_density_cross_check"`
	ReportingBasis          string                  `json:"reporting_basis"`
	Limitations             string                  `json:"limitations"`
	// Same shape as the siting product's thresholds. When the caller supplied a
	// classification, only Note is filled and it says the limits are unrecorded.
	Thresholds SolarSitingThresholds `json:"thresholds"`
}

// EnergyAssumptions repeats the load-bearing assumptions at the top level, so a
// reader who sees only one figure still sees what produced it.
type EnergyAssumptions struct {
	PerformanceRatioApplied  float64 `json:"performance_ratio_applied"`
	PerformanceRatioSource   string  `json:"performance_ratio_source"`
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
	PerformanceRatioDerived  float64 `json:"performance_ratio_derived"`
	ReportingBasis           string  `json:"reporting_basis"`
	DegradationFactor        float64 `json:"degradation_factor"`
	DegradationRatePerYear   float64 `json:"degradation_rate_per_year"`
	AnalysisPeriodYears      int     `json:"analysis_period_years"`
	ModuleType               string  `json:"module_type"`
	TranspositionModel       string  `json:"transposition_model"`
	Albedo                   float64 `json:"albedo"`
	GCRFixed                 float64 `json:"gcr_fixed"`
	GCRTracker               float64 `json:"gcr_tracker"`
	CapacityDensityBasis     string  `json:"capacity_density_basis"`
	CapacityDensityMWDCPerHa float64 `json:"capacity_density_mw_dc_per_ha"`
	ShadingApplied           bool    `json:"shading_applied"`
	ShadingDerate            float64 `json:"shading_derate"`
	Note                     string  `json:"note"`
}

// EnergyModelAnalysis is the photovoltaic energy model at the AOI. It shares
// the radiation chain with SolarAnalysis and reports the same optimum, so the
// two products cannot disagree about one AOI.
type EnergyModelAnalysis struct {
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
	RunID             string  `json:"run_id,omitempty"`
	Lon               float64 `json:"lon"`
	Lat               float64 `json:"lat"`
	HourlyYears       int     `json:"hourly_years"`
	ClimatologyYears  int     `json:"climatology_years"`
	HourlyWindow      string  `json:"hourly_window"`
	ClimatologyWindow string  `json:"climatology_window"`

	Geometry          EnergyGeometry          `json:"geometry"`
	PerformanceRatio  EnergyPerformanceRatio  `json:"performance_ratio"`
	ModuleType        EnergyModuleType        `json:"module_type"`
	LossWaterfall     EnergyLossWaterfall     `json:"loss_waterfall"`
	Tracking          EnergyTracking          `json:"tracking"`
	GenerationProfile EnergyGenerationProfile `json:"generation_profile"`
	CapacityDensity   EnergyCapacityDensity   `json:"capacity_density"`
	Plant             EnergyPlant             `json:"plant"`
	ReportingBasis    string                  `json:"reporting_basis"`
	// States the grid the figures resolve on. Required in every response: a
	// per-AOI number shown without it reads as local.
	GridNote    string            `json:"grid_note"`
	Assumptions EnergyAssumptions `json:"assumptions"`
	// Whether the series behind these figures was fetched or read from cache.
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
}

// NDates reports the years of hourly record behind the model, so a saved run
// states its basis the way the other kinds do.
func (e *EnergyModelAnalysis) NDates() int { return e.HourlyYears }
