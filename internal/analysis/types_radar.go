package analysis

/*
Sentinel-1 radar: an area's C-band backscatter over a period, which cloud does
not interrupt (sidecar/terra/radar).

Every pass of the period over the area -- one date and one relative orbit of
the Planetary Computer's sentinel-1-rtc collection -- gives the mean gamma0 VV
and VH over the area, in dB, their cross ratio VH/VV, and the share of the area
read as open water. Orbits are kept apart, since the incidence angle sets the
level of the backscatter.

A CANOPY LOSS is a drop in VH of at least LossVHDB between two passes of one
orbit with the cross ratio falling by at least LossCRDB: a harvest, most often,
but a lodged, a hail-struck or a desiccated canopy reads the same way. The
thresholds were not calibrated against harvest records.
*/

// RadarRequest asks for one area over a period.
type RadarRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	Label          string           `json:"label,omitempty"`
	RunLabel       string           `json:"run_label,omitempty"`
	AreaID         string           `json:"area_id,omitempty"`
	ProjectID      string           `json:"project_id,omitempty"`
}

// RadarPoint is one pass over the area.
type RadarPoint struct {
	Date          string  `json:"date"`
	RelativeOrbit int     `json:"relative_orbit"`
	OrbitState    string  `json:"orbit_state"`
	Platform      string  `json:"platform"`
	VVDB          float64 `json:"vv_db"`
	VHDB          float64 `json:"vh_db"`
	// VH/VV, in dB.
	CRDB float64 `json:"cr_db"`
	// Share of the area's valid cells read as open water, 0-1.
	WaterFraction float64 `json:"water_fraction"`
	// Share of the area the pass covered, 0-1.
	ValidFraction float64 `json:"valid_fraction"`
}

// RadarOrbit is one relative orbit read, and how many passes it gave.
type RadarOrbit struct {
	RelativeOrbit int    `json:"relative_orbit"`
	OrbitState    string `json:"orbit_state"`
	N             int    `json:"n"`
}

// RadarLoss is one canopy loss: between DateFrom and DateTo, Date the middle.
type RadarLoss struct {
	Date     string `json:"date"`
	DateFrom string `json:"date_from"`
	DateTo   string `json:"date_to"`
	// False where the orbits that saw it placed it in windows that do not
	// overlap; the window then spans them all.
	OrbitsAgree bool    `json:"orbits_agree"`
	NOrbits     int     `json:"n_orbits"`
	DropDB      float64 `json:"drop_db"`
	CRDropDB    float64 `json:"cr_drop_db"`
}

// radarSidecarResult is the sidecar's `radar` object, the maps' paths included.
type radarSidecarResult struct {
	Extent       Bounds       `json:"extent"`
	Orbits       []RadarOrbit `json:"orbits"`
	Series       []RadarPoint `json:"series"`
	Losses       []RadarLoss  `json:"losses"`
	MapDate      string       `json:"map_date"`
	MapOrbit     int          `json:"map_orbit"`
	WaterVHDB    float64      `json:"water_vh_db"`
	WaterVVDB    float64      `json:"water_vv_db"`
	LossVHDB     float64      `json:"loss_vh_db"`
	LossCRDB     float64      `json:"loss_cr_db"`
	CompositePNG string       `json:"composite_png"`
	WaterPNG     string       `json:"water_png"`
}

// RadarAnalysis is what the interface receives: the series, and the two maps
// of the latest pass as data URIs.
type RadarAnalysis struct {
	Extent       Bounds       `json:"extent"`
	Orbits       []RadarOrbit `json:"orbits"`
	Series       []RadarPoint `json:"series"`
	Losses       []RadarLoss  `json:"losses"`
	MapDate      string       `json:"map_date"`
	MapOrbit     int          `json:"map_orbit"`
	WaterVHDB    float64      `json:"water_vh_db"`
	WaterVVDB    float64      `json:"water_vv_db"`
	LossVHDB     float64      `json:"loss_vh_db"`
	LossCRDB     float64      `json:"loss_cr_db"`
	CompositeURI string       `json:"composite_uri"`
	WaterURI     string       `json:"water_uri"`
	RunID        string       `json:"run_id,omitempty"`
}

// NormalizeNilSlices turns absent lists into empty ones, which the interface
// reads as "none" rather than as a value missing.
func (r *RadarAnalysis) NormalizeNilSlices() {
	if r.Orbits == nil {
		r.Orbits = []RadarOrbit{}
	}
	if r.Series == nil {
		r.Series = []RadarPoint{}
	}
	if r.Losses == nil {
		r.Losses = []RadarLoss{}
	}
}
