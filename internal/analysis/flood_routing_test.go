package analysis

import (
	"encoding/json"
	"os"
	"testing"
)

/*
TestFloodRoutingPayloadParses reads a RECORDED sidecar payload into the struct.

It exists because the first version of this contract did not. Extent was typed
[]float64 from reading the sidecar's code rather than its output, and
composite.extent_from_profile returns an object; the Go build was clean, the
sidecar ran, and the failure arrived in the application as "cannot unmarshal
object into Go struct field ... extent of type []float64". types_flood.go says
of its own fields that each was read off a recorded payload rather than
predicted from the contract text -- this is that recording, for this product.

The Go/TypeScript contract check does not cover this: it compares structs
against same-named TypeScript interfaces, and FloodRoutingAnalysis has none, so
it sits in the unguarded set that check reports only as a count.
*/
func TestFloodRoutingPayloadParses(t *testing.T) {
	raw, err := os.ReadFile("testdata/flood_routing.json")
	if err != nil {
		t.Fatalf("reading the recorded payload: %v", err)
	}

	var wrapped struct {
		Routing *FloodRoutingAnalysis `json:"flood_routing"`
	}
	// DisallowUnknownFields is deliberately NOT set. The sidecar may add a key
	// before Go learns to read it, and that is not a failure of this contract;
	// what this guards is a field the struct DOES claim being the wrong shape.
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("the recorded payload does not fit the struct: %v", err)
	}
	got := wrapped.Routing
	if got == nil {
		t.Fatal("the payload parsed but carried no flood_routing object")
	}

	// The fields the panel reads, checked against the recording rather than
	// against expectations: a zero here means the JSON tag does not match.
	if got.DEMID == "" {
		t.Error("dem_id is empty, so the tag does not match the payload")
	}
	if got.Grid.Width == 0 || got.Grid.Height == 0 {
		t.Errorf("grid did not parse: %+v", got.Grid)
	}
	if got.AOI.AreaKm2 == 0 {
		t.Error("aoi.area_km2 is zero")
	}
	// Zero is a legitimate value for a channel wholly inside the AOI, so what
	// is checked is that the key exists and stays a fraction rather than that
	// it is non-zero.
	if got.AOI.OnBoundaryFraction < 0 || got.AOI.OnBoundaryFraction > 1 {
		t.Errorf("aoi.on_boundary_fraction is not a fraction: %v",
			got.AOI.OnBoundaryFraction)
	}
	if got.DepthM.Median == nil {
		t.Error("depth_m.median is nil on a run that flooded")
	}
	if got.Volume.InM3 == 0 {
		t.Error("volume.in_m3 is zero")
	}
	// The balance the sidecar measures, checked here on the recorded run:
	// in + clip = stored + out. It is
	// asserted in Go as well as in Python because these are the five numbers
	// the panel puts on screen, and a tag that stops matching would show them
	// all as zero and still close.
	residual := got.Volume.InM3 + got.Volume.ClippedM3 -
		got.Volume.StoredM3 - got.Volume.OutM3
	if residual > 1 || residual < -1 {
		t.Errorf("the recorded balance does not close: %.3f m3 unaccounted", residual)
	}
	if got.Rain.MMH == 0 {
		t.Error("rain.mm_h is zero")
	}
	// The field that failed. An object, four named bounds, never a list.
	if got.Extent.LonMin == 0 || got.Extent.LatMax == 0 {
		t.Errorf("extent did not parse: %+v", got.Extent)
	}
	if got.Extent.LonMin >= got.Extent.LonMax || got.Extent.LatMin >= got.Extent.LatMax {
		t.Errorf("extent is not a box: %+v", got.Extent)
	}
	if got.LakeAtRestResidualMS == 0 {
		t.Error("lake_at_rest_residual_ms is zero, which no real run reports")
	}
	if len(got.Assumptions) == 0 {
		t.Error("assumptions did not parse")
	}
}

// TestFloodRoutingNormalizeNilSlices covers what the frontend would throw on.
func TestFloodRoutingNormalizeNilSlices(t *testing.T) {
	f := &FloodRoutingAnalysis{}
	f.NormalizeNilSlices()
	if f.Assumptions == nil {
		t.Error("assumptions stayed nil, and the panel maps over it")
	}
}
