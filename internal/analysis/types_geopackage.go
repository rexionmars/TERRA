package analysis

/*
A GeoPackage file opened on the map: its layers, each written as GeoJSON by
the sidecar (sidecar/terra/geopackage) into a directory the application serves
to the page. frontend/src/lib/types.ts mirrors both structs.
*/

// GeoPackage is one opened file. ID names it in the URLs of its layers.
type GeoPackage struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Path   string            `json:"path"`
	Layers []GeoPackageLayer `json:"layers"`
}

// GeoPackageLayer is one table of the file. URL is where the map fetches its
// GeoJSON, empty when the layer cannot be drawn, and Reason says why.
type GeoPackageLayer struct {
	Name         string `json:"name"`
	Title        string `json:"title"`
	DataType     string `json:"data_type"`
	GeometryType string `json:"geometry_type"`
	// Kind is how the map draws it: point, line, polygon, or mixed.
	Kind string `json:"kind"`
	// CRS is the coordinate system the file stores, as a name and a code.
	CRS string `json:"crs"`
	// Count is every row; Drawn the rows with a geometry the map draws, up to
	// the sidecar's MAX_FEATURES; Unreadable the geometries it could not decode.
	Count      int `json:"count"`
	Drawn      int `json:"drawn"`
	Unreadable int `json:"unreadable"`
	// Bounds is west, south, east, north in degrees, absent with nothing drawn.
	Bounds  []float64 `json:"bounds"`
	Columns []string  `json:"columns"`
	// File is the GeoJSON's name in the sidecar's directory; URL is set from it.
	File   string `json:"file"`
	URL    string `json:"url"`
	Reason string `json:"reason"`
}
