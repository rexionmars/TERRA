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
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
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

// ClassSpectrumPoint is one band, for one predicted class, on one acquisition.
type ClassSpectrumPoint struct {
	ClassID      int     `json:"class_id"`
	Name         string  `json:"name"`
	Color        string  `json:"color"`
	Band         string  `json:"band"`
	WavelengthNM float64 `json:"wavelength_nm"`
	NPixels      int     `json:"n_pixels"`
	Mean         float64 `json:"mean"`
	SD           float64 `json:"sd"`
	P05          float64 `json:"p05"`
	P95          float64 `json:"p95"`
}

// ClassSpectra is the measured spectral response per predicted class.
//
// It answers the question the domain-shift diagnostics leave open: those report
// that a distribution moved, this reports which band moved and in which
// direction.
//
// SceneDate is load-bearing rather than provenance trim. The classification
// spans the whole period; the reflectance is one acquisition, because averaging
// seven bands across a season describes no date. A reader who takes the curve
// for a seasonal mean is reading something the payload does not contain.
//
// Convention names the reflectance convention in words, because this run also
// reports quantities the model consumed under the other one.
type ClassSpectra struct {
	SceneDate  string               `json:"scene_date"`
	SceneID    string               `json:"scene_id,omitempty"`
	NScenes    int                  `json:"n_scenes"`
	Convention string               `json:"convention"`
	Bands      []string             `json:"bands"`
	Points     []ClassSpectrumPoint `json:"points"`
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

/*
LULCAgreement is the accuracy assessment of the classification against the
MapBiomas reference.

Computed over the reference's native 30 m cells rather than the 10 m pixels
they were resampled onto: about nine pixels carry one label observation, so a
pixel-level assessment would claim nine times the sample size it has and an
interval roughly three times too narrow.
*/
type LULCAgreement struct {
	// Independent label observations the assessment rests on.
	NReferenceCells int `json:"n_reference_cells"`
	// Share of cells where the classification and the reference agree, with a
	// Wilson score interval at 95%.
	OverallPct float64   `json:"overall_pct"`
	OverallCI  []float64 `json:"overall_ci"`
	// Pontius & Millones (2011): total disagreement splits into holding
	// different amounts of a class, and holding the same amounts in different
	// places. The composition comparison shows the first and hides the second.
	QuantityDisagreementPct   float64 `json:"quantity_disagreement_pct"`
	AllocationDisagreementPct float64 `json:"allocation_disagreement_pct"`

	PerClass []LULCClassAccuracy `json:"per_class"`
	// Reference cells carrying a class the classifier has no label for. Not
	// errors -- the share of the area the assessment is silent about.
	NOutsideLegend int `json:"n_outside_legend"`
	// Rows are the classification, columns the reference. `agreement_against_
	// reference` fills matrix[pred][ref] and takes producer's accuracy from the
	// column totals; reading it the other way inverts omission and commission.
	Matrix        [][]int `json:"matrix"`
	MatrixClasses []int   `json:"matrix_classes"`
	// Agreement per spatial block. Absent where no block held enough reference
	// cells to carry a percentage.
	Blocks *LULCAgreementBlocks `json:"blocks,omitempty"`
}

/*
LULCAgreementBlocks is agreement broken down over a fixed grid of blocks.

OverallPct cannot separate a classifier that is uniformly mediocre from one
that is accurate everywhere but a corner, and those call for different work.
The spread here is what distinguishes them, and it is also the second axis on
which two AOIs can be compared -- one number per area says nothing about
whether they differ in level or in evenness.

Descriptive, not inferential: the blocks are a grid over the raster's own
extent rather than a sampling design, they hold different numbers of cells,
and they are not independent of the landscape.
*/
type LULCAgreementBlocks struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
	// Reference cells a block needs before its percentage is reported.
	MinCells int                  `json:"min_cells"`
	Cells    []LULCAgreementBlock `json:"cells"`
	// Blocks that cleared MinCells, and the spread over those.
	NMeasured int     `json:"n_measured"`
	MedianPct float64 `json:"median_pct"`
	IQRPct    float64 `json:"iqr_pct"`
	MinPct    float64 `json:"min_pct"`
	MaxPct    float64 `json:"max_pct"`
}

// LULCAgreementBlock is one block's agreement; OverallPct is nil below MinCells.
type LULCAgreementBlock struct {
	Row             int      `json:"row"`
	Col             int      `json:"col"`
	NReferenceCells int      `json:"n_reference_cells"`
	OverallPct      *float64 `json:"overall_pct"`
}

/*
LULCClassAccuracy is one class's producer's and user's accuracy.

Both, never one. Producer's alone hides commission and user's alone hides
omission: a classifier that labels the whole scene soybean has perfect
producer's accuracy for soybean and is useless.
*/
type LULCClassAccuracy struct {
	ClassID int    `json:"class_id"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	// Of the reference cells of this class, the share the classifier found.
	// Nil when the reference holds none, which is absent rather than zero.
	ProducersPct *float64  `json:"producers_pct"`
	ProducersCI  []float64 `json:"producers_ci,omitempty"`
	// Of the cells called this class, the share that really are.
	UsersPct   *float64  `json:"users_pct"`
	UsersCI    []float64 `json:"users_ci,omitempty"`
	NReference int       `json:"n_reference"`
	NPredicted int       `json:"n_predicted"`
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
	// Agreement against the reference, which the composition rows above cannot
	// express: two maps with identical class proportions can disagree on every
	// cell. Nil when the reference cell mapping was unavailable, since without
	// it there is no honest denominator.
	Agreement *LULCAgreement `json:"agreement,omitempty"`
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
	Extent         Bounds  `json:"extent"`
	OverlayPNG     string  `json:"overlay_png"`
	RasterTIF      string  `json:"raster_tif"`
	ConfidencePNG  string  `json:"confidence_png"`
	NDVIMeanPNG    string  `json:"ndvi_mean_png"`
	TrueColorPNG   string  `json:"true_color_png"`
	ReferencePNG   string  `json:"reference_png"`
	MeanConfidence float64 `json:"mean_confidence"`
	// The floor MeanConfidence cannot go below: confidence is
	// max(predict_proba), so with K classes it lives on [1/K, 1] and never
	// approaches zero. Without it the figure reads on a 0-100 scale it does
	// not occupy. Zero when the class count was unavailable.
	ConfidenceFloor   float64               `json:"confidence_floor,omitempty"`
	NDates            int                   `json:"n_dates"`
	DateRange         []string              `json:"date_range"`
	PixelSizeM        float64               `json:"pixel_size_m,omitempty"`
	ClassStats        []ClassStat           `json:"class_stats"`
	ClassSpectra      *ClassSpectra         `json:"class_spectra,omitempty"`
	Temporal          []TemporalPoint       `json:"temporal"`
	VISeries          []VISeriesPoint       `json:"vi_series"`
	VISeriesCrop      []VISeriesPoint       `json:"vi_series_crop"`
	CropPixelPct      float64               `json:"crop_pixel_pct"`
	Phenology         PhenologyMetrics      `json:"phenology"`
	PhenologyStates   []PhenologyStatePoint `json:"phenology_states"`
	LULC              *lulcSidecarPayload   `json:"lulc"`
	DomainFingerprint *DomainFingerprint    `json:"domain_fingerprint,omitempty"`
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
	// Agreement against the reference, which the composition rows above cannot
	// express: two maps with identical class proportions can disagree on every
	// cell. Nil when the reference cell mapping was unavailable, since without
	// it there is no honest denominator.
	Agreement *LULCAgreement `json:"agreement,omitempty"`
}

// PredictResult is returned to the frontend. The overlay is delivered as a
// base64 data URI so Leaflet can render it without an asset-server path.
type PredictResult struct {
	Extent        Bounds `json:"extent"`
	OverlayURI    string `json:"overlay_uri"`
	ConfidenceURI string `json:"confidence_uri"`
	NDVIMeanURI   string `json:"ndvi_mean_uri"`
	TrueColorURI  string `json:"true_color_uri"`
	ReferenceURI  string `json:"reference_uri"`
	RasterTIF     string `json:"raster_tif"`
	// The saved run this result became, set after persisting so the stored
	// copy does not carry its own row id. Empty when nothing was saved.
	// Compositions made while this result is on screen attach to it.
	RunID          string  `json:"run_id,omitempty"`
	MeanConfidence float64 `json:"mean_confidence"`
	// The floor MeanConfidence cannot go below: confidence is
	// max(predict_proba), so with K classes it lives on [1/K, 1] and never
	// approaches zero. Without it the figure reads on a 0-100 scale it does
	// not occupy. Zero when the class count was unavailable.
	ConfidenceFloor float64  `json:"confidence_floor,omitempty"`
	NDates          int      `json:"n_dates"`
	DateRange       []string `json:"date_range"`
	// The side of one predicted pixel on the ground, in metres, off the grid
	// the run was made on rather than assumed. Zero on runs saved before it was
	// carried, where a reader falls back on the 10 m the Sentinel-2 grid gives
	// and which is what it has been in practice.
	PixelSizeM float64     `json:"pixel_size_m,omitempty"`
	ClassStats []ClassStat `json:"class_stats"`
	// Absent on older runs, on the non-spectral model paths and whenever the
	// scene behind the classification could not be re-read for its bands.
	ClassSpectra *ClassSpectra   `json:"class_spectra,omitempty"`
	Temporal     []TemporalPoint `json:"temporal"`
	VISeries     []VISeriesPoint `json:"vi_series"`
	// The same dates averaged over CROP PIXELS ONLY, alongside the AOI-wide
	// series rather than replacing it: the series above is what every export
	// and figure already carries, and narrowing it in place would move numbers
	// nobody asked to move.
	//
	// The two can differ in length -- a date whose crop pixels were entirely
	// cloud-obscured leaves this series and stays in the other -- so they must
	// be read by date and never zipped by index.
	//
	// Empty when the AOI carries no cropland, which is a statement and not a
	// failure. Anything inverting an index to leaf area should prefer this one:
	// on the soybean AOI this was built against, the peak reads 0.314 as an
	// area mean with a standard deviation of 0.190, which for a roughly even
	// two-population mix puts the crop pixels near 0.50.
	VISeriesCrop []VISeriesPoint `json:"vi_series_crop,omitempty"`
	// The crop share of the AOI, as a percentage. The denominator that says how
	// much of the area mean above is actually the crop.
	CropPixelPct    float64               `json:"crop_pixel_pct,omitempty"`
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
	// The photovoltaic energy model. Shares the radiation chain with Solar but
	// is a separate run, so both can be present over one AOI.
	EnergyModel *EnergyModelAnalysis `json:"energy_model,omitempty"`
	// Wind screening. Filed under its own run kind, not under solar: it comes
	// from a different product on a different grid and carries no external
	// validation, so it must not inherit the solar labelling.
	Wind *WindAnalysis `json:"wind,omitempty"`
	// Compact spectral / NDVI fingerprint cached at classify time for
	// domain-shift diagnostics against another run. Absent on older runs and
	// on water/solar-only results.
	DomainFingerprint *DomainFingerprint `json:"domain_fingerprint,omitempty"`
}

// DomainHistogram is a fixed-edge probability histogram (NDVI by default).
type DomainHistogram struct {
	Edges  []float64 `json:"edges"`
	Counts []float64 `json:"counts"`
	Probs  []float64 `json:"probs"`
}

// DomainRedNIR holds mean red / NIR reflectances for CVA direction.
type DomainRedNIR struct {
	RedMean float64 `json:"red_mean"`
	NirMean float64 `json:"nir_mean"`
}

// DomainFingerprint is a compact per-run summary of the feature domain.
type DomainFingerprint struct {
	Space     string    `json:"space"`
	NFeatures int       `json:"n_features"`
	NPixels   int       `json:"n_pixels"`
	NSample   int       `json:"n_sample"`
	Mean      []float64 `json:"mean"`
	Var       []float64 `json:"var"`
	// In training standard deviations, from the model's own scaler.
	//
	// These decide whether a comparison can be standardised at all: the
	// sidecar refuses to standardise when either side lacks them, and an
	// unstandardised distance is dominated by the acquisition-index features,
	// which measured 99.7% of the raw squared distance on the shipped model.
	// A struct that omitted them stripped the fingerprint in transit, so the
	// comparison always took the refusing branch however the run was made.
	ZMean              []float64        `json:"z_mean,omitempty"`
	ZVar               []float64        `json:"z_var,omitempty"`
	FeatureNames       []string         `json:"feature_names,omitempty"`
	FeatureImportances []float64        `json:"feature_importances,omitempty"`
	NDVIHist           *DomainHistogram `json:"ndvi_hist,omitempty"`
	RedNIR             *DomainRedNIR    `json:"red_nir,omitempty"`
	// Subsample of feature rows for MMD / PCA (capped at classify time).
	Sample [][]float64 `json:"sample,omitempty"`
}

// DomainShiftMMD carries the kernel two-sample statistic and its bandwidth.
//
// An object rather than a scalar because the estimate is not readable without
// the sample sizes it was computed from and the bandwidth the median heuristic
// chose: MMD is not comparable across different gammas.
type DomainShiftMMD struct {
	MMD2  *float64 `json:"mmd2,omitempty"`
	Gamma *float64 `json:"gamma,omitempty"`
	NA    int      `json:"n_a"`
	NB    int      `json:"n_b"`
}

// DomainFeatureShift is one row of the per-feature displacement table.
type DomainFeatureShift struct {
	Feature string  `json:"feature"`
	ZA      float64 `json:"z_a"`
	ZB      float64 `json:"z_b"`
	GapSD   float64 `json:"gap_sd"`
	// Impurity importance from the fitted forest; absent for other spaces.
	Importance *float64 `json:"importance,omitempty"`
	Weighted   float64  `json:"weighted"`
}

// DomainShiftRequest compares two cached fingerprints (optional agreements).
type DomainShiftRequest struct {
	FingerprintA map[string]any `json:"fingerprint_a"`
	FingerprintB map[string]any `json:"fingerprint_b"`
	AgreementA   map[string]any `json:"agreement_a,omitempty"`
	AgreementB   map[string]any `json:"agreement_b,omitempty"`
	IncludeTSNE  bool           `json:"include_tsne,omitempty"`
}

/*
DomainShiftCohortRequest measures one source against N targets in one call.

The transferability question has a star topology -- one region the model was
fitted on, every other measured against it -- so for N areas it is N-1
comparisons, not the N(N-1)/2 a pairwise device offers. Driving those from the
frontend would spawn N-1 Python processes, each paying the numpy and sklearn
import before doing arithmetic on 512 rows.
*/
type DomainShiftCohortRequest struct {
	Source  DomainShiftCohortSide   `json:"source"`
	Targets []DomainShiftCohortSide `json:"targets"`
}

// DomainShiftCohortSide is one AOI's fingerprint and its identity.
type DomainShiftCohortSide struct {
	ID          string         `json:"id"`
	Label       string         `json:"label"`
	Fingerprint map[string]any `json:"fingerprint"`
	Agreement   map[string]any `json:"agreement,omitempty"`
}

// DomainShiftCohort is the source and one row per target.
type DomainShiftCohort struct {
	Source  DomainShiftCohortSource `json:"source"`
	Targets []DomainShiftCohortRow  `json:"targets"`
}

// DomainShiftCohortSource identifies the centre of the star.
type DomainShiftCohortSource struct {
	ID        string                     `json:"id"`
	Label     string                     `json:"label"`
	Space     string                     `json:"space,omitempty"`
	Agreement *DomainShiftAgreementBlock `json:"agreement,omitempty"`
}

/*
DomainShiftCohortRow is one target measured against the source.

The fields mirror DomainShiftReport, minus the histograms, the projection and
the feature-shift table -- see _COHORT_OMIT in the sidecar. Those are per-pair
readings and the cohort view consumes none of them.
*/
type DomainShiftCohortRow struct {
	ID                string          `json:"id"`
	Label             string          `json:"label"`
	SpaceA            string          `json:"space_a,omitempty"`
	SpaceB            string          `json:"space_b,omitempty"`
	KLNDVI            *float64        `json:"kl_ndvi,omitempty"`
	KLNDVIAToB        *float64        `json:"kl_ndvi_a_to_b,omitempty"`
	KLNDVIBToA        *float64        `json:"kl_ndvi_b_to_a,omitempty"`
	SameSpace         bool            `json:"same_space"`
	Standardised      bool            `json:"standardised"`
	CVAMagnitude      *float64        `json:"cva_magnitude,omitempty"`
	CVAMagnitudeSD    *float64        `json:"cva_magnitude_sd,omitempty"`
	CVAAngleRedNIRDeg *float64        `json:"cva_angle_red_nir_deg,omitempty"`
	MMDRBF            *DomainShiftMMD `json:"mmd_rbf,omitempty"`
	// The two qualifiers resolved to the question the caller asks: may this row
	// sit on the same axis as the others? A row that cannot is not a low score,
	// and plotting it beside those that can is the unqualified comparison the
	// qualifiers exist to prevent.
	Comparable bool                       `json:"comparable"`
	AgreementA *DomainShiftAgreementBlock `json:"agreement_a,omitempty"`
	AgreementB *DomainShiftAgreementBlock `json:"agreement_b,omitempty"`
}

// DomainShiftPoint is one projected sample in a 2D scatter.
type DomainShiftPoint struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Domain string  `json:"domain"`
}

// DomainShiftProjection is a PCA or t-SNE scatter of pooled samples.
type DomainShiftProjection struct {
	Method string             `json:"method"`
	Points []DomainShiftPoint `json:"points"`
	// "standardised" or "raw". A projection's axes carry no units either way,
	// but the two are different pictures: on raw features the geometry is set
	// by the acquisition indices, which span 0..21 against reflectances near
	// 0.1, so the separation drawn is largely one of acquisition date.
	Space string `json:"space,omitempty"`
}

// DomainShiftClassF1 is one class's precision, recall and F1 from the matrix.
//
// ClassID is nil only for a matrix that arrived without its axis order, in
// which case Index is all that identifies the row.
type DomainShiftClassF1 struct {
	Index     int      `json:"index"`
	ClassID   *int     `json:"class_id,omitempty"`
	Precision *float64 `json:"precision,omitempty"`
	Recall    *float64 `json:"recall,omitempty"`
	F1        *float64 `json:"f1,omitempty"`
}

// DomainShiftAgreementBlock summarises MapBiomas concordance + F1 for one side.
type DomainShiftAgreementBlock struct {
	Label                     string   `json:"label"`
	OverallPct                *float64 `json:"overall_pct,omitempty"`
	NOutsideLegend            int      `json:"n_outside_legend"`
	OutsideLegendPct          *float64 `json:"outside_legend_pct,omitempty"`
	QuantityDisagreementPct   *float64 `json:"quantity_disagreement_pct,omitempty"`
	AllocationDisagreementPct *float64 `json:"allocation_disagreement_pct,omitempty"`
	MacroF1                   *float64 `json:"macro_f1,omitempty"`
	// The sidecar has emitted these all along; the struct declared no field for
	// them, so precision, recall and F1 per class were discarded at the
	// unmarshal boundary and only the macro average survived. A macro average
	// says the model got worse; only the per-class rows say which class.
	PerClassF1 []DomainShiftClassF1 `json:"per_class_f1,omitempty"`
}

// DomainShiftReport is the diagnosis payload returned by AnalyzeDomainShift.
type DomainShiftReport struct {
	SpaceA     string   `json:"space_a,omitempty"`
	SpaceB     string   `json:"space_b,omitempty"`
	KLNDVI     *float64 `json:"kl_ndvi,omitempty"`
	KLNDVIAToB *float64 `json:"kl_ndvi_a_to_b,omitempty"`
	KLNDVIBToA *float64 `json:"kl_ndvi_b_to_a,omitempty"`
	// Whether the two fingerprints describe the same feature space, and
	// whether both carried the scaler moments needed to standardise. Every
	// distance below is unqualified without them: an 80-feature spectral
	// fingerprint compared against a one-column NDVI fingerprint produces a
	// number from two different quantities.
	SameSpace    bool     `json:"same_space"`
	Standardised bool     `json:"standardised"`
	CVAMagnitude *float64 `json:"cva_magnitude,omitempty"`
	// The same magnitude in training standard deviations, which is the figure
	// to read; the raw one is dominated by acquisition-index features.
	CVAMagnitudeSD    *float64        `json:"cva_magnitude_sd,omitempty"`
	CVAAngleRedNIRDeg *float64        `json:"cva_angle_red_nir_deg,omitempty"`
	MMDRBF            *DomainShiftMMD `json:"mmd_rbf,omitempty"`
	// Where the shift is, by feature. A distance says the domains differ;
	// this says which features moved and whether the model weighs them.
	FeatureShift []DomainFeatureShift       `json:"feature_shift,omitempty"`
	NDVIHistA    *DomainHistogram           `json:"ndvi_hist_a,omitempty"`
	NDVIHistB    *DomainHistogram           `json:"ndvi_hist_b,omitempty"`
	AgreementA   *DomainShiftAgreementBlock `json:"agreement_a,omitempty"`
	AgreementB   *DomainShiftAgreementBlock `json:"agreement_b,omitempty"`
	Projection   *DomainShiftProjection     `json:"projection,omitempty"`
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
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
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
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
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

// PowerSeriesProvenance records which NASA POWER series a run read and when it
// was retrieved.
//
// POWER reprocesses historical data, so a series read from the on-disk cache can
// be a superseded revision of the record. The cache has no expiry by design, so
// that a figure benchmarked against a stored run stays reproducible; what makes
// that safe rather than dangerous is the run saying which it was.
type PowerSeriesProvenance struct {
	// "fetch", "cache", or "fetch_uncached".
	Source string `json:"source"`
	// Absent for a cached series written before the stamp was recorded.
	FetchedUTC *string `json:"fetched_utc"`
	Product    string  `json:"product"`
	CellKey    string  `json:"cell_key"`
	Period     string  `json:"period"`
	CacheFile  *string `json:"cache_file"`
	Note       string  `json:"note"`
}

// PowerProvenance carries the record for each temporal product a run read. Both
// are pointers: an action that reads only one leaves the other absent rather
// than reporting an empty record for a series it never asked for.
type PowerProvenance struct {
	Daily  *PowerSeriesProvenance `json:"daily,omitempty"`
	Hourly *PowerSeriesProvenance `json:"hourly,omitempty"`
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
	// Whether the series behind these figures was fetched or read from cache.
	// The sidecar emits this; dropping it here made the two indistinguishable
	// everywhere downstream.
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
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
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
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
	// Sky view factor: the diffuse counterpart of the shading above. The same
	// horizon answers both, so this costs nothing extra to report.
	SkyView *SolarSkyView `json:"sky_view,omitempty"`
	// Raster as a base64 PNG data URI, drawn on Scale.
	OverlayURI string `json:"overlay_uri"`
	RasterTIF  string `json:"raster_tif"`
	Extent     Bounds `json:"extent"`
	// Whether the series behind these figures was fetched or read from cache.
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
}

// SolarSkyView is how much of the sky dome the terrain leaves visible, and the
// threshold that decided whether the diffuse loss was worth applying.
//
// Reported whether or not it was applied: "not applied" and "applied at zero"
// are different statements about the terrain, and only the first means the
// question was never asked.
type SolarSkyView struct {
	Applied            bool     `json:"applied"`
	MeanHorizonDeg     float64  `json:"mean_horizon_deg"`
	MaxHorizonDeg      float64  `json:"max_horizon_deg"`
	ThresholdDeg       float64  `json:"threshold_deg"`
	DiffuseLossMeanPct *float64 `json:"diffuse_loss_mean_pct"`
	DiffuseLossMaxPct  *float64 `json:"diffuse_loss_max_pct"`
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
	SkyView         *SolarSkyView    `json:"sky_view,omitempty"`
	OverlayPNG      string           `json:"overlay_png"`
	RasterTIF       string           `json:"raster_tif"`
	Extent          Bounds           `json:"extent"`
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
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
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it
	// is OF, which is what lets a drawing and the runs over it be one subject
	// rather than two. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
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

// EnergyModelRequest selects an AOI for the photovoltaic energy model: the
// loss waterfall behind the performance ratio, the single-axis tracking
// comparison, the diurnal generation profile and the plant energy over the
// suitable area.
//
// "energy_model" is the sidecar action identifier, kept verbatim so the
// request, the payload key, the stored run and the exported manifest all name
// the same thing. It is not a claim about the method.
type EnergyModelRequest struct {
	AreaID           string           `json:"area_id"`
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

// WindRequest selects an AOI for wind resource screening. The reanalysis cell
// is 0.5 by 0.625 degrees, so the request resolves to the cell the AOI centroid
// falls in and the response reports that cell centre, not the centroid.
type WindRequest struct {
	AreaID         string           `json:"area_id"`
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
	Lon float64 `json:"lon"`
	Lat float64 `json:"lat"`
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

/*
CanopyFieldRequest asks for the leaf-area-density field of one orchard module.

The field is periodic: it covers a single spacing module and a ray leaving one
side returns on the opposite one, which represents a closed orchard without
replicating a tree. Source picks how the crowns are filled -- "ellipsoid"
computes them analytically and needs nothing beyond numpy, "helios" grows an
explicit plant and needs pyhelios3d, which the managed environment does not
carry. The two are not interchangeable: an ellipsoid preserving leaf area and
crown envelope intercepts markedly more light than the architecture it stands
in for, so the result reports which one produced it.
*/
// Geometry is carried by pointer, not by value with omitempty. Zero is a value
// a caller can mean here -- a crown centred at ground level is a hedgerow, and
// an LAI of zero is the bare module the against-uniform comparison is about --
// and `omitempty` on a float64 drops both, letting the sidecar substitute its
// own default. That is the pattern sidecar/infer.py:82-91 records as having
// silently moved four numeric parameters in this repository, one of which
// shifted every energy figure by 5.78 percent.
/*
CanopyFromAOIRequest reads an AOI's own vegetation-index series as a canopy.

The one request in this file that carries observation rather than parameters.
Everything else about a canopy is a choice the reader makes; this is what the
ground was measured to be, and the sowing it has to be read through.

Lat/Lon are optional and change the answer rather than decorating it: given, the
canopy is lit by the NASA POWER record for that cell -- real azimuths and
elevations weighted by the beam energy that arrived at each -- instead of by the
six reference suns, which exist to cross-validate a shader and are not sky.
*/
type CanopyFromAOIRequest struct {
	Species  string          `json:"species,omitempty"`
	VISeries []VIObservation `json:"vi_series"`
	// Sowing, which is what turns leaf area per plant into an LAI.
	InterRow   *float64 `json:"inter_row,omitempty"`
	InterPlant *float64 `json:"inter_plant,omitempty"`
	// The bearing the rows run on. Agronomy, not convention: rows laid
	// north-south intercept differently from rows laid east-west.
	RowAzimuthDeg *float64 `json:"row_azimuth_deg,omitempty"`
	Lat           *float64 `json:"lat,omitempty"`
	Lon           *float64 `json:"lon,omitempty"`
	Elevation     *float64 `json:"elevation,omitempty"`
	HourlyYears   int      `json:"hourly_years,omitempty"`
	Seed          *int     `json:"seed,omitempty"`
	// The classification's own reading of what grows here. The sidecar maps a
	// dominant class to a plantarchitecture species and, as importantly,
	// refuses: cane, coffee and eucalyptus have no plant in the library, and
	// the catch-all crop classes identify none.
	//
	// Without this field the guard on the far side was never true, so the
	// suggestion never fired and the species was always whatever the picker
	// held -- the classification and the simulation ran over the same ground
	// and never spoke. Species selects the architecture, which is the largest
	// single geometry choice in the run.
	ClassStats []ClassStat `json:"class_stats,omitempty"`
	// How many plants are drawn before the answer is reported as a band.
	// helios_grow draws stochastically, and on soybean at fixed LAI five seeds
	// spanned 0.096 in faPAR -- larger than the whole seasonal term. Zero
	// leaves the sidecar's default.
	NSeeds int `json:"n_seeds,omitempty"`
	// Half-width, in days, of the day-of-year window the solar record is
	// narrowed to around the lit date. Zero leaves the sidecar's default;
	// the sidecar treats a window wider than half a year as no window.
	SunWindowDays int `json:"sun_window_days,omitempty"`
}

// VIObservation is one acquisition's vegetation index over the AOI. Mirrors the
// shape VISeriesPoint already carries, so a run's series feeds this unchanged.
type VIObservation struct {
	Date     string  `json:"date"`
	NDVIMean float64 `json:"ndvi_mean"`
}

/*
CanopyFromAOI is the season read as canopies, and what each reading is worth.

TWO ANCHORS FOR THE AGE TRAVEL TOGETHER, and neither is chosen for the reader.
Leaf area gives one, phenology gives another, and AgeCheck holds their
comparison. Where they agree the isolated-plant model describes the field; where
they do not, the disagreement is the finding, because Helios grows a plant with
no neighbours and in a dense sowing reaches a given leaf area far too early.
*/
type CanopyFromAOI struct {
	Species      string  `json:"species"`
	Density      float64 `json:"density"`
	InterRow     float64 `json:"inter_row"`
	InterPlant   float64 `json:"inter_plant"`
	ReachableLAI float64 `json:"reachable_lai"`

	LAI       CanopyLAISeries    `json:"lai"`
	States    []string           `json:"states"`
	Phenology map[string]float64 `json:"phenology"`
	Resolved  []CanopyResolved   `json:"resolved"`
	NUsable   int                `json:"n_usable"`
	Sun       CanopySun          `json:"sun"`
	// Absent when no date could be lit -- no location, or nothing the ladder
	// could build.
	Light *CanopyLight `json:"light,omitempty"`
	// The cycles the window was split into. More than one means it covers more
	// than one crop -- safra and safrinha, or a crop followed by a cover -- and
	// every age above is then measured from its own cycle's green-up rather
	// than from the start of the record. The sidecar emitted these and no
	// field received them, so a reader could not tell a two-crop window from a
	// one-crop one.
	Cycles []CanopyCycle `json:"cycles,omitempty"`
	// What the classification suggested and why, including why it refused.
	SpeciesSuggestion *SpeciesSuggestion `json:"species_suggestion,omitempty"`
	// The dominant class's share of the AOI. The series above is an area mean,
	// and a mean over mixed cover is not the crop's index; this is how much of
	// it is the crop.
	CropFraction *float64 `json:"crop_fraction,omitempty"`
}

// CanopyCycle is one contiguous stretch of the series outside bare soil and
// fallow. Bare-soil stretches are not cycles: there is no canopy to date in
// them.
type CanopyCycle struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	Greenup string `json:"greenup"`
	N       int    `json:"n"`
}

// SpeciesSuggestion is the classification's reading, or its refusal. Species is
// empty when the dominant class has no plant in the library or does not
// identify one, and Why then says which of the two it was -- a refusal carrying
// its reason, rather than a silent fallback to the picker's default.
type SpeciesSuggestion struct {
	Species    string  `json:"species,omitempty"`
	ClassID    int     `json:"class_id,omitempty"`
	ClassName  string  `json:"class_name,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Why        string  `json:"why,omitempty"`
}

type CanopyLAISeries struct {
	NDVI          []float64          `json:"ndvi"`
	LAI           []float64          `json:"lai"`
	PeakLAI       float64            `json:"peak_lai"`
	N             int                `json:"n"`
	NSaturated    int                `json:"n_saturated"`
	SaturationLAI float64            `json:"saturation_lai"`
	Parameters    map[string]float64 `json:"parameters"`
}

// CanopyResolved is one observation: what it was, what age it implies, or why
// it implies none. Day is a pointer because a canopy past the plateau has no
// identifiable age, and zero would be a lie the front end could not detect.
type CanopyResolved struct {
	Date       string   `json:"date"`
	LAI        float64  `json:"lai"`
	State      string   `json:"state,omitempty"`
	Day        *float64 `json:"day,omitempty"`
	DayAtLeast *float64 `json:"day_at_least,omitempty"`
	HeightM    *float64 `json:"height_m,omitempty"`
	LeafAreaM2 *float64 `json:"leaf_area_m2,omitempty"`
	PlateauDay *float64 `json:"plateau_day,omitempty"`
	AtPlateau  bool     `json:"at_plateau,omitempty"`
	Declining  bool     `json:"declining,omitempty"`
	// Days since the series first left bare soil. The independent age.
	DaysSinceGreenup *float64       `json:"days_since_greenup,omitempty"`
	AgeCheck         CanopyAgeCheck `json:"age_check"`
	Why              string         `json:"why,omitempty"`
	Error            string         `json:"error,omitempty"`
}

// CanopyAgeCheck compares development PROGRESS and not days, because the two
// clocks run at different rates: Helios sorghum saturates at day 40 while a
// field season takes near a hundred days to peak, and subtracting one from the
// other mixes that with the competition it is meant to detect.
type CanopyAgeCheck struct {
	Comparable     bool     `json:"comparable"`
	ProgressHelios *float64 `json:"progress_helios,omitempty"`
	ProgressField  *float64 `json:"progress_field,omitempty"`
	DeltaProgress  *float64 `json:"delta_progress,omitempty"`
	Agrees         bool     `json:"agrees,omitempty"`
	Why            string   `json:"why,omitempty"`
}

type CanopySun struct {
	Source          string    `json:"source"`
	Cell            []float64 `json:"cell,omitempty"`
	Years           int       `json:"years,omitempty"`
	BeamEnergyTotal float64   `json:"beam_energy_total,omitempty"`
	NAzimuthBins    int       `json:"n_azimuth_bins,omitempty"`
	NElevationBins  int       `json:"n_elevation_bins,omitempty"`
	DiffuseShare    float64   `json:"diffuse_share,omitempty"`
	// WHICH SKY THIS IS. The record fetched is three whole years, and averaging
	// all of it gives the sun of no particular time, while this canopy is one
	// dated observation. WindowDays is the half-width of the day-of-year window
	// the record was narrowed to around WindowCentre; zero means the whole
	// record answered, which happens when no date resolved to an age.
	//
	// Measured on this cell: the month spans 0.0588 in faPAR at LAI 3, and the
	// whole-record average is wrong by up to 0.0367 for the worst month --
	// against 0.016 for the entire latitude range of Brazil. Before this the
	// panel captioned a three-year all-season sky with the observation's date.
	WindowDays   int    `json:"window_days,omitempty"`
	WindowCentre string `json:"window_centre,omitempty"`
	NHours       int    `json:"n_hours,omitempty"`
	// Whether the POWER record was fetched or read from cache, and which
	// revision. POWER reprocesses historical data, so a cached series can be a
	// superseded revision; every other POWER-reading surface in this app
	// renders this and the canopy panel was the one that could not.
	// One series and not the daily/hourly pair PowerProvenance carries: this
	// action reads the hourly record only.
	Provenance *PowerSeriesProvenance `json:"provenance,omitempty"`
	// THE SUN AS SOMETHING THAT CAN BE DRAWN, not only summed. Everything above
	// describes the sky as totals and bin counts, which a march consumes and a
	// viewer cannot; a scene handed only those has to invent a light, and the
	// picture then shows a sun that had nothing to do with the number beside it.
	Direction *SunDirection `json:"direction,omitempty"`
	// Global irradiance over its clear-sky reference across the window: 1.0 is
	// a cloudless record and the shortfall is cloud. Measured on the cell this
	// was developed against, a 21-day window runs 0.743 in February against
	// 0.927 in October -- the same site, two visibly different skies. Absent
	// when the record predates the clear-sky parameter.
	Clearness *float64 `json:"clearness,omitempty"`
	// One real day of the window, hour by hour, for a viewer that moves the sun
	// rather than fixing it.
	TrackDate string    `json:"track_date,omitempty"`
	Track     []SunHour `json:"track,omitempty"`
	// Why the reference suns were used instead, when they were.
	Why string `json:"why,omitempty"`
}

// SunDirection is the beam-energy-weighted mean direction, so a scene lit from
// it is lit by the same sun the faPAR came from. It is NOT solar noon and must
// not be captioned as such: it leans toward the hours that carried the energy.
//
// Concentration says how far a single direction represents the record at all.
// Near 1 the beam effectively arrived from one place; low means the energy was
// spread across the sky and one direction is a poor summary of it.
type SunDirection struct {
	AzimuthDeg    float64 `json:"azimuth_deg"`
	ElevationDeg  float64 `json:"elevation_deg"`
	Concentration float64 `json:"concentration"`
}

// SunHour is one hour of the representative day.
//
// HourUTC is named for its standard because assuming local places the sun three
// hours wrong for a Brazilian AOI: solar noon lands at 15h UTC on this
// project's own cell. A renderer should drive itself from azimuth and elevation
// and treat the hour as a caption.
type SunHour struct {
	HourUTC      int     `json:"hour_utc"`
	AzimuthDeg   float64 `json:"azimuth_deg"`
	ElevationDeg float64 `json:"elevation_deg"`
	DNI          float64 `json:"dni"`
	DHI          float64 `json:"dhi"`
	GHI          float64 `json:"ghi"`
	// Already divided and already clamped, so a consumer never computes
	// DHI/GHI itself. That ratio is not bounded by 1 in the POWER record: it
	// reaches 1.531 over three years on this project's cell and 4.2 percent of
	// daylight hours exceed 1, all at a median elevation of 3.3 degrees, where
	// POWER's own components do not close. Absent for an hour with no global.
	DiffuseShare *float64 `json:"diffuse_share,omitempty"`
	Clearness    *float64 `json:"clearness,omitempty"`
}

// CanopyLight is the canopy marched under that sun. FixedKErrorPct is the
// number a crop-model reader has a question about: how far Beer with a constant
// coefficient lands from what this canopy actually intercepted.
type CanopyLight struct {
	Date                 string   `json:"date,omitempty"`
	Day                  *float64 `json:"day,omitempty"`
	LAI                  float64  `json:"lai"`
	FaPAR                float64  `json:"fapar"`
	Transmittance        float64  `json:"transmittance"`
	BeamTransmittance    float64  `json:"beam_transmittance"`
	DiffuseTransmittance *float64 `json:"diffuse_transmittance,omitempty"`
	DiffuseShare         float64  `json:"diffuse_share"`
	KEmergent            *float64 `json:"k_emergent,omitempty"`
	FaPARFixedK          *float64 `json:"fapar_fixed_k,omitempty"`
	FixedK               float64  `json:"fixed_k,omitempty"`
	FixedKErrorPct       *float64 `json:"fixed_k_error_pct,omitempty"`
	BeamBinsMarched      int      `json:"beam_bins_marched,omitempty"`
	RowAzimuthDeg        float64  `json:"row_azimuth_deg,omitempty"`
	// The fraction of the module's ground that has leaf above it. The one
	// geometric number that tracks the answer: measured at fixed LAI, sweeping
	// the canopy's horizontal extent moves faPAR 0.19 to 0.88 and faPAR follows
	// cover almost proportionally, while sweeping its HEIGHT over a factor of
	// 2.4 moves it 0.020. Carried so a reader with an observed cover -- which a
	// nadir view gives cheaply, and which needs no 3D reconstruction -- can
	// check the simulated canopy against the field's.
	Cover float64 `json:"cover,omitempty"`
	Seed  int     `json:"seed,omitempty"`
	// The spread across the plants that were drawn. Absent only on error.
	Ensemble *CanopyEnsemble `json:"ensemble,omitempty"`
	Error    string          `json:"error,omitempty"`
}

/*
CanopyEnsemble is how far apart the drawn plants landed.

WHY A POINT ESTIMATE WAS THE WRONG SHAPE. helios_grow draws a plant
stochastically, and the draw is not a rounding detail: on soybean at 55 days
with everything else held -- same species, same age, same sowing, leaf area
rescaled to an identical LAI so only shape could differ -- five seeds spanned
faPAR 0.703 to 0.799. That 0.096 is larger than the whole seasonal term and
three times a 20% error in the LAI the inversion works so hard to recover, and
the surface was printing three decimals of a number whose own spread lands in
the second.

No data buys this away. It is the model's own variance and can only be sampled,
so the honest form of the same computation is a band.
*/
type CanopyEnsemble struct {
	N           int     `json:"n"`
	FaPARMin    float64 `json:"fapar_min"`
	FaPARMax    float64 `json:"fapar_max"`
	FaPARSpread float64 `json:"fapar_spread"`
	CoverMin    float64 `json:"cover_min"`
	CoverMax    float64 `json:"cover_max"`
	// In faPAR order, so the ends of the band can be reproduced.
	Seeds []int `json:"seeds"`
}

/*
CanopyMeshRequest asks for a stand of plants as geometry.

Distinct from CanopyFieldRequest and not a variant of it. The field is a
leaf-area density on a voxel grid, which holds no leaf to draw; this grows
plants and keeps their triangles. The two answer different questions, and the
only thing they share is a species name.

Organs selects what comes back. Sorghum fruit is a third of the triangles of a
grown stand, and nobody asking to see a canopy means the panicle, so leaving it
empty asks for the vegetative structure.
*/
type CanopyMeshRequest struct {
	Species    string   `json:"species,omitempty"`
	Days       int      `json:"days,omitempty"`
	Rows       int      `json:"rows,omitempty"`
	PerRow     int      `json:"per_row,omitempty"`
	InterRow   *float64 `json:"inter_row,omitempty"`
	InterPlant *float64 `json:"inter_plant,omitempty"`
	Seed       *int     `json:"seed,omitempty"`
	Organs     []string `json:"organs,omitempty"`
}

/*
CanopyMesh is a grown stand, as glTF plus what it is made of.

The mesh crosses as base64 for the reason the field does: it is a binary the
webview consumes directly, and the sidecar's work dir is removed by the time the
front end asks for it. LeafArea is Helios's own figure for the stand, so a
reader can tell this is the canopy a field would have been built from.
*/
type CanopyMesh struct {
	// The bytes themselves never cross the bridge: the app holds them and the
	// front end fetches URL. `json:"-"` is what keeps them out of a bound
	// method's reply, which is where a megabyte-scale string overflowed the
	// webview's stack before any of this application's code ran.
	Data []byte `json:"-"`
	URL  string `json:"url"`

	Bytes      int            `json:"bytes"`
	Species    string         `json:"species"`
	Days       int            `json:"days"`
	Plants     int            `json:"plants"`
	Rows       int            `json:"rows"`
	PerRow     int            `json:"per_row"`
	InterRow   float64        `json:"inter_row"`
	InterPlant float64        `json:"inter_plant"`
	LeafArea   float64        `json:"leaf_area"`
	Organs     map[string]int `json:"organs"`
}

type CanopyFieldRequest struct {
	Source  string   `json:"source,omitempty"`
	Spacing *float64 `json:"spacing,omitempty"`
	LAI     *float64 `json:"lai,omitempty"`
	Cell    *float64 `json:"cell,omitempty"`
	CrownA  *float64 `json:"crown_a,omitempty"`
	CrownB  *float64 `json:"crown_b,omitempty"`
	CrownZ  *float64 `json:"crown_z,omitempty"`
	// Rows only. A field of soy or maize is a strip of vegetation repeating
	// every spacing, not a set of crowns: all the module's leaf area lives
	// inside the strips, which is what Beer's law over the whole field misses.
	Height       *float64 `json:"height,omitempty"`
	RowWidthFrac *float64 `json:"row_width_frac,omitempty"`
	Base         *float64 `json:"base,omitempty"`
	// Helios only. Ignored when the crowns are ellipsoids.
	Species string `json:"species,omitempty"`
	Days    int    `json:"days,omitempty"`
	Seed    *int   `json:"seed,omitempty"`
	// How many points the reference cases evaluate. Raising it costs one
	// march per point and nothing at draw time.
	NReference int `json:"n_reference,omitempty"`
}

// CanopyFieldMeta describes the grid the march reads.
//
// Occupancy and the in-crown density are here because they are what explains a
// transmittance: the same leaf area concentrated into a tenth of the volume
// passes far more light than spread through all of it, Beer-Lambert being
// non-linear in density, and a surface reporting only LAI cannot say why two
// canopies of equal LAI differ.
type CanopyFieldMeta struct {
	Source         string  `json:"source"`
	Spacing        float64 `json:"spacing"`
	Cell           float64 `json:"cell"`
	ZTop           float64 `json:"z_top"`
	NXY            int     `json:"n_xy"`
	NZ             int     `json:"n_z"`
	LAI            float64 `json:"lai"`
	LeafArea       float64 `json:"leaf_area"`
	Occupancy      float64 `json:"occupancy"`
	DensityInCrown float64 `json:"density_in_crown"`
	Bytes          int     `json:"bytes"`
	CrownA         float64 `json:"crown_a,omitempty"`
	CrownB         float64 `json:"crown_b,omitempty"`
	CrownZ         float64 `json:"crown_z,omitempty"`
	Leaves         int     `json:"leaves,omitempty"`
	RowWidth       float64 `json:"row_width,omitempty"`
	RowWidthFrac   float64 `json:"row_width_frac,omitempty"`
	Height         float64 `json:"height,omitempty"`
	Base           float64 `json:"base,omitempty"`
}

// CanopyReferenceSun is one solar direction and what the numpy march answered
// for it at every reference point.
type CanopyReferenceSun struct {
	CosZenith     float64   `json:"cos_zenith"`
	Azimuth       float64   `json:"azimuth"`
	Why           string    `json:"why"`
	Direction     []float64 `json:"direction"`
	Transmittance []float64 `json:"transmittance"`
}

/*
CanopyReference is what a second implementation of the march has to reproduce.

The shading in the viewport marches this same field in GLSL, which makes the
shader a second implementation of sidecar/canopy_voxel.py. Two implementations
of one numerical method drift unless something compares them, and this
repository has already shipped a hand-copied table that drifted on every stop
while nothing failed. These are the numbers frontend/scripts/check-canopy-shader.ts
holds the shader to.
*/
type CanopyReference struct {
	Points   [][]float64 `json:"points"`
	StepFrac float64     `json:"step_frac"`
	GLeaf    float64     `json:"g_leaf"`
	// Every parameter the march reads travels, MaxPath included. It changes the
	// answer, and leaving it for the consumer to hard-code is the hand-copied
	// constant this payload exists to prevent -- the divergence would be
	// invisible on any field whose longest path is under both values.
	MaxPath   float64              `json:"max_path"`
	MaxSteps  int                  `json:"max_steps"`
	Tolerance float64              `json:"tolerance"`
	Suns      []CanopyReferenceSun `json:"suns"`
}

// CanopyAgainstUniform contrasts the field with a uniform canopy of the same
// leaf area -- the null model, and the reason for voxelising anything.
type CanopyAgainstUniform struct {
	CosZenith float64 `json:"cos_zenith"`
	Field     float64 `json:"field"`
	Uniform   float64 `json:"uniform"`
	// What the canopy intercepts, and what a crop model holding one fitted
	// extinction coefficient would have said instead. KEmergent inverts Beer
	// on the resolved answer (Braud et al. 2026, eq. 29); it is null where
	// there is too little leaf to invert or the canopy is closed.
	FAPAR       float64  `json:"fapar"`
	FAPARFixedK float64  `json:"fapar_fixed_k"`
	KEmergent   *float64 `json:"k_emergent"`
	FixedK      float64  `json:"fixed_k"`
	// Signed, and the sign is the finding: it changes within a single day,
	// which a fixed coefficient cannot express.
	FixedKErrorPct *float64 `json:"fixed_k_error_pct"`
	// Null where the uniform canopy underflows to zero, which happens at high
	// LAI and a low sun. Not NaN: json.dumps writes NaN and Infinity as bare
	// tokens and encoding/json refuses both, discarding an otherwise complete
	// payload with a message about a character.
	Ratio *float64 `json:"ratio"`
}

// CanopyGrown records what Helios produced, when Helios produced it.
type CanopyGrown struct {
	LeafArea      float64  `json:"leaf_area"`
	Reported      float64  `json:"reported"`
	RelativeError float64  `json:"relative_error"`
	Organs        []string `json:"organs"`
}

/*
CanopyField is the field plus everything needed to check what reads it.

FieldBase64 carries the grid itself as little-endian float32 in the Python
index order (ix, iy, iz), C-contiguous. It is base64 rather than a path because
the consumer is a webview that uploads it to a 3D texture: a path would have to
be served, and the grids are small -- a 27x27x16 field is 47 kB. The transpose
into texture axis order happens in the frontend, next to the texelFetch whose
axis order it exists to satisfy.
*/
type CanopyField struct {
	Field          CanopyFieldMeta        `json:"field"`
	FieldBase64    string                 `json:"field_base64"`
	Reference      CanopyReference        `json:"reference"`
	AgainstUniform []CanopyAgainstUniform `json:"against_uniform"`
	Grown          *CanopyGrown           `json:"grown,omitempty"`
}
