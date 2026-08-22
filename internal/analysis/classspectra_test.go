package analysis

import (
	"encoding/json"
	"testing"
)

// The spectra travel sidecar -> Go -> frontend as JSON, and Go re-marshals them
// on the way through, so a field the struct does not declare is dropped in
// transit without an error anywhere. The domain fingerprint lost four fields
// exactly that way; this is the same alarm for the same shape of payload.
//
// The two fields that matter most here are the ones a reader cannot recover
// from the numbers: scene_date, without which the curve reads as a seasonal
// mean, and convention, without which it reads as whatever convention the rest
// of the run happens to use.
func TestClassSpectraSurviveTheRoundTrip(t *testing.T) {
	// As sidecar/infer.py emits it, abbreviated to two bands of one class.
	const emitted = `{
		"scene_date": "2025-09-26",
		"scene_id": "S2C_MSIL2A_20250926T133851_R124_T22JBT_20250926T183619",
		"n_scenes": 12,
		"convention": "BOA reflectance, baseline 04.00 offset applied",
		"bands": ["B04", "B08"],
		"points": [
			{"class_id": 39, "name": "Soybean", "color": "#f5b3c8",
			 "band": "B04", "wavelength_nm": 664.6, "n_pixels": 4096,
			 "mean": 0.0869, "sd": 0.0121, "p05": 0.0662, "p95": 0.1080},
			{"class_id": 39, "name": "Soybean", "color": "#f5b3c8",
			 "band": "B08", "wavelength_nm": 832.8, "n_pixels": 4096,
			 "mean": 0.2316, "sd": 0.0304, "p05": 0.1821, "p95": 0.2822}
		]
	}`

	var cs ClassSpectra
	if err := json.Unmarshal([]byte(emitted), &cs); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cs.SceneDate != "2025-09-26" {
		t.Errorf("scene date lost: %q", cs.SceneDate)
	}
	if cs.Convention == "" {
		t.Error("convention lost, so the figure cannot say which reflectance it shows")
	}
	if cs.NScenes != 12 {
		t.Errorf("n_scenes = %d, want 12", cs.NScenes)
	}
	if len(cs.Points) != 2 {
		t.Fatalf("points = %d, want 2", len(cs.Points))
	}
	if cs.Points[1].WavelengthNM != 832.8 || cs.Points[1].Mean != 0.2316 {
		t.Errorf("point 1 = %+v", cs.Points[1])
	}

	// Back out, which is the direction that drops an undeclared field.
	out, err := json.Marshal(cs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var before, after map[string]any
	if err := json.Unmarshal([]byte(emitted), &before); err != nil {
		t.Fatalf("unmarshal emitted: %v", err)
	}
	if err := json.Unmarshal(out, &after); err != nil {
		t.Fatalf("unmarshal round-tripped: %v", err)
	}
	for k := range before {
		if _, ok := after[k]; !ok {
			t.Errorf("field %q dropped in transit", k)
		}
	}
	beforePt := before["points"].([]any)[0].(map[string]any)
	afterPt := after["points"].([]any)[0].(map[string]any)
	for k := range beforePt {
		if _, ok := afterPt[k]; !ok {
			t.Errorf("point field %q dropped in transit", k)
		}
	}
}

// A run with no spectra must marshal without the key at all rather than as a
// null the frontend has to guard: every other optional analysis on
// PredictResult behaves that way, and the frontend reads them by presence.
func TestPredictResultOmitsAbsentClassSpectra(t *testing.T) {
	out, err := json.Marshal(&PredictResult{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := m["class_spectra"]; present {
		t.Error("class_spectra emitted on a run that measured none")
	}
}
