package main

import (
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/models"
	"geosense-infer/internal/store"
)

// A trajectory run saved and reopened keeps its series, its observations and
// the model that made it, under its own kind and the model's id.
func TestTrajectoryRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	res := &analysis.TrajectoryAnalysis{
		Dates: []string{"2020-09-05", "2020-09-06"},
		NDVI:  []float64{0.31, 0.32}, Lower: []float64{0.2, 0.21}, Upper: []float64{0.42, 0.43},
		Level: 0.95,
		Observations: []analysis.TrajectoryObservation{
			{Date: "2020-09-05", NDVI: 0.3, ClearFraction: 0.9, Kept: true},
			{Date: "2020-09-06", NDVI: 0.7, ClearFraction: 0.5, Kept: false},
		},
		Scale: "MT", Region: "MT", Multiplier: 0.8,
		Model: analysis.TrajectoryModel{ID: "gp_series", Version: "0.1.0", Name: "Gaussian Process", Digest: "2055cc9e"},
	}
	runID := a.persistTrajectoryRun(analysis.TrajectoryRequest{Label: "field 3", Start: "2020-09-01", End: "2021-08-31"}, res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	got, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	r := got.Trajectory
	if r == nil {
		t.Fatal("the run came back without its trajectory")
	}
	if r.RunID != runID || got.RunID != runID {
		t.Fatalf("run id = %q / %q, want %q", r.RunID, got.RunID, runID)
	}
	if len(r.Dates) != 2 || r.Upper[1] != 0.43 || r.Observations[1].Kept || r.Scale != "MT" || r.Model.Digest != "2055cc9e" {
		t.Fatalf("trajectory = %+v", r)
	}
	run, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Kind != "trajectory" || run.ModelKind != "gp_series" || run.NDates != 2 {
		t.Fatalf("row = kind %q, model %q, %d dates", run.Kind, run.ModelKind, run.NDates)
	}
	if !strings.Contains(run.SummaryJSON, `"trajectory_n_kept":1`) {
		t.Fatalf("summary = %s", run.SummaryJSON)
	}
}

// The trajectory resolves a time-series package and nothing else, and says so
// when none was chosen.
func TestTheTrajectoryResolvesOnlyATimeSeriesModel(t *testing.T) {
	root := t.TempDir()
	if _, err := models.Import(root, "sidecar/tests/data/gp_series/package"); err != nil {
		t.Fatal(err)
	}
	if p, err := resolveTrajectoryModel(root, "gp_series", ""); err != nil || p.Manifest.Version != "0.1.0" {
		t.Fatalf("got %v %v, want gp_series 0.1.0", p, err)
	}
	if _, err := resolveTrajectoryModel(root, " ", ""); err == nil || !strings.Contains(err.Error(), "no time-series model was chosen") {
		t.Fatalf("got %v, want an empty id refused", err)
	}
	if _, err := models.Resolve(root, models.LandCover, "gp_series", ""); err == nil {
		t.Fatal("the classification resolved the gp_series model")
	}
}
