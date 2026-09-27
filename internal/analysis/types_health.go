package analysis

/*
Vegetation health: an area's NDVI and NDRE this season against the same days of
the year in earlier seasons (sidecar/terra/health).

Each clear acquisition of the period gives the mean NDVI and NDRE over the
cells the scene classification calls clear, and is compared with the earlier
seasons' acquisitions within WindowDays of the same day of the year, as a
departure in standard deviations. A map shows, per cell, the NDVI of the latest
clear date minus the median of the earlier seasons around that day.

A DEPARTURE IS NOT A DIAGNOSIS. A field sown later, with another crop, or left
fallow departs as a stressed one does; the comparison says where and when a
field differs from its own record.
*/

// HealthRequest asks for one area over a period, against earlier seasons of it.
type HealthRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	MaxCloud       float64          `json:"max_cloud"`
	// Earlier seasons read as the reference; zero takes the sidecar default.
	BaselineYears int    `json:"baseline_years"`
	Label         string `json:"label,omitempty"`
	RunLabel      string `json:"run_label,omitempty"`
	AreaID        string `json:"area_id,omitempty"`
	ProjectID     string `json:"project_id,omitempty"`
}

// HealthPoint is one clear acquisition: the index means over its clear cells.
type HealthPoint struct {
	Date          string  `json:"date"`
	NDVI          float64 `json:"ndvi"`
	NDRE          float64 `json:"ndre"`
	ClearFraction float64 `json:"clear_fraction"`
}

// HealthBaselinePoint is one acquisition of an earlier season.
type HealthBaselinePoint struct {
	Date          string  `json:"date"`
	NDVI          float64 `json:"ndvi"`
	NDRE          float64 `json:"ndre"`
	ClearFraction float64 `json:"clear_fraction"`
	Year          int     `json:"year"`
}

// HealthAnomalyPoint is one date of this season against the earlier seasons
// around the same day of the year. The means, spreads and departures are null
// where too few earlier dates fall in the window to measure them.
type HealthAnomalyPoint struct {
	Date      string   `json:"date"`
	NDVI      float64  `json:"ndvi"`
	NDRE      float64  `json:"ndre"`
	BaselineN int      `json:"baseline_n"`
	NDVIMean  *float64 `json:"ndvi_mean"`
	NDVISd    *float64 `json:"ndvi_sd"`
	NDVIZ     *float64 `json:"ndvi_z"`
	NDREMean  *float64 `json:"ndre_mean"`
	NDRESd    *float64 `json:"ndre_sd"`
	NDREZ     *float64 `json:"ndre_z"`
}

// healthSidecarResult is the sidecar's `health` object, file paths included.
type healthSidecarResult struct {
	Extent        Bounds                `json:"extent"`
	WindowDays    int                   `json:"window_days"`
	BaselineYears []int                 `json:"baseline_years"`
	Current       []HealthPoint         `json:"current"`
	Baseline      []HealthBaselinePoint `json:"baseline"`
	Anomaly       []HealthAnomalyPoint  `json:"anomaly"`
	Latest        *HealthAnomalyPoint   `json:"latest"`
	MapDate       string                `json:"map_date"`
	MapRange      float64               `json:"map_range"`
	AnomalyPNG    string                `json:"anomaly_png"`
	NDVIPNG       string                `json:"ndvi_png"`
}

// HealthAnalysis is what the interface receives: the figures, and the two maps
// as data URIs.
type HealthAnalysis struct {
	Extent        Bounds                `json:"extent"`
	WindowDays    int                   `json:"window_days"`
	BaselineYears []int                 `json:"baseline_years"`
	Current       []HealthPoint         `json:"current"`
	Baseline      []HealthBaselinePoint `json:"baseline"`
	Anomaly       []HealthAnomalyPoint  `json:"anomaly"`
	Latest        *HealthAnomalyPoint   `json:"latest"`
	MapDate       string                `json:"map_date"`
	MapRange      float64               `json:"map_range"`
	AnomalyURI    string                `json:"anomaly_uri"`
	NDVIURI       string                `json:"ndvi_uri"`
	RunID         string                `json:"run_id,omitempty"`
}

// NormalizeNilSlices turns absent lists into empty ones, which the interface
// reads as "none" rather than as a value missing.
func (h *HealthAnalysis) NormalizeNilSlices() {
	if h.BaselineYears == nil {
		h.BaselineYears = []int{}
	}
	if h.Current == nil {
		h.Current = []HealthPoint{}
	}
	if h.Baseline == nil {
		h.Baseline = []HealthBaselinePoint{}
	}
	if h.Anomaly == nil {
		h.Anomaly = []HealthAnomalyPoint{}
	}
}
