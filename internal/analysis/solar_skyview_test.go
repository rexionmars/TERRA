package analysis

import (
	"encoding/json"
	"testing"
)

// The sidecar reports the sky view factor whether or not it applied it. A field
// dropped in the Go mirror is invisible: the JSON decodes, the overlay renders,
// and the verdict silently becomes "not applied".
func TestSolarTerrainCarriesTheSkyViewVerdict(t *testing.T) {
	raw := []byte(`{"poa_min":1,"poa_max":2,"beam_fraction":0.64,
	 "sky_view":{"applied":true,"mean_horizon_deg":9.7,"max_horizon_deg":31.2,
	 "threshold_deg":2.0,"diffuse_loss_mean_pct":2.84,"diffuse_loss_max_pct":11.5}}`)
	var p solarTerrainSidecarPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.SkyView == nil {
		t.Fatal("sky_view dropped at the boundary")
	}
	if !p.SkyView.Applied {
		t.Error("applied verdict lost")
	}
	if p.SkyView.ThresholdDeg != 2.0 {
		t.Errorf("threshold = %v, want 2.0", p.SkyView.ThresholdDeg)
	}
	if p.SkyView.DiffuseLossMeanPct == nil || *p.SkyView.DiffuseLossMeanPct != 2.84 {
		t.Error("diffuse loss lost")
	}

	// Not applied is a real verdict, not a missing one: the losses stay null
	// while the horizon evidence survives.
	var q solarTerrainSidecarPayload
	if err := json.Unmarshal([]byte(`{"sky_view":{"applied":false,
	 "mean_horizon_deg":0.3,"threshold_deg":2.0,
	 "diffuse_loss_mean_pct":null}}`), &q); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if q.SkyView == nil || q.SkyView.Applied {
		t.Fatal("not-applied verdict lost")
	}
	if q.SkyView.DiffuseLossMeanPct != nil {
		t.Error("a loss was reported for a run that did not apply one")
	}
	if q.SkyView.MeanHorizonDeg != 0.3 {
		t.Error("the evidence behind the verdict was dropped")
	}
}
