package main

import (
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
)

// A health run saved and reopened keeps its figures and gets its maps back from
// the run's directory, stamped with its own id.
func TestHealthRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	z := -2.4
	res := &analysis.HealthAnalysis{
		WindowDays:    16,
		BaselineYears: []int{2022, 2023, 2024},
		Current:       []analysis.HealthPoint{{Date: "2025-12-20", NDVI: 0.62, NDRE: 0.3, ClearFraction: 0.9}},
		Anomaly:       []analysis.HealthAnomalyPoint{{Date: "2025-12-20", NDVI: 0.62, BaselineN: 5, NDVIZ: &z}},
		Latest:        &analysis.HealthAnomalyPoint{Date: "2025-12-20", NDVI: 0.62, BaselineN: 5, NDVIZ: &z},
		MapDate:       "2025-12-20",
		MapRange:      0.3,
		AnomalyURI:    onePixelPNG,
		NDVIURI:       onePixelPNG,
	}
	runID := a.persistHealthRun(analysis.HealthRequest{Label: "field 3", Start: "2025-10-01", End: "2026-03-31"}, res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	got, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	h := got.Health
	if h == nil {
		t.Fatal("the run came back without its health figures")
	}
	if h.RunID != runID || got.RunID != runID {
		t.Fatalf("run id = %q / %q, want %q", h.RunID, got.RunID, runID)
	}
	if h.Latest == nil || h.Latest.NDVIZ == nil || *h.Latest.NDVIZ != z {
		t.Fatalf("latest = %+v", h.Latest)
	}
	if len(h.BaselineYears) != 3 || h.MapDate != "2025-12-20" {
		t.Fatalf("figures = %+v", h)
	}
	for name, uri := range map[string]string{"anomaly": h.AnomalyURI, "ndvi": h.NDVIURI} {
		if !strings.HasPrefix(uri, "data:image/png;base64,") {
			t.Fatalf("the %s map did not come back: %q", name, uri)
		}
	}
	// Baseline was absent; it comes back as a list, not as null.
	if h.Baseline == nil {
		t.Fatal("an absent list came back as null")
	}
}
