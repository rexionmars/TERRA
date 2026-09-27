package analysis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The sidecar's payload read into what the interface receives: the figures as
// written, the maps as data URIs, and a map that is not there costing only
// itself.
func TestParseHealthPayload(t *testing.T) {
	dir := t.TempDir()
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	anomaly := filepath.Join(dir, "health_anomaly.png")
	if err := os.WriteFile(anomaly, png, 0o600); err != nil {
		t.Fatal(err)
	}
	raw := `{"health": {
		"extent": {"lon_min": -53.2, "lat_min": -25.3, "lon_max": -53.1, "lat_max": -25.2},
		"window_days": 16,
		"baseline_years": [2023, 2024],
		"current": [{"date": "2025-12-20", "ndvi": 0.62, "ndre": 0.30, "clear_fraction": 0.91}],
		"baseline": [{"date": "2024-12-18", "ndvi": 0.80, "ndre": 0.40, "clear_fraction": 1.0, "year": 2024}],
		"anomaly": [{"date": "2025-12-20", "ndvi": 0.62, "ndre": 0.30, "baseline_n": 1,
		             "ndvi_mean": 0.80, "ndvi_sd": null, "ndvi_z": null,
		             "ndre_mean": 0.40, "ndre_sd": null, "ndre_z": null}],
		"latest": null,
		"map_date": "2025-12-20",
		"map_range": 0.3,
		"anomaly_png": "` + anomaly + `",
		"ndvi_png": "` + filepath.Join(dir, "missing.png") + `"
	}}`
	res, err := parseHealthPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(res.AnomalyURI, "data:image/png;base64,") {
		t.Fatalf("anomaly map = %q", res.AnomalyURI)
	}
	if res.NDVIURI != "" {
		t.Fatalf("a missing map came back as %q", res.NDVIURI)
	}
	if len(res.Baseline) != 1 || res.Baseline[0].Year != 2024 {
		t.Fatalf("baseline = %+v", res.Baseline)
	}
	a := res.Anomaly[0]
	if a.NDVIMean == nil || *a.NDVIMean != 0.80 || a.NDVIZ != nil {
		t.Fatalf("anomaly = %+v", a)
	}
	if res.Latest != nil {
		t.Fatalf("latest = %+v, want none", res.Latest)
	}

	if _, err := parseHealthPayload([]byte(`{"health": null}`)); err == nil {
		t.Fatal("an empty payload was accepted")
	}
}
