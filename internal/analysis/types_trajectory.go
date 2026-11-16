package analysis

/*
The NDVI trajectory: an area's Sentinel-2 series over a period, run through an
installed time-series model of the gp_series family (sidecar/terra/trajectory).

Per acquisition the area's clear pixels are reduced to the median of B02, B03,
B04, B08, NDVI and EVI. The model keeps one acquisition per date, sets aside
those that disagree with the dates around them, and fits a Gaussian process to
the rest. The result is a daily NDVI from the first to the last date it kept,
with an interval at Level (0.95) that widens where clear dates are far apart.

THE SCALE OF THE INTERVAL IS THE REGION'S. A model is calibrated on regions
(Bahia, Mato Grosso and Paraná for gp_series 0.1.0) and scales its interval by
the one the area lies in; elsewhere, and within 2 km of a border, it uses its
global scale. Scale says which was used, and the interface says it beside the
figure.
*/

// TrajectoryRequest asks for one area over a period, through one installed model.
type TrajectoryRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	// ModelID is the installed time-series package to run; ModelVersion pins
	// one of its versions, the newest installed when empty.
	ModelID      string `json:"model_id"`
	ModelVersion string `json:"model_version,omitempty"`
	Label        string `json:"label,omitempty"`
	RunLabel     string `json:"run_label,omitempty"`
	AreaID       string `json:"area_id,omitempty"`
	ProjectID    string `json:"project_id,omitempty"`
}

// TrajectoryObservation is one acquisition the model used, one per date.
type TrajectoryObservation struct {
	Date string  `json:"date"`
	NDVI float64 `json:"ndvi"`
	// Share of the area's cells clear, with data and finite, 0-1.
	ClearFraction float64 `json:"clear_fraction"`
	// False where the model set it aside as disagreeing with the dates around it.
	Kept bool `json:"kept"`
}

// TrajectoryModel is the package that ran, down to its files.
type TrajectoryModel struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Name    string `json:"name"`
	Digest  string `json:"digest"`
}

// TrajectoryAnalysis is the daily trajectory, the acquisitions behind it and
// the model that made it.
type TrajectoryAnalysis struct {
	// One per day, from the first to the last kept acquisition, ISO dates.
	Dates []string  `json:"dates"`
	NDVI  []float64 `json:"ndvi"`
	Lower []float64 `json:"lower"`
	Upper []float64 `json:"upper"`
	// The interval's coverage, 0-1.
	Level        float64                 `json:"level"`
	Observations []TrajectoryObservation `json:"observations"`
	// Acquisitions found over the period, and those whose files could be read.
	ScenesFound int `json:"scenes_found"`
	ScenesRead  int `json:"scenes_read"`
	// The share of the area a date had to see clearly to count, 0-1.
	MinClearFraction float64 `json:"min_clear_fraction"`
	// Region is the state holding the area among those the model was
	// calibrated on, empty elsewhere and near a border; Scale is the region
	// whose interval scale was used, or "global".
	Region string `json:"region"`
	Scale  string `json:"scale"`
	// The factor the model chose for the period of its seasonal term.
	Multiplier float64         `json:"multiplier"`
	Model      TrajectoryModel `json:"model"`
	RunID      string          `json:"run_id,omitempty"`
}

// NormalizeNilSlices turns absent lists into empty ones, which the interface
// reads as "none" rather than as a value missing.
func (r *TrajectoryAnalysis) NormalizeNilSlices() {
	if r.Dates == nil {
		r.Dates = []string{}
	}
	if r.NDVI == nil {
		r.NDVI = []float64{}
	}
	if r.Lower == nil {
		r.Lower = []float64{}
	}
	if r.Upper == nil {
		r.Upper = []float64{}
	}
	if r.Observations == nil {
		r.Observations = []TrajectoryObservation{}
	}
}
