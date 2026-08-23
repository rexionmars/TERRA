package analysis

// Flood envelope: a HAND extent and the disagreement between the DEM products
// it can be derived from.
//
// The product is the extent WITH its envelope and never the extent alone. The
// study this ports found that a HAND mask is not reproducible across DEM
// products, so a single mask is a shape chosen by a DEM the user never picked
// and is never shown. The central representation is therefore an agreement
// count raster -- for each cell, how many products call it flooded at the
// reference threshold -- because a mask with an accuracy figure beside it
// cannot say WHERE the products disagree, which is the one thing measured.
//
// WHAT THE FIGURES COVER IS NOT WHAT THE CHAIN RAN OVER. HAND needs the
// contributing area upstream of a cell, so the DEM is read BufferM beyond the
// AOI and the whole terrain chain runs on that buffered window. Every count,
// area, fraction and index in this payload is nevertheless taken over the cells
// inside the AOI polygon, reported in AOI. The window survives as provenance
// only -- Grid, CellSizeM, BufferM and the AOI.Window* pair -- because a figure
// measured over it answers a question nobody asked: on one observed run a 277
// by 291 window of 30.8 m cells put class areas summing to 76.2 km2 on screen
// against an AOI of about 20 km2, every one of them inflated by a buffer that
// exists for numerical reasons alone.
//
// Every field here was read off a recorded payload,
// internal/research/testdata/flood_b.json, rather than predicted from the
// contract text; where the two differed the recording is what is mirrored.

// FloodRequest selects an AOI for the flood envelope.
//
// The parameters are pointers because absence is what selects the sidecar's
// default -- infer.action_flood_envelope reads a missing key as "choose for
// me" -- and zero is a legitimate request for three of them: a reference
// threshold of 0 m asks for the drainage surface itself, a buffer of 0 m for
// exactly the AOI, an inset margin of 0 cells for no inset ring. A plain
// float64 would send each of those defaults as an explicit zero.
type FloodRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// The products to compare, by dem.COLLECTIONS id. Empty selects the
	// four-product default set. Fewer than two the sidecar refuses: one product
	// yields an extent with no measure of how much of it the product chose,
	// which is the shape this analysis exists not to ship.
	DEMIDs []string `json:"dem_ids,omitempty"`
	// The HAND thresholds in metres to sweep. Empty selects the study's sweep.
	ThresholdsM []float64 `json:"thresholds_m,omitempty"`
	// The threshold the agreement raster is built at. It need not appear in
	// ThresholdsM; the sidecar adds it to the sweep when it does not.
	ReferenceThresholdM *float64 `json:"reference_threshold_m,omitempty"`
	// Contributing area above which a cell counts as drainage. Zero is refused:
	// it would make every cell drainage, HAND zero everywhere and the extent
	// the whole window at every threshold.
	DrainageKm2 *float64 `json:"drainage_km2,omitempty"`
	// How far beyond the AOI to read each DEM, so drainage entering the AOI is
	// real terrain rather than a truncated slope.
	BufferM *float64 `json:"buffer_m,omitempty"`
	// Ring cut from inside the AOI for the inset statistics. The key is
	// inset_margin_cells and not the edge_margin_cells this once sent: the ring
	// used to be taken off the computed window, the sidecar now takes it off the
	// AOI polygon, and it refuses the old key by name rather than accept a
	// number that would describe a different ring than the one reported back.
	InsetMarginCells *int   `json:"inset_margin_cells,omitempty"`
	Label            string `json:"label,omitempty"`
	RunLabel         string `json:"run_label,omitempty"`
	ProjectID        string `json:"project_id,omitempty"`
	// AoiID is the catalogued area this run belongs to, when the caller has
	// one. The polygon says where the run was made; this says which area it is
	// OF. See store.InferenceRun.AoiID.
	AoiID string `json:"aoi_id,omitempty"`
}

// FloodCellSize is the ground size of one grid cell in metres, evaluated at the
// centre latitude of the window. Every area in this payload is a cell count
// times this, not a projected-area calculation, so the two differ by the
// convergence of the meridians across the window.
type FloodCellSize struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// FloodGrid is the window the terrain chain ran on, which is provenance and not
// the reporting extent.
//
// This is the AOI PLUS FloodAnalysis.BufferM on each side, less the border cells
// trimmed to reach a rectangle every product covers. Nothing in this payload is
// measured over it -- see FloodAOI, which is -- and Bounds is the placement of
// FloodAnalysis.AgreementTIF alone. Reading a figure against these cells is how
// a 4.5 km2 AOI came to be reported as 37.5 km2 of classified ground.
type FloodGrid struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bounds Bounds `json:"bounds"`
}

// FloodAOI is the ground every figure in this payload is measured over: the
// cells whose centre falls inside the AOI polygon.
//
// It carries the computed window beside itself because either number alone
// misleads. AreaKm2 alone hides that the terrain was solved over more ground
// than is reported, which is what makes the areas trustworthy; WindowAreaKm2
// alone is the figure that used to be on screen. A cell is in or out by its
// centre, so AreaKm2 and the polygon's own area differ by at most a half cell
// along the boundary.
type FloodAOI struct {
	Cells   int     `json:"cells"`
	AreaKm2 float64 `json:"area_km2"`
	// Cells left after FloodAnalysis.InsetMarginCells is cut from the polygon,
	// which is the denominator of every inset index.
	InsetCells int `json:"inset_cells"`
	// The buffered window the chain ran over. Recorded at 43848 cells against
	// the AOI's 5256 on the payload this was read from: the report covers 12
	// percent of the ground the chain saw.
	WindowCells   int     `json:"window_cells"`
	WindowAreaKm2 float64 `json:"window_area_km2"`
	FracOfWindow  float64 `json:"frac_of_window"`
}

// FloodProduct is one DEM product's extent at the reference threshold, counted
// inside the AOI polygon. AreaFrac is of FloodAOI.Cells and not of the window,
// so it is a share of the ground the reader drew.
type FloodProduct struct {
	ID         string `json:"id"`
	Collection string `json:"collection"`
	// Pointers because the sidecar distinguishes unknown from known here: a
	// null means the caller did not record the fact. Decoded into a plain
	// float64 and bool a null arrives as 0 m and "not resampled", both of which
	// read as measurements rather than as absences.
	NativeResolutionM *float64 `json:"native_resolution_m"`
	Resampled         *bool    `json:"resampled"`
	Cells             int      `json:"cells"`
	AreaKm2           float64  `json:"area_km2"`
	AreaFrac          float64  `json:"area_frac"`
}

// FloodAgreement summarises the agreement count raster over the AOI: unanimous
// cells are where the terrain decides the extent, contested cells are where the
// choice of DEM decides it.
type FloodAgreement struct {
	// AOI cells at each agreement level, indexed by how many products call the
	// cell flooded, so it carries one more entry than there are products and
	// sums to FloodAOI.Cells -- not to Grid.Width times Grid.Height.
	//
	// Counts[0] closes that accounting and is not a level of agreement: that no
	// product calls a cell flooded says nothing about how far the products
	// agree with each other, and a legend listing it as a class beside the
	// others flattens the one distinction this analysis draws. It is
	// UnanimousDryKm2, the dry remainder of the AOI.
	Counts          []int   `json:"counts"`
	UnanimousWetKm2 float64 `json:"unanimous_wet_km2"`
	ContestedKm2    float64 `json:"contested_km2"`
	UnanimousDryKm2 float64 `json:"unanimous_dry_km2"`
	// contested / (contested + unanimous wet). Null when no product calls
	// anything wet: there is no extent to take a share of, and 0.0 would read
	// as agreement.
	ContestedFracOfWet *float64 `json:"contested_frac_of_wet"`
}

// FloodPair is two products compared at one threshold, over the AOI polygon.
//
// IoU is the Jaccard index between the two binary extents. For a binary mask it
// is numerically the critical success index (CSI) of the flood literature, and
// a reader from hydrology looks for that name.
type FloodPair struct {
	DEMA       string  `json:"dem_a"`
	DEMB       string  `json:"dem_b"`
	ThresholdM float64 `json:"threshold_m"`
	// Null when both extents are empty. The index is undefined over an empty
	// union, and 0 would state total disagreement between two products that
	// agree the AOI is dry.
	IoU *float64 `json:"iou"`
	// The same over the AOI shrunk by FloodAnalysis.InsetMarginCells. The ring
	// is cut from the polygon and not from the computed window, which the
	// buffer already puts outside every figure here. What it tests is
	// unchanged: whatever drains in from beyond the buffer is missing for the
	// cells nearest the AOI boundary first, so there HAND reads high and the
	// extent small, and a large gap from IoU says the disagreement sits at the
	// edge of the reported area rather than through the middle of it.
	IoUInset *float64 `json:"iou_inset"`
	// Null when A has no wet cell at this threshold, rather than a ratio over a
	// denominator of one cell, which would report the fact as 1.0.
	AreaRatioBOverA *float64 `json:"area_ratio_b_over_a"`
	// Whether either side was moved onto the shared grid before its terrain
	// chain ran. True rows carry a method component alongside the terrain
	// difference, quantified in FloodAssumptions.ChainGrid; only the false rows
	// are a comparison of terrain alone. Null means the fact was not recorded,
	// which is not the same as false.
	Resampled *bool `json:"resampled"`
}

// FloodEnvelopeRow is the range the products span at one threshold: the
// narrowest and widest pairwise agreement. Null throughout when no pair yielded
// a defined index there.
type FloodEnvelopeRow struct {
	ThresholdM  float64  `json:"threshold_m"`
	IoUMin      *float64 `json:"iou_min"`
	IoUMax      *float64 `json:"iou_max"`
	IoUMinInset *float64 `json:"iou_min_inset"`
	IoUMaxInset *float64 `json:"iou_max_inset"`
}

// FloodAssumptions is every default the figures rest on, where it came from,
// and what is left out. Prose written by the sidecar and carried verbatim: each
// entry names the choice and states what moves if it changes.
type FloodAssumptions struct {
	DrainageThreshold  string `json:"drainage_threshold"`
	ReferenceThreshold string `json:"reference_threshold"`
	Thresholds         string `json:"thresholds"`
	// Which cells the figures are taken over, in the numbers of this run: the
	// AOI against the buffered window the chain solved. It has to travel with
	// any area quoted from this payload, because an area is a figure a reader
	// attributes to ground and this names which ground.
	ReportingExtent string `json:"reporting_extent"`
	InsetMargin     string `json:"inset_margin"`
	CellSize        string `json:"cell_size"`
	Alignment       string `json:"alignment"`
	Buffer          string `json:"buffer"`
	// Which raster covers what. The GeoTIFF is the whole computed window and
	// the PNG is the AOI clip, so the two are not the same picture and a reader
	// who takes the GeoTIFF into a GIS sees ground no figure here describes.
	Rasters string `json:"rasters"`
	// The order the chain ran in, and its measured cost. Every product ran HAND
	// on the shared grid, so a coarser product was resampled before the chain
	// rather than after; the sidecar measured the two orders at IoU 0.47 for
	// the 90 m product against 0.95 for a 30 m one, over one window (n=1). That
	// is the same size as the disagreement this product exists to report, so
	// the string has to travel wherever a resampled pair's figure does.
	ChainGrid string   `json:"chain_grid"`
	Excluded  []string `json:"excluded"`
}

// FloodAnalysis is the flood envelope over one AOI: the HAND extent per DEM
// product, the agreement between them, and the raster that says where they
// disagree.
//
// The envelope is TERRA's own measurement over the products it reads from
// Microsoft Planetary Computer. It is not the range published by the study this
// ports, which measured a different product set from a different catalogue, and
// Qualifier says so in the words that must travel with any figure taken from
// here.
type FloodAnalysis struct {
	ReferenceThresholdM float64       `json:"reference_threshold_m"`
	ThresholdsM         []float64     `json:"thresholds_m"`
	DrainageKm2         float64       `json:"drainage_km2"`
	CellSizeM           FloodCellSize `json:"cell_size_m"`
	// Provenance: the window the chain ran on. AOI is what the figures cover.
	Grid             FloodGrid          `json:"grid"`
	BufferM          float64            `json:"buffer_m"`
	AOI              FloodAOI           `json:"aoi"`
	Products         []FloodProduct     `json:"products"`
	Agreement        FloodAgreement     `json:"agreement"`
	Pairs            []FloodPair        `json:"pairs"`
	Envelope         []FloodEnvelopeRow `json:"envelope"`
	InsetMarginCells int                `json:"inset_margin_cells"`
	Qualifier        string             `json:"qualifier"`
	Assumptions      FloodAssumptions   `json:"assumptions"`
	// The agreement counts as a single-band uint8 GeoTIFF, georeferenced on
	// exactly Grid.Bounds -- the whole computed window, buffer included, which
	// is the chain's own output and what a reader re-running the analysis
	// needs. A path rather than bytes: 4e4 to 4e6 cells as JSON numbers is
	// megabytes through the pipe, and this file is what a reader takes into a
	// GIS. It lives in the run's work directory, which AnalyzeFlood deliberately
	// does not remove.
	AgreementTIF string `json:"agreement_tif"`
	// The same counts rendered for display, clipped to the AOI bounding box with
	// every cell outside the polygon transparent, so the overlay covers what the
	// figures cover. A server-side path, kept because it is what AgreementURI
	// was read from and what says the rendering exists; the interface cannot
	// open it.
	AgreementPNG string `json:"agreement_png"`
	// Where AgreementPNG goes on the map. The bounds of that clipped image
	// ALONE: Grid.Bounds is the buffered window and placing the clip on it
	// stretches the overlay over several times the ground it covers, which is
	// the same mistake in pixels that reporting over the window was in numbers.
	// Same field shape as WaterAnalysis.Extent, so one placement path serves
	// both.
	Extent Bounds `json:"extent"`
	// AgreementPNG as a data URI, which is how every raster this program draws
	// reaches the webview: the interface is served from its own origin and
	// cannot load a path on disk. Added by AnalyzeFlood and not by the sidecar.
	// Empty when the rendering could not be read, in which case the numbers
	// still stand and only the map is missing.
	AgreementURI string `json:"agreement_uri,omitempty"`
}

// NDates reports the number of dates behind the envelope, which is zero.
//
// Not a value left unfilled: this product has no time dimension to report. HAND
// is a static terrain index, the DEM products were acquired years apart, and
// Assumptions.Excluded states that the terrain is treated as unchanged between
// them. Returning the product count instead would file four DEMs under the
// column every other run kind fills with observation dates, where a reader
// would take them for scenes.
func (f *FloodAnalysis) NDates() int { return 0 }

// NormalizeNilSlices replaces every nil slice with an empty one, for the reason
// given on EnergyModelAnalysis.NormalizeNilSlices.
func (f *FloodAnalysis) NormalizeNilSlices() {
	if f.ThresholdsM == nil {
		f.ThresholdsM = []float64{}
	}
	if f.Products == nil {
		f.Products = []FloodProduct{}
	}
	if f.Agreement.Counts == nil {
		f.Agreement.Counts = []int{}
	}
	if f.Pairs == nil {
		f.Pairs = []FloodPair{}
	}
	if f.Envelope == nil {
		f.Envelope = []FloodEnvelopeRow{}
	}
	if f.Assumptions.Excluded == nil {
		f.Assumptions.Excluded = []string{}
	}
}
