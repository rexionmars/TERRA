package analysis

/*
Socio-environmental overlap: how much of an area falls on each public register
-- PRODES and DETER (INPE), CAR property registrations (SICAR), IBAMA and ICMBio
embargoes, indigenous lands (FUNAI), conservation units (CNUC) -- in hectares,
as the registers stood when they were read (sidecar/terra/overlap).

AN OVERLAP IS NOT A FINDING OF IRREGULARITY. A PRODES polygon can hold an
authorised clearing, an embargo can be lifted after the layer was published,
and a conservation unit of sustainable use admits farming. A check is valid for
the moment in ReadAt, which every view of it states.
*/

// OverlapRequest asks for the registers under one area. There is no period:
// each register is read as it stands.
type OverlapRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Label          string           `json:"label,omitempty"`
	RunLabel       string           `json:"run_label,omitempty"`
	AreaID         string           `json:"area_id,omitempty"`
	ProjectID      string           `json:"project_id,omitempty"`
}

// OverlapFeature is one feature of a register that shares ground with the
// area. Ref identifies it in its register (a CAR code, an embargo term, a CNUC
// code). The embargo registers also publish the embargoed person's name and
// tax number; the sidecar does not read them.
type OverlapFeature struct {
	Ref      string `json:"ref"`
	Name     string `json:"name"`
	Date     string `json:"date"`
	Year     int    `json:"year"`
	Category string `json:"category"`
	Status   string `json:"status"`
	Detail   string `json:"detail"`
	// The feature's own area as its register states it; null where it states none.
	FeatureHa *float64 `json:"feature_ha"`
	OverlapHa float64  `json:"overlap_ha"`
}

// OverlapLayer is one register as read over the area.
type OverlapLayer struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Publisher string   `json:"publisher"`
	Layers    []string `json:"layers"`
	// The colour the register is drawn in on the map, #rrggbb.
	Colour string `json:"colour"`
	// "read", "not_covered" (the register is not published where the area is)
	// or "failed" (it could not be read; Note says why).
	Status string `json:"status"`
	Note   string `json:"note"`
	// The union of the features inside the area, so overlapping features are
	// counted once.
	OverlapHa float64          `json:"overlap_ha"`
	NFeatures int              `json:"n_features"`
	Features  []OverlapFeature `json:"features"`
}

// OverlapPeriod is the PRODES clearing inside the area in one period between
// the Forest Code date and the EUDR cutoff.
type OverlapPeriod struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Ha    float64 `json:"ha"`
}

// overlapSidecarResult is the sidecar's `overlap` object, the map's path included.
type overlapSidecarResult struct {
	AreaHa           float64         `json:"area_ha"`
	ReadAt           string          `json:"read_at"`
	Extent           Bounds          `json:"extent"`
	Biomes           []string        `json:"biomes"`
	States           []string        `json:"states"`
	ForestCodeCutoff string          `json:"forest_code_cutoff"`
	EUDRCutoff       string          `json:"eudr_cutoff"`
	Layers           []OverlapLayer  `json:"layers"`
	Periods          []OverlapPeriod `json:"periods"`
	MapPNG           string          `json:"map_png"`
}

// OverlapAnalysis is what the interface receives: the registers, and the map
// as a data URI.
type OverlapAnalysis struct {
	AreaHa           float64         `json:"area_ha"`
	ReadAt           string          `json:"read_at"`
	Extent           Bounds          `json:"extent"`
	Biomes           []string        `json:"biomes"`
	States           []string        `json:"states"`
	ForestCodeCutoff string          `json:"forest_code_cutoff"`
	EUDRCutoff       string          `json:"eudr_cutoff"`
	Layers           []OverlapLayer  `json:"layers"`
	Periods          []OverlapPeriod `json:"periods"`
	MapURI           string          `json:"map_uri"`
	RunID            string          `json:"run_id,omitempty"`
}

// NormalizeNilSlices turns absent lists into empty ones, which the interface
// reads as "none" rather than as a value missing.
func (o *OverlapAnalysis) NormalizeNilSlices() {
	if o.Biomes == nil {
		o.Biomes = []string{}
	}
	if o.States == nil {
		o.States = []string{}
	}
	if o.Layers == nil {
		o.Layers = []OverlapLayer{}
	}
	if o.Periods == nil {
		o.Periods = []OverlapPeriod{}
	}
	for i := range o.Layers {
		if o.Layers[i].Layers == nil {
			o.Layers[i].Layers = []string{}
		}
		if o.Layers[i].Features == nil {
			o.Layers[i].Features = []OverlapFeature{}
		}
	}
}

// Layer returns the register with the given id, or nil.
func (o *OverlapAnalysis) Layer(id string) *OverlapLayer {
	for i := range o.Layers {
		if o.Layers[i].ID == id {
			return &o.Layers[i]
		}
	}
	return nil
}
