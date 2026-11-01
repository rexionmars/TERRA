package analysis

import (
	"encoding/json"
	"strings"
	"testing"
)

// A raster's corners travel from the sidecar to the map through this struct, and a
// field Go does not declare is dropped on the way through without a word.
func TestBoundsCarriesCorners(t *testing.T) {
	in := `{"lon_min":-54,"lat_min":-25,"lon_max":-53,"lat_max":-24,"corners":[[-54,-24],[-53,-24],[-53,-25],[-54,-25]]}`
	var b Bounds
	if err := json.Unmarshal([]byte(in), &b); err != nil {
		t.Fatal(err)
	}
	if len(b.Corners) != 4 || b.Corners[2][1] != -25 {
		t.Fatalf("corners lost on the way in: %v", b.Corners)
	}
	out, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"corners":[[-54,-24]`) {
		t.Fatalf("corners lost on the way out: %s", out)
	}
}

// A run saved before corners were reported, and a raster in degrees, have none, and
// the interface draws those by the box.
func TestBoundsOmitsAbsentCorners(t *testing.T) {
	out, err := json.Marshal(Bounds{LonMin: 1})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "corners") {
		t.Fatalf("absent corners written: %s", out)
	}
}
