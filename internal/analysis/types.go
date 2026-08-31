package analysis

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
	// PolygonGeoJSON is the ground to run over, and the only way a request
	// names one.
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
	// AreaID is the ground this run is OF: a row in `areas`, inside the project
	// the run is filed under. The polygon says where the run was made; this
	// says which area it belongs to, which is what lets an area and the runs
	// over it be one subject rather than two.
	AreaID string `json:"area_id,omitempty"`
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

// LibraryBand is one band of a reference spectrum from a spectral library.
type LibraryBand struct {
	Band         string  `json:"band"`
	WavelengthNM float64 `json:"wavelength_nm"`
	Reflectance  float64 `json:"reflectance"`
}

// LibraryReference names the material a comparison is made against.
//
// Level is the field that decides how the result may be read. A leaf-level
// reference against a canopy pixel cannot identify a material, however small
// the angle, because the two are not measurements of the same thing.
type LibraryReference struct {
	Material  string        `json:"material"`
	Source    string        `json:"source"`
	PackageID string        `json:"package_id"`
	NSpectra  int           `json:"n_spectra"`
	Level     string        `json:"level"`
	Note      string        `json:"note"`
	Bands     []LibraryBand `json:"bands"`
}

// LibraryClassBand is one band of one class, beside the reference.
type LibraryClassBand struct {
	Band         string  `json:"band"`
	WavelengthNM float64 `json:"wavelength_nm"`
	Canopy       float64 `json:"canopy"`
	Leaf         float64 `json:"leaf"`
	// Canopy over leaf. A CONSTANT ratio would be brightness alone, which the
	// angle ignores; it is the variation that makes the difference structural.
	Ratio *float64 `json:"ratio"`
	// The unit vectors the angle actually compares.
	UnitCanopy *float64 `json:"unit_canopy"`
	UnitLeaf   *float64 `json:"unit_leaf"`
}

// LibraryClass is one predicted class measured against the reference.
type LibraryClass struct {
	ClassID  int                `json:"class_id"`
	Name     string             `json:"name"`
	Color    string             `json:"color"`
	AngleRad float64            `json:"angle_rad"`
	Bands    []LibraryClassBand `json:"bands"`
}

// LibraryLimit is the cross-reference against a spectral library, and the
// limit that comparison runs into.
//
// Classes are ordered by angle, closest first, and the ordering is the point:
// on the data this was built against the class named Soybean is not the one
// closest to the soybean reference. That is not a classification error. The
// library is leaf level and the pixel is canopy, with soil through the gaps
// and shadow between rows, so a small angle here means CONSISTENCY and never
// identification. Nothing that renders this may label it otherwise.
type LibraryLimit struct {
	Reference LibraryReference `json:"reference"`
	SceneDate string           `json:"scene_date"`
	Classes   []LibraryClass   `json:"classes"`
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
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	MapBiomasPath  string           `json:"mapbiomas_path,omitempty"`
}

// DataCubeRequest lists Sentinel-2 scenes for an AOI before Classify.
type DataCubeRequest struct {
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
	LibraryLimit      *LibraryLimit         `json:"library_limit,omitempty"`
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
	ClassSpectra *ClassSpectra `json:"class_spectra,omitempty"`
	// The same spectra measured against a spectral library. Absent wherever
	// ClassSpectra is, and on runs saved before the comparison existed.
	LibraryLimit *LibraryLimit   `json:"library_limit,omitempty"`
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
	// The flood envelope. Terrain only: it needs no scene and no time series,
	// so like the solar products it can be present over an AOI that carries no
	// classification at all.
	Flood *FloodAnalysis `json:"flood,omitempty"`
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
	AoiLabel       string `json:"aoi_label"`
	PolygonGeoJSON string `json:"polygon_geojson"` // raw GeoJSON geometry or Feature
}

// WaterRequest selects an AOI and period for surface water / flood mapping.
type WaterRequest struct {
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
	// AreaID is the ground this run is OF: a row in `areas`, inside the project
	// the run is filed under. The polygon says where the run was made; this
	// says which area it belongs to, which is what lets an area and the runs
	// over it be one subject rather than two.
	AreaID string `json:"area_id,omitempty"`
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
	// The row this run was recorded as, or empty where it was not recorded.
	//
	// saveRun withdraws its claim to have saved by returning nothing -- see the
	// comment there for the three failures that reach it -- and until this field
	// existed the withdrawal had nowhere to go. The frontend told the reader the
	// run was saved either way, which is the one thing that comment says must
	// not happen.
	RunID           string      `json:"run_id,omitempty"`
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
	// AreaID is the ground this run is OF: a row in `areas`, inside the project
	// the run is filed under. The polygon says where the run was made; this
	// says which area it belongs to, which is what lets an area and the runs
	// over it be one subject rather than two.
	AreaID string `json:"area_id,omitempty"`
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
	// The row this run was recorded as, or empty where it was not recorded.
	//
	// saveRun withdraws its claim to have saved by returning nothing -- see the
	// comment there for the three failures that reach it -- and until this field
	// existed the withdrawal had nowhere to go. The frontend told the reader the
	// run was saved either way, which is the one thing that comment says must
	// not happen.
	RunID    string        `json:"run_id,omitempty"`
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
	// AreaID is the ground this run is OF: a row in `areas`, inside the project
	// the run is filed under. The polygon says where the run was made; this
	// says which area it belongs to, which is what lets an area and the runs
	// over it be one subject rather than two.
	AreaID string `json:"area_id,omitempty"`
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
	RunID        string  `json:"run_id,omitempty"`
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
	// AreaID is the ground this run is OF: a row in `areas`, inside the project
	// the run is filed under. The polygon says where the run was made; this
	// says which area it belongs to, which is what lets an area and the runs
	// over it be one subject rather than two.
	AreaID string `json:"area_id,omitempty"`
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
	RunID   string             `json:"run_id,omitempty"`
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

// VIObservation is one acquisition's vegetation index over the AOI. Mirrors the
// shape VISeriesPoint already carries, so a run's series feeds this unchanged.
type VIObservation struct {
	Date     string  `json:"date"`
	NDVIMean float64 `json:"ndvi_mean"`
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
