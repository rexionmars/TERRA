package backend

import (
	"encoding/json"
	"testing"
)

// A fingerprint travels sidecar -> Go -> frontend -> Go -> sidecar. Go
// unmarshals it into DomainFingerprint and marshals it back out, so any field
// the struct does not declare is dropped in transit.
//
// That is not hypothetical. build_fingerprint gained z_mean, z_var,
// feature_names and feature_importances -- the moments in training units that
// decide whether a comparison can be standardised at all -- and the struct
// declared none of them, so compare_fingerprints took its refusing branch on
// every real comparison while passing its own tests. Standardisation was
// reachable in the sidecar and unreachable in the application.
//
// The failure was silent because a dropped optional field is indistinguishable
// from one the sidecar never sent. This test is the alarm that was missing.
func TestFingerprintSurvivesTheRoundTrip(t *testing.T) {
	// As the sidecar emits it, abbreviated to one feature.
	const emitted = `{
		"space": "spectral_rf",
		"n_features": 1,
		"n_pixels": 4096,
		"n_sample": 512,
		"mean": [0.25],
		"var": [0.01],
		"z_mean": [1.5],
		"z_var": [0.9],
		"feature_names": ["B04_mean"],
		"feature_importances": [0.31],
		"sample": [[0.24], [0.26]]
	}`

	var fp DomainFingerprint
	if err := json.Unmarshal([]byte(emitted), &fp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// The moments the standardised path needs, checked by name: this is what
	// the struct used to drop.
	if len(fp.ZMean) != 1 || fp.ZMean[0] != 1.5 {
		t.Errorf("z_mean lost in transit: %v", fp.ZMean)
	}
	if len(fp.ZVar) != 1 || fp.ZVar[0] != 0.9 {
		t.Errorf("z_var lost in transit: %v", fp.ZVar)
	}
	if len(fp.FeatureNames) != 1 || fp.FeatureNames[0] != "B04_mean" {
		t.Errorf("feature_names lost in transit: %v", fp.FeatureNames)
	}
	if len(fp.FeatureImportances) != 1 || fp.FeatureImportances[0] != 0.31 {
		t.Errorf("feature_importances lost in transit: %v", fp.FeatureImportances)
	}

	// And the whole thing again on the way out, which is the direction that
	// actually reaches the sidecar.
	out, err := json.Marshal(fp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	for _, key := range []string{
		"space", "n_features", "n_pixels", "n_sample", "mean", "var",
		"z_mean", "z_var", "feature_names", "feature_importances", "sample",
	} {
		if _, ok := back[key]; !ok {
			t.Errorf("%q did not survive the round trip", key)
		}
	}
}

// The report travels the other way, and the same class of drop applies. It did
// happen: the sidecar was renamed to emit mmd_rbf while this struct declared
// MMDLinear with the tag "mmd_linear", so the figure the panel read could not
// be populated by any run.
func TestDomainShiftReportCarriesWhatTheSidecarEmits(t *testing.T) {
	const emitted = `{
		"space_a": "spectral_rf",
		"space_b": "spectral_rf",
		"kl_ndvi": 0.42,
		"same_space": true,
		"standardised": true,
		"cva_magnitude": 12.5,
		"cva_magnitude_sd": 3.1,
		"mmd_rbf": {"mmd2": 0.18, "gamma": 0.05, "n_a": 512, "n_b": 480},
		"feature_shift": [
			{"feature": "B08_mean", "z_a": 0.2, "z_b": 3.4,
			 "gap_sd": 3.2, "importance": 0.12, "weighted": 0.384}
		]
	}`

	var r DomainShiftReport
	if err := json.Unmarshal([]byte(emitted), &r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// The qualifiers. Without them every distance below is unqualified: an
	// 80-feature spectral fingerprint against a one-column NDVI one produces
	// a number from two different quantities.
	if !r.SameSpace || !r.Standardised {
		t.Errorf("qualifiers lost: same_space=%v standardised=%v", r.SameSpace, r.Standardised)
	}
	if r.CVAMagnitudeSD == nil || *r.CVAMagnitudeSD != 3.1 {
		t.Errorf("cva_magnitude_sd lost: %v", r.CVAMagnitudeSD)
	}
	// An object, not a scalar: MMD is not comparable across bandwidths, so
	// the gamma the median heuristic chose has to travel with the estimate.
	if r.MMDRBF == nil || r.MMDRBF.MMD2 == nil || *r.MMDRBF.MMD2 != 0.18 {
		t.Fatalf("mmd_rbf lost: %+v", r.MMDRBF)
	}
	if r.MMDRBF.Gamma == nil || r.MMDRBF.NA != 512 || r.MMDRBF.NB != 480 {
		t.Errorf("mmd_rbf is incomplete: %+v", r.MMDRBF)
	}
	// The table that says WHERE the domains differ rather than only that they
	// do, which a scalar distance cannot.
	if len(r.FeatureShift) != 1 {
		t.Fatalf("feature_shift lost: %v", r.FeatureShift)
	}
	if got := r.FeatureShift[0]; got.Feature != "B08_mean" || got.GapSD != 3.2 {
		t.Errorf("feature_shift row is wrong: %+v", got)
	}
}
