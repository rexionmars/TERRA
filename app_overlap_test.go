package main

import (
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
)

// An overlap run saved and reopened keeps its registers and the moment they
// were read, and gets its map back from the run's directory.
func TestOverlapRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	size := 24.0
	res := &analysis.OverlapAnalysis{
		AreaHa:           111.9,
		ReadAt:           "2026-09-26T20:55:00Z",
		ForestCodeCutoff: "2008-07-22",
		EUDRCutoff:       "2020-12-31",
		Layers: []analysis.OverlapLayer{{
			ID: "embargo_ibama", Title: "IBAMA embargoes", Status: "read", OverlapHa: 24, NFeatures: 1,
			Features: []analysis.OverlapFeature{{Ref: "TAD 3YZW6Y65", FeatureHa: &size, OverlapHa: 24}},
		}},
		Periods: []analysis.OverlapPeriod{{ID: "after_eudr", Ha: 2.1}},
		MapURI:  onePixelPNG,
	}
	runID := a.persistOverlapRun(analysis.OverlapRequest{Label: "field 3"}, res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	got, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	o := got.Overlap
	if o == nil {
		t.Fatal("the run came back without its registers")
	}
	if o.RunID != runID || got.RunID != runID {
		t.Fatalf("run id = %q / %q, want %q", o.RunID, got.RunID, runID)
	}
	if o.ReadAt != res.ReadAt {
		t.Fatalf("read at = %q, want %q: a check is valid for the moment it was read", o.ReadAt, res.ReadAt)
	}
	e := o.Layer("embargo_ibama")
	if e == nil || len(e.Features) != 1 || e.Features[0].FeatureHa == nil || *e.Features[0].FeatureHa != size {
		t.Fatalf("embargo = %+v", e)
	}
	if !strings.HasPrefix(o.MapURI, "data:image/png;base64,") {
		t.Fatalf("the map did not come back: %q", o.MapURI)
	}
	// Biomes were absent; they come back as a list, not as null.
	if o.Biomes == nil {
		t.Fatal("an absent list came back as null")
	}
}
