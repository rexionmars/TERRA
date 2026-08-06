package backend

// Area is an embedded study-area polygon shown in the area selector.
type Area struct {
	ID          string          `json:"id"`
	Label       string          `json:"label"`
	KMLName     string          `json:"kml_name"`
	Approximate bool            `json:"approximate"`
	Centroid    []float64       `json:"centroid"`
	Bounds      Bounds          `json:"bounds"`
	MapBiomas   string          `json:"mapbiomas"`
	Geometry    GeoJSONGeometry `json:"geometry"`
}

// Bounds is the lon/lat bounding box of an area or raster.
type Bounds struct {
	LonMin float64 `json:"lon_min"`
	LatMin float64 `json:"lat_min"`
	LonMax float64 `json:"lon_max"`
	LatMax float64 `json:"lat_max"`
}

// GeoJSONGeometry is a minimal GeoJSON geometry (Polygon) passed to the sidecar.
type GeoJSONGeometry struct {
	Type        string        `json:"type"`
	Coordinates [][][]float64 `json:"coordinates"`
}

// PredictRequest is the request issued from the frontend. Imagery is fetched
// on demand from the Sentinel-2 STAC catalog (cloud COGs); no local download.
type PredictRequest struct {
	// AreaID selects an embedded area (A/B/C). Mutually exclusive with PolygonGeoJSON.
	AreaID string `json:"area_id"`
	// PolygonGeoJSON is an explicit geometry (used when AreaID is empty).
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	// Start and End bound the acquisition window (YYYY-MM-DD).
	Start string `json:"start"`
	End   string `json:"end"`
	// MaxCloud is the maximum eo:cloud_cover percentage accepted (0-100).
	MaxCloud float64 `json:"max_cloud"`
	// MonthlyBest keeps only the lowest-cloud scene per month (approx. 1/month).
	MonthlyBest bool `json:"monthly_best"`
	// Tiles is an optional Sentinel-2 MGRS tile filter.
	Tiles []string `json:"tiles"`
	// Mode is "single" (full stack) or "temporal" (cumulative retention).
	Mode string `json:"mode"`
	// ModelKind is "spectral", "prithvi", or "temporal_transformer".
	ModelKind string `json:"model_kind"`
	// PrithviMode is "pixel" or "patch" (used when ModelKind is "prithvi").
	PrithviMode string `json:"prithvi_mode"`
	// ProjectID optionally attaches the saved run to a project.
	ProjectID string `json:"project_id,omitempty"`
	// Label is the AOI display name (project / map), not the run title.
	Label string `json:"label,omitempty"`
	// RunLabel is the inference run title (should be run-…). Generated if empty.
	RunLabel string `json:"run_label,omitempty"`
}

// sidecarRequest is the JSON contract written to the Python sidecar stdin.
type sidecarRequest struct {
	Action         string           `json:"action,omitempty"`
	ModelDir       string           `json:"model_dir"`
	Source         string           `json:"source"`
	Start          string           `json:"start,omitempty"`
	End            string           `json:"end,omitempty"`
	MaxCloud       float64          `json:"max_cloud"`
	MonthlyBest    bool             `json:"monthly_best"`
	Tiles          []string         `json:"tiles"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	MapBiomasPath  string           `json:"mapbiomas_path,omitempty"`
	Mode           string           `json:"mode"`
	ModelKind      string           `json:"model_kind"`
	PrithviMode    string           `json:"prithvi_mode"`
	WorkDir        string           `json:"work_dir"`
	// Composite / index render (action=render_composite).
	SceneID    string    `json:"scene_id,omitempty"`
	Kind       string    `json:"kind,omitempty"`
	Bands      []string  `json:"bands,omitempty"`
	Index      string    `json:"index,omitempty"`
	StretchPct []float64 `json:"stretch_pct,omitempty"`
}

// ClassStat is a per-class statistic from the classification result.
type ClassStat struct {
	ClassID int     `json:"class_id"`
	Name    string  `json:"name"`
	Color   string  `json:"color"`
	Pixels  int     `json:"pixels"`
	Pct     float64 `json:"pct"`
	AreaHa  float64 `json:"area_ha"`
}

// TemporalPoint is one cumulative-stack step from temporal mode.
type TemporalPoint struct {
	Date             string   `json:"date"`
	NDatesStack      int      `json:"n_dates_stack"`
	SojaNDVIMean     *float64 `json:"soja_ndvi_mean"`
	SojaRetentionPct *float64 `json:"soja_retention_pct"`
	Dominant         *string  `json:"dominant"`
}

// VISeriesPoint is AOI mean ± std vegetation indices for one acquisition date.
type VISeriesPoint struct {
	Date     string  `json:"date"`
	NDVIMean float64 `json:"ndvi_mean"`
	NDVIStd  float64 `json:"ndvi_std"`
	EVIMean  float64 `json:"evi_mean"`
	EVIStd   float64 `json:"evi_std"`
	SAVIMean float64 `json:"savi_mean"`
	SAVIStd  float64 `json:"savi_std"`
}

// PhenologyMetrics are SOS/POS/EOS style metrics on the AOI NDVI curve.
type PhenologyMetrics struct {
	SOSDOY    *float64 `json:"sos_doy"`
	POSDOY    *float64 `json:"pos_doy"`
	EOSDOY    *float64 `json:"eos_doy"`
	LOSDays   *float64 `json:"los_days"`
	Peak      *float64 `json:"peak"`
	Base      *float64 `json:"base"`
	Amplitude *float64 `json:"amplitude"`
}

// PhenologyStatePoint is the discrete phenological state at one date.
type PhenologyStatePoint struct {
	Date      string   `json:"date"`
	State     int      `json:"state"`
	StateName string   `json:"state_name"`
	Color     string   `json:"color"`
	NDVIMean  *float64 `json:"ndvi_mean"`
}

// LULCClassRow is one MapBiomas class in the descriptive composition.
type LULCClassRow struct {
	ClassID int     `json:"class_id"`
	Name    string  `json:"name"`
	Color   string  `json:"color"`
	Group   string  `json:"group"`
	Pixels  int     `json:"pixels"`
	Pct     float64 `json:"pct"`
	AreaHa  float64 `json:"area_ha"`
}

// LULCGroupRow aggregates classes into land-use groups.
type LULCGroupRow struct {
	Group  string  `json:"group"`
	Color  string  `json:"color"`
	Pct    float64 `json:"pct"`
	AreaHa float64 `json:"area_ha"`
}

// LULCMetrics summarizes diversity and dominance of the AOI composition.
type LULCMetrics struct {
	AreaHa        float64 `json:"area_ha"`
	NPixels       int     `json:"n_pixels"`
	NClasses      int     `json:"n_classes"`
	ShannonH      float64 `json:"shannon_h"`
	PielouJ       float64 `json:"pielou_j"`
	DominantClass string  `json:"dominant_class"`
	DominantPct   float64 `json:"dominant_pct"`
	SojaPct       float64 `json:"soja_pct"`
	OutrasLavPct  float64 `json:"outras_lav_pct"`
	AgricolaPct   float64 `json:"agricola_pct"`
}

// LULCCompareRow compares MapBiomas vs predicted composition for one class.
type LULCCompareRow struct {
	ClassID int     `json:"class_id"`
	Name    string  `json:"name"`
	Color   string  `json:"color"`
	PctRef  float64 `json:"pct_ref"`
	PctPred float64 `json:"pct_pred"`
	// PixelsRef counts 10 m pixels. NReferenceCells counts the distinct native
	// 30 m MapBiomas cells those pixels were resampled from, which is the number
	// of independent label observations. The two are not interchangeable: about
	// nine pixels share one cell. Zero when the cell mapping was unavailable.
	PixelsRef       int `json:"pixels_ref"`
	NReferenceCells int `json:"n_reference_cells,omitempty"`
}

// LULCAnalysis is the descriptive land cover / land use payload.
type LULCAnalysis struct {
	Year        int              `json:"year"`
	Source      string           `json:"source"`
	MapURI      string           `json:"map_uri,omitempty"`
	MapPNG      string           `json:"map_png,omitempty"`
	Extent      Bounds           `json:"extent"`
	Metrics     LULCMetrics      `json:"metrics"`
	Composition []LULCClassRow   `json:"composition"`
	Groups      []LULCGroupRow   `json:"groups"`
	PredVsRef   []LULCCompareRow `json:"pred_vs_ref"`
	// Sample size of the pred-vs-ref comparison. ComparePixels counts 10 m
	// pixels where both maps are valid; CompareReferenceCells counts the
	// distinct native 30 m MapBiomas cells behind them, which is what an
	// agreement statistic must be computed over. Zero when unavailable.
	ComparePixels         int `json:"compare_pixels,omitempty"`
	CompareReferenceCells int `json:"compare_reference_cells,omitempty"`
}

// LULCRequest selects an embedded area (or explicit polygon + MapBiomas path).
type LULCRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	MapBiomasPath  string           `json:"mapbiomas_path,omitempty"`
}

// DataCubeRequest lists Sentinel-2 scenes for an AOI before Classify.
type DataCubeRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	MaxCloud       float64          `json:"max_cloud"`
	MonthlyBest    bool             `json:"monthly_best"`
	Tiles          []string         `json:"tiles"`
}

// DataCubeScene is one STAC scene in the data-cube inventory.
type DataCubeScene struct {
	ID         string  `json:"id"`
	Date       string  `json:"date"`
	CloudCover float64 `json:"cloud_cover"`
	Tile       string  `json:"tile"`
	Satellite  string  `json:"satellite"`
	PreviewURI string  `json:"preview_uri,omitempty"`
}

// DataCubeResult is the inventory returned by ListDataCube.
type DataCubeResult struct {
	NScenes     int             `json:"n_scenes"`
	Scenes      []DataCubeScene `json:"scenes"`
	DateRange   []string        `json:"date_range"`
	MonthlyBest bool            `json:"monthly_best"`
	MaxCloud    float64         `json:"max_cloud"`
}

// CompositeRequest renders an RGB composite or spectral index for one scene.
type CompositeRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	MaxCloud       float64          `json:"max_cloud"`
	MonthlyBest    bool             `json:"monthly_best"`
	Tiles          []string         `json:"tiles"`
	SceneID        string           `json:"scene_id"`
	Kind           string           `json:"kind"` // "rgb" | "index"
	Bands          []string         `json:"bands,omitempty"`
	Index          string           `json:"index,omitempty"`
	StretchPct     []float64        `json:"stretch_pct,omitempty"`
}

// CompositeResult is a PNG overlay for map display (+ optional GeoTIFF path).
type CompositeResult struct {
	Extent     Bounds         `json:"extent"`
	OverlayURI string         `json:"overlay_uri"`
	RasterTIF  string         `json:"raster_tif,omitempty"`
	Meta       map[string]any `json:"meta,omitempty"`
}

// sidecarResult is the raw JSON returned by the sidecar on stdout.
type sidecarResult struct {
	Extent          Bounds                `json:"extent"`
	OverlayPNG      string                `json:"overlay_png"`
	RasterTIF       string                `json:"raster_tif"`
	ConfidencePNG   string                `json:"confidence_png"`
	NDVIMeanPNG     string                `json:"ndvi_mean_png"`
	TrueColorPNG    string                `json:"true_color_png"`
	ReferencePNG    string                `json:"reference_png"`
	MeanConfidence  float64               `json:"mean_confidence"`
	NDates          int                   `json:"n_dates"`
	DateRange       []string              `json:"date_range"`
	ClassStats      []ClassStat           `json:"class_stats"`
	Temporal        []TemporalPoint       `json:"temporal"`
	VISeries        []VISeriesPoint       `json:"vi_series"`
	Phenology       PhenologyMetrics      `json:"phenology"`
	PhenologyStates []PhenologyStatePoint `json:"phenology_states"`
	LULC            *lulcSidecarPayload   `json:"lulc"`
}

// lulcSidecarPayload is the raw LULC block from Python (map as file path).
type lulcSidecarPayload struct {
	Year        int              `json:"year"`
	Source      string           `json:"source"`
	MapPNG      string           `json:"map_png"`
	Extent      Bounds           `json:"extent"`
	Metrics     LULCMetrics      `json:"metrics"`
	Composition []LULCClassRow   `json:"composition"`
	Groups      []LULCGroupRow   `json:"groups"`
	PredVsRef   []LULCCompareRow `json:"pred_vs_ref"`
	// Sample size of the pred-vs-ref comparison. ComparePixels counts 10 m
	// pixels where both maps are valid; CompareReferenceCells counts the
	// distinct native 30 m MapBiomas cells behind them, which is what an
	// agreement statistic must be computed over. Zero when unavailable.
	ComparePixels         int `json:"compare_pixels,omitempty"`
	CompareReferenceCells int `json:"compare_reference_cells,omitempty"`
}

// PredictResult is returned to the frontend. The overlay is delivered as a
// base64 data URI so Leaflet can render it without an asset-server path.
type PredictResult struct {
	Extent          Bounds                `json:"extent"`
	OverlayURI      string                `json:"overlay_uri"`
	ConfidenceURI   string                `json:"confidence_uri"`
	NDVIMeanURI     string                `json:"ndvi_mean_uri"`
	TrueColorURI    string                `json:"true_color_uri"`
	ReferenceURI    string                `json:"reference_uri"`
	RasterTIF       string                `json:"raster_tif"`
	MeanConfidence  float64               `json:"mean_confidence"`
	NDates          int                   `json:"n_dates"`
	DateRange       []string              `json:"date_range"`
	ClassStats      []ClassStat           `json:"class_stats"`
	Temporal        []TemporalPoint       `json:"temporal"`
	VISeries        []VISeriesPoint       `json:"vi_series"`
	Phenology       PhenologyMetrics      `json:"phenology"`
	PhenologyStates []PhenologyStatePoint `json:"phenology_states"`
	LULC            *LULCAnalysis         `json:"lulc,omitempty"`
	// Attached by the frontend when a surface-water run has been made over the
	// same AOI. Produced by a separate action, so it is not filled by Predict.
	Water *WaterAnalysis `json:"water,omitempty"`
	// Same, for the solar products. Solar needs no scene, so it can be present
	// with no classification behind it at all.
	Solar        *SolarAnalysis        `json:"solar,omitempty"`
	SolarTerrain *SolarTerrainAnalysis `json:"solar_terrain,omitempty"`
	SolarSiting  *SolarSitingAnalysis  `json:"solar_siting,omitempty"`
}

// ProgressEvent is emitted to the frontend as "predict:progress".
type ProgressEvent struct {
	Progress int    `json:"progress"`
	Msg      string `json:"msg"`
}

// ResearchExportMeta accompanies a PredictResult when building a research ZIP.
type ResearchExportMeta struct {
	ModelKind      string `json:"model_kind"`
	AreaID         string `json:"area_id"`
	AoiLabel       string `json:"aoi_label"`
	PolygonGeoJSON string `json:"polygon_geojson"` // raw GeoJSON geometry or Feature
}

// WaterRequest selects an AOI and period for surface water / flood mapping.
type WaterRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	MaxCloud       float64          `json:"max_cloud"`
	MonthlyBest    bool             `json:"monthly_best"`
	// One of NDWI, MNDWI, AWEI. Empty selects MNDWI.
	Index string `json:"index,omitempty"`
	// Recorded with the saved run, matching the classification request.
	Label     string `json:"label,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
}

// WaterDate is one acquisition in the surface-water series.
type WaterDate struct {
	Date       string  `json:"date"`
	SceneID    string  `json:"scene_id"`
	CloudCover float64 `json:"cloud_cover"`
	// Pixels of the AOI actually observed on this date. Water fractions are a
	// percentage of this, not of the whole AOI, so a partly clouded date is not
	// reported as dry.
	ObservedPixels int `json:"observed_pixels"`
	// The literature cut (zero) is the primary threshold. The Otsu value is
	// reported alongside it for comparison, never silently substituted.
	ThresholdFixed float64 `json:"threshold_fixed"`
	ThresholdOtsu  float64 `json:"threshold_otsu"`
	// ThresholdClipped means the Otsu value reached an empirical bound and is a
	// bound rather than an estimate; ThresholdDegenerate means there were too
	// few observations to threshold at all.
	ThresholdClipped    bool    `json:"threshold_clipped"`
	ThresholdDegenerate bool    `json:"threshold_degenerate"`
	WaterFractionPct    float64 `json:"water_fraction_pct"`
	WaterFractionOtsu   float64 `json:"water_fraction_otsu_pct"`
	WaterPixels         int     `json:"water_pixels"`
	AreaHa              float64 `json:"area_ha"`
}

// WaterAnalysis is a surface water / flood mapping result. Descriptive: a
// thresholded spectral index, with no model and no trained legend.
type WaterAnalysis struct {
	Index           string      `json:"index"`
	ThresholdMethod string      `json:"threshold_method"`
	ThresholdFixed  float64     `json:"threshold_fixed"`
	OtsuClip        []float64   `json:"otsu_clip"`
	NDates          int         `json:"n_dates"`
	DateRange       []string    `json:"date_range"`
	AOIPixels       int         `json:"aoi_pixels"`
	AOIAreaHa       float64     `json:"aoi_area_ha"`
	Series          []WaterDate `json:"series"`
	PeakDate        string      `json:"peak_date"`
	PeakWaterPct    float64     `json:"peak_water_fraction_pct"`
	// Occurrence bands. Ephemeral is water on some dates but not most, which is
	// the flood signal; persistent is standing water.
	EphemeralPixels  int     `json:"ephemeral_pixels"`
	EphemeralAreaHa  float64 `json:"ephemeral_area_ha"`
	PersistentPixels int     `json:"persistent_pixels"`
	PersistentAreaHa float64 `json:"persistent_area_ha"`
	MeanAnomaly      float64 `json:"mean_anomaly"`
	// Occurrence raster as a base64 PNG data URI, on a fixed 0 to 1 scale.
	OccurrenceURI string `json:"occurrence_uri"`
	Extent        Bounds `json:"extent"`
}

// waterSidecarPayload is the raw water block from Python (PNG as a file path).
type waterSidecarPayload struct {
	Index            string      `json:"index"`
	ThresholdMethod  string      `json:"threshold_method"`
	ThresholdFixed   float64     `json:"threshold_fixed"`
	OtsuClip         []float64   `json:"otsu_clip"`
	NDates           int         `json:"n_dates"`
	DateRange        []string    `json:"date_range"`
	AOIPixels        int         `json:"aoi_pixels"`
	AOIAreaHa        float64     `json:"aoi_area_ha"`
	Series           []WaterDate `json:"series"`
	PeakDate         string      `json:"peak_date"`
	PeakWaterPct     float64     `json:"peak_water_fraction_pct"`
	EphemeralPixels  int         `json:"ephemeral_pixels"`
	EphemeralAreaHa  float64     `json:"ephemeral_area_ha"`
	PersistentPixels int         `json:"persistent_pixels"`
	PersistentAreaHa float64     `json:"persistent_area_ha"`
	MeanAnomaly      float64     `json:"mean_anomaly"`
	OccurrencePNG    string      `json:"occurrence_png"`
	Extent           Bounds      `json:"extent"`
}

// SolarRequest selects an AOI for solar resource analysis. The radiation grid
// is 1 degree, so the request resolves to the cell the AOI centroid falls in.
type SolarRequest struct {
	AreaID           string           `json:"area_id"`
	PolygonGeoJSON   *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	ClimatologyYears int              `json:"climatology_years,omitempty"`
	HourlyYears      int              `json:"hourly_years,omitempty"`
	// 0 is north, the southern-hemisphere default.
	SurfaceAzimuth float64 `json:"surface_azimuth"`
	// Null applies the reference ratio; a value overrides it. The response
	// always reports which was used.
	PerformanceRatio *float64 `json:"performance_ratio,omitempty"`
	// Recorded with the saved run, matching the other analyses.
	Label     string `json:"label,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
}

// SolarMonth is one calendar month of the radiation climatology, as daily means.
type SolarMonth struct {
	Month int      `json:"month"`
	GHI   *float64 `json:"ghi"`
	DNI   *float64 `json:"dni"`
	DHI   *float64 `json:"dhi"`
	KT    *float64 `json:"kt"`
}

// SolarResource is the long-term radiation climatology at the point.
type SolarResource struct {
	GHIAnnualKWhM2 float64      `json:"ghi_annual_kwh_m2"`
	GHIStd         float64      `json:"ghi_std"`
	GHICVPct       float64      `json:"ghi_cv_pct"`
	GHIP10         float64      `json:"ghi_p10"`
	GHIP90         float64      `json:"ghi_p90"`
	NYears         int          `json:"n_years"`
	TrendPerYear   float64      `json:"trend_per_year"`
	TrendPValue    float64      `json:"trend_p_value"`
	ClearSkyIndex  *float64     `json:"clear_sky_index"`
	Monthly        []SolarMonth `json:"monthly"`
}

// SolarTiltLoss is the insolation lost by deviating from the optimum tilt.
type SolarTiltLoss struct {
	DeviationDeg float64 `json:"deviation_deg"`
	LossPct      float64 `json:"loss_pct"`
}

// SolarGeometry is the fixed-tilt optimum for the point.
type SolarGeometry struct {
	OptimalTiltDeg        float64         `json:"optimal_tilt_deg"`
	OptimalPOAKWhM2Year   float64         `json:"optimal_poa_kwh_m2_year"`
	SurfaceAzimuthDeg     float64         `json:"surface_azimuth_deg"`
	GainOverHorizontalPct float64         `json:"gain_over_horizontal_pct"`
	TiltTolerance         []SolarTiltLoss `json:"tilt_tolerance"`
}

// SolarPV is the photovoltaic yield for a 1 kWp reference array.
type SolarPV struct {
	SpecificYieldKWhKWpYear float64 `json:"specific_yield_kwh_kwp_year"`
	// The ratio applied to produce the yield, and where it came from:
	// "reference" or "user".
	PerformanceRatio       float64 `json:"performance_ratio"`
	PerformanceRatioSource string  `json:"performance_ratio_source"`
	// What this chain models. It runs high because soiling, inter-row shading,
	// degradation, availability and cabling are not modelled, so it is reported
	// for comparison rather than applied.
	PerformanceRatioModelled float64 `json:"performance_ratio_modelled"`
	CapacityFactorPct        float64 `json:"capacity_factor_pct"`
	HourlyYears              int     `json:"hourly_years"`
}

// SolarAnalysis is a solar resource result. Physics with no trained head, so it
// carries no fixed legend and cannot fail on scene availability.
type SolarAnalysis struct {
	Lon      float64       `json:"lon"`
	Lat      float64       `json:"lat"`
	Resource SolarResource `json:"resource"`
	Geometry SolarGeometry `json:"geometry"`
	PV       SolarPV       `json:"pv"`
	// States the grid the figures resolve on. Required in every response: a
	// per-AOI number shown without it reads as local.
	GridNote string `json:"grid_note"`
}

// SolarTerrainRequest maps plane-of-array irradiation over the AOI terrain.
type SolarTerrainRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	HourlyYears    int              `json:"hourly_years,omitempty"`
	// "annual", "winter", "summer", "winter_crop", "anisotropy" for the
	// winter-over-summer ratio, or "shading" for the share of beam irradiation
	// the terrain horizon blocks. The annual map averages a geometry that
	// reverses within the year, so the window is explicit.
	Season    string `json:"season,omitempty"`
	Label     string `json:"label,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
}

// SolarRenderScale is the colour domain an overlay was drawn on.
//
// Carried explicitly because a client cannot infer it and must not guess: two
// layers drawn on different domains look comparable and are not. Winter and
// summer are deliberately given one domain, since their spatial spread differs
// by about a factor of ten and per-layer normalisation would draw them at
// identical contrast.
type SolarRenderScale struct {
	// Named ramp from the sidecar palette table, so the legend is built from
	// the same stops that drew the raster.
	Palette string  `json:"palette"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	// Value with an absolute meaning on this scale, if the quantity has one.
	// Anisotropy has parity at 1.0; irradiation has none.
	Reference *float64 `json:"reference"`
	// "own", "shared" or "fixed": how the domain was chosen.
	Basis      string `json:"basis"`
	SharedWith string `json:"shared_with"`
	// Decimal places the quantity is meaningful to.
	Decimals int `json:"decimals"`
}

// SolarTerrainAnalysis is the mappable solar quantity. The atmospheric resource
// has no spatial structure at AOI scale; the irradiation reaching an inclined
// surface does, because the surface is terrain.
type SolarTerrainAnalysis struct {
	POAMin       float64 `json:"poa_min"`
	POAMax       float64 `json:"poa_max"`
	POAMean      float64 `json:"poa_mean"`
	POAStdPct    float64 `json:"poa_std_pct"`
	SlopeMeanDeg float64 `json:"slope_mean_deg"`
	SlopeMaxDeg  float64 `json:"slope_max_deg"`
	Pixels       int     `json:"pixels"`
	HourlyYears  int     `json:"hourly_years"`
	DEMSource    string  `json:"dem_source"`
	Season       string  `json:"season"`
	Unit         string  `json:"unit"`
	// Colour domain the overlay was drawn on. Read this, not POAMin/POAMax,
	// when building a legend: for a seasonal layer the domain spans both
	// seasons and is wider than this layer's own range.
	Scale SolarRenderScale `json:"scale"`
	// Share of the beam irradiation the terrain horizon blocks, over the AOI.
	// Small in the mean and large in incised valleys, which is where a siting
	// map most needs it.
	ShadingMeanPct  *float64 `json:"shading_mean_pct"`
	ShadingMaxPct   *float64 `json:"shading_max_pct"`
	HorizonMaxDistM float64  `json:"horizon_max_dist_m"`
	// Share of the horizontal irradiation carried by the beam component, which
	// is what the shading loss is scaled by before it reaches the totals.
	BeamFraction float64 `json:"beam_fraction"`
	// Raster as a base64 PNG data URI, drawn on Scale.
	OverlayURI string `json:"overlay_uri"`
	RasterTIF  string `json:"raster_tif"`
	Extent     Bounds `json:"extent"`
}

// NDates reports the years of hourly record behind the map, so a saved run can
// state its basis the way the other kinds do.
func (t *SolarTerrainAnalysis) NDates() int { return t.HourlyYears }

type solarTerrainSidecarPayload struct {
	POAMin          float64          `json:"poa_min"`
	POAMax          float64          `json:"poa_max"`
	POAMean         float64          `json:"poa_mean"`
	POAStdPct       float64          `json:"poa_std_pct"`
	SlopeMeanDeg    float64          `json:"slope_mean_deg"`
	SlopeMaxDeg     float64          `json:"slope_max_deg"`
	Pixels          int              `json:"pixels"`
	HourlyYears     int              `json:"hourly_years"`
	DEMSource       string           `json:"dem_source"`
	Season          string           `json:"season"`
	Unit            string           `json:"unit"`
	Scale           SolarRenderScale `json:"scale"`
	ShadingMeanPct  *float64         `json:"shading_mean_pct"`
	ShadingMaxPct   *float64         `json:"shading_max_pct"`
	HorizonMaxDistM float64          `json:"horizon_max_dist_m"`
	BeamFraction    float64          `json:"beam_fraction"`
	OverlayPNG      string           `json:"overlay_png"`
	RasterTIF       string           `json:"raster_tif"`
	Extent          Bounds           `json:"extent"`
}

// SolarSitingRequest selects an AOI and the siting conventions to apply.
type SolarSitingRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// Conventions, not verified legal restrictions. Zero applies the default,
	// and the response repeats what was used.
	SlopeAcceptableDeg  float64 `json:"slope_acceptable_deg,omitempty"`
	SlopeRestrictiveDeg float64 `json:"slope_restrictive_deg,omitempty"`
	ExcludedCover       []int   `json:"excluded_cover,omitempty"`
	CroplandCover       []int   `json:"cropland_cover,omitempty"`
	Label               string  `json:"label,omitempty"`
	RunLabel            string  `json:"run_label,omitempty"`
	ProjectID           string  `json:"project_id,omitempty"`
}

// SolarSitingClass is one siting class with its extent.
type SolarSitingClass struct {
	Code   int     `json:"code"`
	Name   string  `json:"name"`
	Color  string  `json:"color"`
	Pixels int     `json:"pixels"`
	AreaHa float64 `json:"area_ha"`
	Pct    float64 `json:"pct"`
}

// SolarSitingThresholds records the conventions a result was produced under.
type SolarSitingThresholds struct {
	SlopeAcceptableDeg  float64 `json:"slope_acceptable_deg"`
	SlopeRestrictiveDeg float64 `json:"slope_restrictive_deg"`
	ExcludedCover       []int   `json:"excluded_cover"`
	CroplandCover       []int   `json:"cropland_cover"`
	Note                string  `json:"note"`
}

// SolarSitingAnalysis is the photovoltaic siting map.
type SolarSitingAnalysis struct {
	Classes []SolarSitingClass `json:"classes"`
	// Reported apart and never summed: a pixel that is geometrically fine but
	// currently produces soybean carries a trade-off a binary map would hide.
	SuitableNoConflictHa float64               `json:"suitable_no_conflict_ha"`
	SuitableCroplandHa   float64               `json:"suitable_cropland_ha"`
	PixelAreaHa          float64               `json:"pixel_area_ha"`
	Thresholds           SolarSitingThresholds `json:"thresholds"`
	DEMSource            string                `json:"dem_source"`
	OverlayURI           string                `json:"overlay_uri"`
	RasterTIF            string                `json:"raster_tif"`
	Extent               Bounds                `json:"extent"`
}

type solarSitingSidecarPayload struct {
	Classes              []SolarSitingClass    `json:"classes"`
	SuitableNoConflictHa float64               `json:"suitable_no_conflict_ha"`
	SuitableCroplandHa   float64               `json:"suitable_cropland_ha"`
	PixelAreaHa          float64               `json:"pixel_area_ha"`
	Thresholds           SolarSitingThresholds `json:"thresholds"`
	DEMSource            string                `json:"dem_source"`
	OverlayPNG           string                `json:"overlay_png"`
	RasterTIF            string                `json:"raster_tif"`
	Extent               Bounds                `json:"extent"`
}
