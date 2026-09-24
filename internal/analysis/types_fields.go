package analysis

/*
Field boundaries from two Sentinel-2 dates.

A U-Net from the Fields of The World baselines (Kerner et al., 2025;
Muhawenayo et al., 2026) labels every 10 m cell as field interior, field
boundary or neither, from the red, green, blue and near-infrared bands of a
scene near sowing and a scene near harvest. Each connected interior region
becomes one polygon, clipped to the area.

WHAT THE POLYGONS ARE NOT. They are what the network separates, not what a
farmer calls a field: two adjacent fields sown with one crop on one day come
out as one, and one field with an internal track can come out as two. The
training data hold no Paraná field, and no accuracy is measured here; the
product states what it drew and over which scenes.
*/

// FieldsWindow is one of the two date ranges a scene is chosen from.
type FieldsWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// FieldsRequest asks for the field boundaries of one area.
type FieldsRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	// Window A near sowing, window B near harvest. The clearest scene over the
	// area is taken from each.
	WindowA FieldsWindow `json:"window_a"`
	WindowB FieldsWindow `json:"window_b"`
	// Scene-level cloud cover, percent, above which a scene is not considered.
	// Zero means the sidecar default.
	MaxCloud float64 `json:"max_cloud"`
	// Fields smaller than this, in square metres, are dropped. Zero means the
	// sidecar default, which is the FTW polygonize default of 500.
	MinAreaM2 float64 `json:"min_area_m2"`
	// The FTW checkpoint to run. Empty means the sidecar default.
	Checkpoint string `json:"checkpoint"`
	Label      string `json:"label"`
	RunLabel   string `json:"run_label"`
	AreaID     string `json:"area_id"`
	ProjectID  string `json:"project_id"`
}

// FieldsScene is the scene one window was read from: every tile of one pass.
type FieldsScene struct {
	Date       string   `json:"date"`
	Items      []string `json:"items"`
	CloudCover float64  `json:"cloud_cover"`
	// The share of the area's cells the scene classification calls clear.
	ClearFraction *float64 `json:"clear_fraction"`
}

// FieldsCheckpoint names the network that drew the polygons, and its licence.
type FieldsCheckpoint struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	License string `json:"license"`
}

// FieldsGrid is the grid the scenes were read onto.
type FieldsGrid struct {
	CRS        string  `json:"crs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	PixelSizeM float64 `json:"pixel_size_m"`
	BufferM    float64 `json:"buffer_m"`
}

// FieldsClassFraction is the share of the area's clear cells in each class.
type FieldsClassFraction struct {
	Background float64 `json:"background"`
	Interior   float64 `json:"interior"`
	Boundary   float64 `json:"boundary"`
}

// FieldsAreaSummary describes the field sizes, in hectares.
type FieldsAreaSummary struct {
	Total  float64 `json:"total"`
	Median float64 `json:"median"`
	P10    float64 `json:"p10"`
	P90    float64 `json:"p90"`
	Max    float64 `json:"max"`
}

// fieldsSidecarResult is the sidecar's `fields` object, key for key.
// sidecar/tests/test_payload_contract.py reads both sides and fails when one
// names a key the other does not.
type fieldsSidecarResult struct {
	Extent            Bounds              `json:"extent"`
	Checkpoint        FieldsCheckpoint    `json:"checkpoint"`
	WindowA           FieldsScene         `json:"window_a"`
	WindowB           FieldsScene         `json:"window_b"`
	Grid              FieldsGrid          `json:"grid"`
	ResizeFactor      int                 `json:"resize_factor"`
	MinAreaM2         float64             `json:"min_area_m2"`
	SimplifyM         float64             `json:"simplify_m"`
	AreaHa            float64             `json:"area_ha"`
	MaskedFraction    float64             `json:"masked_fraction"`
	ClassFraction     FieldsClassFraction `json:"class_fraction"`
	NFields           int                 `json:"n_fields"`
	FieldAreaHa       *FieldsAreaSummary  `json:"field_area_ha"`
	CroplandReference *string             `json:"cropland_reference"`
	// Paths inside the sidecar's work directory.
	FieldsGeoJSON string `json:"fields_geojson"`
	ClassesPNG    string `json:"classes_png"`
	ClassesTIF    string `json:"classes_tif"`
	WindowAPNG    string `json:"window_a_png"`
	WindowBPNG    string `json:"window_b_png"`
}

/*
FieldsAnalysis is the field boundaries of one area, as the interface reads them.

The polygons travel as the GeoJSON text the sidecar wrote rather than as a Go
structure: nothing on this side reads a coordinate, and a FeatureCollection
decoded and re-encoded here would be a second schema for a format that already
has one.
*/
type FieldsAnalysis struct {
	RunID             string              `json:"run_id,omitempty"`
	Extent            Bounds              `json:"extent"`
	Checkpoint        FieldsCheckpoint    `json:"checkpoint"`
	WindowA           FieldsScene         `json:"window_a"`
	WindowB           FieldsScene         `json:"window_b"`
	Grid              FieldsGrid          `json:"grid"`
	ResizeFactor      int                 `json:"resize_factor"`
	MinAreaM2         float64             `json:"min_area_m2"`
	SimplifyM         float64             `json:"simplify_m"`
	AreaHa            float64             `json:"area_ha"`
	MaskedFraction    float64             `json:"masked_fraction"`
	ClassFraction     FieldsClassFraction `json:"class_fraction"`
	NFields           int                 `json:"n_fields"`
	FieldAreaHa       *FieldsAreaSummary  `json:"field_area_ha"`
	CroplandReference *string             `json:"cropland_reference"`
	// A GeoJSON FeatureCollection in WGS84, one feature per field, largest
	// first. Each carries field, area_ha, perimeter_m, mean_interior_prob and,
	// when MapBiomas was read, cropland_share.
	FieldsGeoJSON string `json:"fields_geojson"`
	// The class map and the two scenes, as data URIs placed on Extent.
	ClassesURI string `json:"classes_uri,omitempty"`
	WindowAURI string `json:"window_a_uri,omitempty"`
	WindowBURI string `json:"window_b_uri,omitempty"`
	// The class map as a GeoTIFF on disk, for export: 0 background, 1
	// interior, 2 boundary, 255 not seen clearly in both scenes.
	ClassesTIF string `json:"classes_tif"`
}

// NormalizeNilSlices turns absent lists into empty ones.
func (f *FieldsAnalysis) NormalizeNilSlices() {
	if f.WindowA.Items == nil {
		f.WindowA.Items = []string{}
	}
	if f.WindowB.Items == nil {
		f.WindowB.Items = []string{}
	}
}
