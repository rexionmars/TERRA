package main

import (
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
)

// A zones run saved and reopened keeps every partition, its polygons and its
// map, and not only the suggested one.
func TestZonesRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	mean := 0.53
	res := &analysis.ZonesAnalysis{
		Seasons:    []analysis.ZonesSeason{{Start: "2025-10-01", End: "2026-03-31", NClear: 22, Cover: 1, Used: true}},
		NCells:     10077,
		SuggestedK: 3,
		Partitions: []analysis.ZonesPartition{
			{K: 3, FPI: 0.018, NCE: 0.021, Zones: []analysis.Zone{{Zone: 1, AreaHa: 2.81, NDVIMean: &mean}},
				ZonesGeoJSON: `{"type":"FeatureCollection","features":[]}`, MapURI: onePixelPNG},
			{K: 4, FPI: 0.019, NCE: 0.025, MapURI: onePixelPNG},
		},
	}
	runID := a.persistZonesRun(analysis.ZonesRequest{Label: "field 3", Start: "2025-10-01", End: "2026-03-31"}, res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	got, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	z := got.Zones
	if z == nil {
		t.Fatal("the run came back without its zones")
	}
	if z.RunID != runID || got.RunID != runID {
		t.Fatalf("run id = %q / %q, want %q", z.RunID, got.RunID, runID)
	}
	if len(z.Partitions) != 2 || z.SuggestedK != 3 {
		t.Fatalf("partitions = %+v", z.Partitions)
	}
	for _, p := range z.Partitions {
		if !strings.HasPrefix(p.MapURI, "data:image/png;base64,") {
			t.Fatalf("the map of %d zones did not come back: %q", p.K, p.MapURI)
		}
	}
	p3 := z.Partition(3)
	if p3.ZonesGeoJSON == "" || p3.Zones[0].NDVIMean == nil || *p3.Zones[0].NDVIMean != mean {
		t.Fatalf("partition 3 = %+v", p3)
	}
	// The maps in the row would be a second copy of the files beside it.
	if res.Partitions[0].MapURI != onePixelPNG {
		t.Fatal("saving the run cleared the caller's maps")
	}
}
