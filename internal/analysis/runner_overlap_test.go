package analysis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The sidecar's payload read into what the interface receives: the registers
// as written, the map as a data URI, and absent lists as empty ones.
func TestParseOverlapPayload(t *testing.T) {
	dir := t.TempDir()
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	mapPath := filepath.Join(dir, "overlap_map.png")
	if err := os.WriteFile(mapPath, png, 0o600); err != nil {
		t.Fatal(err)
	}
	raw := `{"overlap": {
		"area_ha": 111.9,
		"read_at": "2026-09-26T20:55:00Z",
		"extent": {"lon_min": -53.37, "lat_min": -24.885, "lon_max": -53.33, "lat_max": -24.855},
		"biomes": ["Mata Atlântica"],
		"states": ["PR"],
		"forest_code_cutoff": "2008-07-22",
		"eudr_cutoff": "2020-12-31",
		"layers": [
			{"id": "embargo_ibama", "title": "IBAMA embargoes", "publisher": "IBAMA",
			 "layers": [], "colour": "#cc79a7", "status": "read", "note": "",
			 "overlap_ha": 24.0, "n_features": 1,
			 "features": [{"ref": "TAD 3YZW6Y65", "name": "Cascavel (PR)", "date": "2026-08-05",
			               "year": 2026, "category": "desmatamento", "status": "", "detail": "",
			               "feature_ha": null, "overlap_ha": 24.0}]},
			{"id": "deter", "title": "DETER alerts", "publisher": "INPE", "layers": [],
			 "colour": "#e69f00", "status": "not_covered", "note": "DETER monitors the Amazon and the Cerrado",
			 "overlap_ha": 0, "n_features": 0, "features": null}
		],
		"periods": [{"id": "after_eudr", "label": "PRODES 2022 onwards", "ha": 2.1}],
		"map_png": "` + mapPath + `"
	}}`
	res, err := parseOverlapPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(res.MapURI, "data:image/png;base64,") {
		t.Fatalf("map = %q", res.MapURI)
	}
	e := res.Layer("embargo_ibama")
	if e == nil || e.OverlapHa != 24.0 || len(e.Features) != 1 || e.Features[0].FeatureHa != nil {
		t.Fatalf("embargo = %+v", e)
	}
	d := res.Layer("deter")
	if d == nil || d.Status != "not_covered" || d.Features == nil {
		t.Fatalf("deter = %+v; an absent list must come back empty", d)
	}
	if res.ReadAt != "2026-09-26T20:55:00Z" || res.EUDRCutoff != "2020-12-31" {
		t.Fatalf("figures = %+v", res)
	}
	if res.Layer("car") != nil {
		t.Fatal("a register the payload does not hold was found")
	}

	if _, err := parseOverlapPayload([]byte(`{"overlap": null}`)); err == nil {
		t.Fatal("an empty payload was accepted")
	}
}
