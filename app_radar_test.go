package main

import (
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
)

// A radar run saved and reopened keeps its series and losses, and gets its two
// maps back from the run's directory.
func TestRadarRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	res := &analysis.RadarAnalysis{
		Orbits: []analysis.RadarOrbit{{RelativeOrbit: 170, OrbitState: "descending", N: 16}},
		Series: []analysis.RadarPoint{{Date: "2025-10-13", RelativeOrbit: 170, VVDB: -6.5, VHDB: -11.1, CRDB: -4.6}},
		Losses: []analysis.RadarLoss{{
			Date: "2025-10-16", DateFrom: "2025-10-13", DateTo: "2025-10-20", OrbitsAgree: true, NOrbits: 3, DropDB: 6.3,
		}},
		MapDate:      "2026-03-30",
		MapOrbit:     170,
		CompositeURI: onePixelPNG,
		WaterURI:     onePixelPNG,
	}
	runID := a.persistRadarRun(analysis.RadarRequest{Label: "field 3", Start: "2025-09-01", End: "2026-04-30"}, res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	got, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	r := got.Radar
	if r == nil {
		t.Fatal("the run came back without its radar series")
	}
	if r.RunID != runID || got.RunID != runID {
		t.Fatalf("run id = %q / %q, want %q", r.RunID, got.RunID, runID)
	}
	if len(r.Losses) != 1 || r.Losses[0].DateTo != "2025-10-20" || r.MapOrbit != 170 {
		t.Fatalf("figures = %+v", r)
	}
	for name, uri := range map[string]string{"composite": r.CompositeURI, "water": r.WaterURI} {
		if !strings.HasPrefix(uri, "data:image/png;base64,") {
			t.Fatalf("the %s map did not come back: %q", name, uri)
		}
	}
}
