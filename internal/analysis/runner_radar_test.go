package analysis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The sidecar's payload read into what the interface receives: the series as
// written, the maps as data URIs, a missing map costing only itself, and
// absent lists as empty ones.
func TestParseRadarPayload(t *testing.T) {
	dir := t.TempDir()
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	composite := filepath.Join(dir, "radar_composite.png")
	if err := os.WriteFile(composite, png, 0o600); err != nil {
		t.Fatal(err)
	}
	raw := `{"radar": {
		"extent": {"lon_min": -53.37, "lat_min": -24.885, "lon_max": -53.33, "lat_max": -24.855},
		"orbits": [{"relative_orbit": 170, "orbit_state": "descending", "n": 16}],
		"series": [{"date": "2025-10-13", "relative_orbit": 170, "orbit_state": "descending",
		            "platform": "sentinel-1c", "vv_db": -6.5, "vh_db": -11.1, "cr_db": -4.6,
		            "water_fraction": 0, "valid_fraction": 1}],
		"losses": [{"date": "2025-10-16", "date_from": "2025-10-13", "date_to": "2025-10-20",
		            "orbits_agree": true, "n_orbits": 3, "drop_db": 6.3, "cr_drop_db": 3.0}],
		"map_date": "2026-03-30",
		"map_orbit": 170,
		"water_vh_db": -23,
		"water_vv_db": -13,
		"loss_vh_db": 3,
		"loss_cr_db": 1,
		"composite_png": "` + composite + `",
		"water_png": "` + filepath.Join(dir, "missing.png") + `"
	}}`
	res, err := parseRadarPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(res.CompositeURI, "data:image/png;base64,") {
		t.Fatalf("composite = %q", res.CompositeURI)
	}
	if res.WaterURI != "" {
		t.Fatalf("a missing map came back as %q", res.WaterURI)
	}
	if len(res.Losses) != 1 || res.Losses[0].NOrbits != 3 || !res.Losses[0].OrbitsAgree {
		t.Fatalf("losses = %+v", res.Losses)
	}
	if len(res.Series) != 1 || res.Series[0].CRDB != -4.6 || res.MapOrbit != 170 {
		t.Fatalf("series = %+v", res.Series)
	}

	empty, err := parseRadarPayload([]byte(`{"radar": {"series": null, "losses": null}}`))
	if err != nil {
		t.Fatal(err)
	}
	if empty.Series == nil || empty.Losses == nil || empty.Orbits == nil {
		t.Fatal("an absent list came back as null")
	}
	if _, err := parseRadarPayload([]byte(`{"radar": null}`)); err == nil {
		t.Fatal("an empty payload was accepted")
	}
}
