package analysis

import (
	"context"
	"encoding/json"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
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

// findPython locates an interpreter that can import numpy, or skips.
//
// The two tests above pass against hand-written JSON and the sidecar's own
// suite passes against fingerprints built in-process. Both are necessary and
// neither can see a payload that is assembled in TypeScript, which is where the
// next drop happened. This runs the real binary.
func findPython(t *testing.T) string {
	t.Helper()
	// Outside a Wails context EventsEmit terminates the process, so the sidecar
	// boundary is unreachable from a test until this is stubbed.
	prev := emitProgress
	emitProgress = func(context.Context, string, ...any) {}
	t.Cleanup(func() { emitProgress = prev })
	candidates := []string{os.Getenv("TERRA_PYTHON")}
	if root, err := filepath.Abs(filepath.Join(repoRoot(t), "..")); err == nil {
		candidates = append(candidates, filepath.Join(root, ".venv", "bin", "python"))
	}
	candidates = append(candidates, "python3")
	for _, c := range candidates {
		if c == "" {
			continue
		}
		p, err := exec.LookPath(c)
		if err != nil {
			continue
		}
		if err := exec.Command(p, "-c", "import numpy").Run(); err == nil {
			return p
		}
	}
	t.Skip("no python with numpy available")
	return ""
}

// synthFingerprint is a fingerprint of the shape build_fingerprint emits,
// shifted by `shift` training standard deviations on every feature.
func synthFingerprint(d, n int, shift float64, seed int64) map[string]any {
	rng := rand.New(rand.NewSource(seed))
	mean := make([]float64, d)
	varr := make([]float64, d)
	zMean := make([]float64, d)
	zVar := make([]float64, d)
	names := make([]string, d)
	imp := make([]float64, d)
	for i := range mean {
		mean[i] = shift + rng.NormFloat64()*0.01
		varr[i] = 1
		zMean[i] = shift
		zVar[i] = 1
		names[i] = "f" + string(rune('a'+i%26))
		imp[i] = 1 / float64(d)
	}
	sample := make([][]float64, n)
	for r := range sample {
		row := make([]float64, d)
		for c := range row {
			row[c] = shift + rng.NormFloat64()
		}
		sample[r] = row
	}
	return map[string]any{
		"space":               "spectral_rf",
		"n_features":          d,
		"n_pixels":            4096,
		"n_sample":            n,
		"mean":                mean,
		"var":                 varr,
		"z_mean":              zMean,
		"z_var":               zVar,
		"feature_names":       names,
		"feature_importances": imp,
		"sample":              sample,
	}
}

// The Go-to-sidecar path, end to end: a fingerprint carrying the training
// moments must come back standardised, with an MMD and a feature-shift table.
//
// WHAT THIS COVERS, AND WHAT IT DOES NOT. Standardisation has broken twice --
// first because the Go struct declared no z_mean, then because the TypeScript
// request builder enumerated nine of the thirteen fingerprint fields and
// omitted the same four. Both times every existing test passed, because each
// asserted against a literal written for the layer it tested.
//
// This closes the Go-to-sidecar half by asserting on the real binary's OUTPUT
// rather than on the shape of a request, so it is insensitive to how the
// figures are computed. It does NOT cover the TypeScript half: nothing here can
// see a payload assembled in the frontend, and the frontend has no test runner.
// That half is guarded structurally instead -- `fingerprintPayload` passes the
// fingerprint through whole rather than enumerating, so there is no list left
// to fall out of step with the type.
func TestDomainShiftStandardisesOverTheRealSidecar(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	const d, n = 20, 64
	report, err := r.AnalyzeDomainShift(ctx, DomainShiftRequest{
		FingerprintA: synthFingerprint(d, n, 0, 1),
		// Three training standard deviations apart on every feature, so the
		// figures below have to be non-zero if they were computed at all.
		FingerprintB: synthFingerprint(d, n, 3, 2),
	})
	if err != nil {
		t.Fatalf("AnalyzeDomainShift: %v", err)
	}

	if !report.SameSpace {
		t.Fatalf("same_space=false for two spectral_rf fingerprints of width %d", d)
	}
	// The one that was false on every comparison the application ever made.
	if !report.Standardised {
		t.Fatal("standardised=false although both fingerprints carry z_mean and z_var")
	}
	if report.CVAMagnitudeSD == nil {
		t.Error("cva_magnitude_sd is null although the comparison standardised")
	}
	if report.MMDRBF == nil || report.MMDRBF.MMD2 == nil {
		t.Fatalf("mmd_rbf was not computed: %+v", report.MMDRBF)
	}
	if report.MMDRBF.NA != n || report.MMDRBF.NB != n {
		t.Errorf("mmd_rbf n=%d/%d want %d/%d", report.MMDRBF.NA, report.MMDRBF.NB, n, n)
	}
	// Twelve rows by default, or every feature where there are fewer.
	if len(report.FeatureShift) == 0 {
		t.Fatal("feature_shift is empty although the comparison standardised")
	}
	if got := len(report.FeatureShift); got != 12 {
		t.Errorf("feature_shift rows=%d want 12", got)
	}
	// A 3 SD shift on every feature must show up as such, which is what proves
	// the moments were used rather than merely carried.
	if gap := report.FeatureShift[0].GapSD; gap < 2.5 || gap > 3.5 {
		t.Errorf("gap_sd=%v want about 3", gap)
	}
	// The projection follows the same space as the distances.
	if report.Projection != nil && report.Projection.Space != "standardised" {
		t.Errorf("projection space=%q want standardised", report.Projection.Space)
	}
}

// A fingerprint stripped of its moments must refuse loudly, not quietly.
//
// This is the state the application was in on every comparison it ever made,
// and the reason it went unnoticed is that the refusal is indistinguishable
// from a run that genuinely has no scaler. The assertions pin the symptoms so
// that a future drop anywhere on the path shows up as this shape rather than
// as figures that merely look smaller than expected.
func TestDomainShiftRefusesWithoutTheTrainingMoments(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	strip := func(fp map[string]any) map[string]any {
		for _, k := range []string{"z_mean", "z_var", "feature_names", "feature_importances"} {
			delete(fp, k)
		}
		return fp
	}
	report, err := r.AnalyzeDomainShift(ctx, DomainShiftRequest{
		FingerprintA: strip(synthFingerprint(20, 32, 0, 5)),
		FingerprintB: strip(synthFingerprint(20, 32, 3, 6)),
	})
	if err != nil {
		t.Fatalf("AnalyzeDomainShift: %v", err)
	}

	// The space is still the same; only the moments are gone.
	if !report.SameSpace {
		t.Error("same_space=false although both are spectral_rf of one width")
	}
	if report.Standardised {
		t.Fatal("standardised=true without z_mean on either side")
	}
	if report.CVAMagnitudeSD != nil {
		t.Errorf("cva_magnitude_sd=%v without the moments", *report.CVAMagnitudeSD)
	}
	// Not computed at all, rather than computed on raw features: an MMD whose
	// bandwidth was set by whichever column carries the largest raw units is
	// not a smaller version of the right answer.
	if report.MMDRBF != nil && report.MMDRBF.MMD2 != nil {
		t.Errorf("mmd2=%v was computed unstandardised", *report.MMDRBF.MMD2)
	}
	if len(report.FeatureShift) != 0 {
		t.Errorf("feature_shift has %d rows without the moments", len(report.FeatureShift))
	}
	// The raw magnitude survives as provenance, so the panel has something to
	// show beside the warning.
	if report.CVAMagnitude == nil {
		t.Error("cva_magnitude is null; the raw figure is kept for provenance")
	}
	if report.Projection != nil && report.Projection.Space != "raw" {
		t.Errorf("projection space=%q want raw", report.Projection.Space)
	}
}

// A cohort: one source, several targets, one call, and the qualifiers resolved.
//
// The row that cannot sit on the shared axis is the case worth pinning. A
// Prithvi run in the cohort is not a target that scored badly, it is a target
// measured in other units, and a view that plots it beside the rest reports a
// distance built from two different quantities. `comparable` is what lets the
// caller separate the two without re-deriving the rule.
func TestDomainShiftCohortMeasuresEveryTargetAndFlagsTheOddOne(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	// An NDVI-only fingerprint, as a Prithvi or temporal-transformer run makes.
	ndviOnly := map[string]any{
		"space":      "ndvi_only",
		"n_features": 1,
		"n_pixels":   512,
		"n_sample":   32,
		"mean":       []float64{0.4},
		"var":        []float64{0.02},
		"sample":     [][]float64{{0.39}, {0.41}, {0.40}},
	}

	cohort, err := r.AnalyzeDomainShiftCohort(ctx, DomainShiftCohortRequest{
		Source: DomainShiftCohortSide{
			ID: "src", Label: "Northeast",
			Fingerprint: synthFingerprint(20, 48, 0, 21),
		},
		Targets: []DomainShiftCohortSide{
			{ID: "t1", Label: "South", Fingerprint: synthFingerprint(20, 48, 1, 22)},
			{ID: "t2", Label: "North", Fingerprint: synthFingerprint(20, 48, 3, 23)},
			{ID: "t3", Label: "Prithvi run", Fingerprint: ndviOnly},
		},
	})
	if err != nil {
		t.Fatalf("AnalyzeDomainShiftCohort: %v", err)
	}

	if cohort.Source.ID != "src" || cohort.Source.Label != "Northeast" {
		t.Errorf("source identity lost: %+v", cohort.Source)
	}
	if len(cohort.Targets) != 3 {
		t.Fatalf("targets=%d want 3", len(cohort.Targets))
	}
	// Order is the caller's, so a row can be matched back to what was sent.
	for i, want := range []string{"t1", "t2", "t3"} {
		if cohort.Targets[i].ID != want {
			t.Errorf("target %d id=%q want %q", i, cohort.Targets[i].ID, want)
		}
	}

	near, far, odd := cohort.Targets[0], cohort.Targets[1], cohort.Targets[2]
	for _, row := range []DomainShiftCohortRow{near, far} {
		if !row.Comparable {
			t.Errorf("%s is not comparable: same_space=%v standardised=%v",
				row.Label, row.SameSpace, row.Standardised)
		}
		if row.CVAMagnitudeSD == nil || row.MMDRBF == nil || row.MMDRBF.MMD2 == nil {
			t.Errorf("%s carries no standardised distance: %+v", row.Label, row)
		}
	}
	// Three standard deviations must read as further than one; a cohort whose
	// distances do not order is not an axis.
	if *far.CVAMagnitudeSD <= *near.CVAMagnitudeSD {
		t.Errorf("cva_magnitude_sd did not order: %v (1 SD) vs %v (3 SD)",
			*near.CVAMagnitudeSD, *far.CVAMagnitudeSD)
	}

	if odd.Comparable {
		t.Error("an ndvi_only target was marked comparable against a spectral source")
	}
	if odd.SameSpace {
		t.Error("ndvi_only and spectral_rf reported as the same space")
	}
	if odd.CVAMagnitudeSD != nil {
		t.Errorf("a standardised distance was reported across spaces: %v", *odd.CVAMagnitudeSD)
	}
}

// Two fingerprints of the same NAME and different width are not the same space.
//
// The test guards a distinction that used to be a string comparison alone: a
// model refitted over more dates produces a wider spectral_rf fingerprint, and
// the change-vector magnitude then truncated to the shorter of the two in
// silence -- the failure the module documents for spectral-against-NDVI, one
// level up and harder to see because both sides answer to the same name.
func TestDomainShiftRefusesTwoWidthsOfOneSpace(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	report, err := r.AnalyzeDomainShift(ctx, DomainShiftRequest{
		FingerprintA: synthFingerprint(20, 32, 0, 3),
		FingerprintB: synthFingerprint(24, 32, 0, 4),
	})
	if err != nil {
		t.Fatalf("AnalyzeDomainShift: %v", err)
	}
	if report.SameSpace {
		t.Error("same_space=true for spectral_rf fingerprints of width 20 and 24")
	}
	if report.Standardised {
		t.Error("standardised=true across two widths")
	}
	if report.CVAMagnitudeSD != nil {
		t.Errorf("cva_magnitude_sd=%v reported across two widths", *report.CVAMagnitudeSD)
	}
}
