package analysis

/*
The surface model as a subject of its own.

Copernicus GLO-30 is already read by two products here -- solar.py for
horizons, dem.py for the flood envelope -- and in both it is an input nobody
looks at. Every terrain figure in this application rests on ground the reader
cannot see. This is that ground, and nothing else: no index, no threshold, no
model.

IT IS A SURFACE MODEL, AND THE PAYLOAD SAYS SO. GLO-30 is TanDEM-X and measures
the first reflective surface, so closed forest reports canopy top and built
ground reports roofs. Everything downstream inherits it -- HAND over a DSM in
forest carries canopy height into the height above drainage -- and ModelKind
is where a reader meets that fact rather than inferring it.
*/

// SurfaceModelRequest asks for the surface over one area.
//
// No period and no cloud limit: GLO-30 is a single static product, not a stack
// of acquisitions, so there is nothing to select between.
type SurfaceModelRequest struct {
	AreaID         string           `json:"area_id"`
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	AoiLabel       string           `json:"aoi_label"`
	RunLabel       string           `json:"run_label"`
	ProjectID      string           `json:"project_id"`
	AoiID          string           `json:"aoi_id"`
}

// SurfaceModel is the elevation over one area, as values rather than as a
// picture of values.
type SurfaceModel struct {
	// The row this run was recorded as, or empty where it was not recorded.
	// saveRun withdraws its claim to have saved by returning nothing.
	RunID string `json:"run_id,omitempty"`
	// "DSM". Stated rather than implied: the distinction from a terrain model
	// is the single most consequential thing about this product.
	ModelKind string `json:"model_kind"`
	// The catalogue collection, named so a figure can be attributed.
	Source string `json:"source"`
	// Metres per cell as the product is published, before any resampling.
	NativeResolutionM float64 `json:"native_resolution_m"`
	// Where the raster goes on the map.
	Extent Bounds `json:"extent"`
	// The window's own floor and ceiling, in metres. A decoded value v from the
	// raster is FloorM + v * ReliefM / ValueFullScale; the map needs all three
	// and none can be guessed from the image.
	FloorM         float64 `json:"floor_m"`
	CeilingM       float64 `json:"ceiling_m"`
	ReliefM        float64 `json:"relief_m"`
	MeanM          float64 `json:"mean_m"`
	ValueFullScale float64 `json:"value_full_scale"`
	// How much of the window is measurement and how much is void fill. Reported
	// rather than silently dropped: a window that is half void has a mean that
	// describes half a place.
	MeasuredCells int `json:"measured_cells"`
	VoidCells     int `json:"void_cells"`
	// What a reader has to know to read the figures. Carried as text from the
	// sidecar so the statement and the computation cannot drift apart.
	Notes []string `json:"notes"`
	// The elevation as three bytes per cell, positional base-256, which
	// frontend/src/components/map/scalarTiles.ts decodes. A server-side path,
	// like the flood rasters; the interface cannot open it.
	ValuesPNG string `json:"values_png"`
	// ValuesPNG as a data URI, which is how every raster this program draws
	// reaches the webview. Added by AnalyzeSurfaceModel, not by the sidecar.
	ValuesURI string `json:"values_uri,omitempty"`
}

// NormalizeNilSlices gives the frontend arrays instead of nulls, as the other
// payloads do.
func (s *SurfaceModel) NormalizeNilSlices() {
	if s == nil {
		return
	}
	if s.Notes == nil {
		s.Notes = []string{}
	}
}
