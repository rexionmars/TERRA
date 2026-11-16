package analysis

import (
	"strings"
	"testing"
)

// The sidecar's payload read into what the interface receives: the region left
// empty where the sidecar sends null, the observations with their flags, and a
// trajectory whose bounds do not run beside its dates refused.
func TestParseTrajectoryPayload(t *testing.T) {
	raw := `{"trajectory": {
		"dates": ["2020-09-05", "2020-09-06"], "ndvi": [0.31, 0.32], "lower": [0.2, 0.21], "upper": [0.42, 0.43],
		"level": 0.95,
		"observations": [{"date": "2020-09-05", "ndvi": 0.3, "clear_fraction": 0.91, "kept": true},
		                 {"date": "2020-09-06", "ndvi": 0.6, "clear_fraction": 0.4, "kept": false}],
		"scenes_found": 4, "scenes_read": 4, "min_clear_fraction": 0.3,
		"region": null, "scale": "global", "multiplier": 0.8,
		"model": {"id": "gp_series", "version": "0.1.0", "name": "Gaussian Process", "digest": "2055cc9e"}
	}}`
	res, err := parseTrajectoryPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if res.Region != "" || res.Scale != "global" || res.Multiplier != 0.8 || res.Level != 0.95 {
		t.Fatalf("scale = %q %q %v %v", res.Region, res.Scale, res.Multiplier, res.Level)
	}
	if len(res.Observations) != 2 || res.Observations[1].Kept || res.Observations[0].ClearFraction != 0.91 {
		t.Fatalf("observations = %+v", res.Observations)
	}
	if res.Model.Name != "Gaussian Process" || res.Model.Digest != "2055cc9e" {
		t.Fatalf("model = %+v", res.Model)
	}

	_, err = parseTrajectoryPayload([]byte(`{"trajectory": {"dates": ["2020-09-05"], "ndvi": [0.3], "lower": [], "upper": [0.4]}}`))
	if err == nil || !strings.Contains(err.Error(), "1 dates with 1 NDVI values and 0 and 1 bounds") {
		t.Fatalf("got %v, want the short bound refused", err)
	}
	if _, err := parseTrajectoryPayload([]byte(`{}`)); err == nil {
		t.Fatal("an empty payload was read as a trajectory")
	}
	empty, err := parseTrajectoryPayload([]byte(`{"trajectory": {"dates": null, "observations": null}}`))
	if err != nil {
		t.Fatal(err)
	}
	if empty.Dates == nil || empty.Observations == nil {
		t.Fatal("absent lists came back as null")
	}
}
