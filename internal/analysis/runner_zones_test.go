package analysis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The sidecar's payload read into what the interface receives: every
// partition, each with its map as a data URI where the file is there, and
// absent lists as empty ones.
func TestParseZonesPayload(t *testing.T) {
	dir := t.TempDir()
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	three := filepath.Join(dir, "zones_3.png")
	if err := os.WriteFile(three, png, 0o600); err != nil {
		t.Fatal(err)
	}
	raw := `{"zones": {
		"extent": {"lon_min": -53.345, "lat_min": -24.875, "lon_max": -53.335, "lat_max": -24.866},
		"seasons": [{"start": "2025-10-01", "end": "2026-03-31", "n_scenes": 25, "n_clear": 22, "cover": 1, "used": true}],
		"n_cells": 10077, "field_cells": 10077,
		"fuzziness": 1.3, "percentile": 90, "min_zone_ha": 0.3,
		"suggested_k": 3,
		"partitions": [
			{"k": 3, "fpi": 0.018, "nce": 0.021, "iterations": 31,
			 "zones": [{"zone": 1, "area_ha": 2.81, "share": 0.028, "ndvi_mean": 0.53,
			            "season_ndvi": [0.51, null], "colour": "#f7fcb9"}],
			 "zones_geojson": "{\"type\": \"FeatureCollection\", \"features\": []}",
			 "png": "` + three + `"},
			{"k": 4, "fpi": 0.019, "nce": 0.025, "iterations": 45, "zones": null,
			 "zones_geojson": "", "png": "` + filepath.Join(dir, "missing.png") + `"}
		]
	}}`
	res, err := parseZonesPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	p3 := res.Partition(3)
	if p3 == nil || !strings.HasPrefix(p3.MapURI, "data:image/png;base64,") {
		t.Fatalf("partition 3 = %+v", p3)
	}
	z := p3.Zones[0]
	if z.NDVIMean == nil || *z.NDVIMean != 0.53 || len(z.SeasonNDVI) != 2 || z.SeasonNDVI[1] != nil {
		t.Fatalf("zone = %+v", z)
	}
	p4 := res.Partition(4)
	if p4 == nil || p4.MapURI != "" || p4.Zones == nil {
		t.Fatalf("partition 4 = %+v; a missing map costs only itself, an absent list comes back empty", p4)
	}
	if res.SuggestedK != 3 || res.Partition(5) != nil {
		t.Fatalf("suggested = %d", res.SuggestedK)
	}
	if _, err := parseZonesPayload([]byte(`{"zones": null}`)); err == nil {
		t.Fatal("an empty payload was accepted")
	}
}
