package store

import "testing"

// TestRunKindsRoundTrip records why adding RunKindWind and RunKindFlood needed
// no migration.
//
// The kind column was added by an ALTER with DEFAULT 'classification' and no
// CHECK constraint, and both readers select COALESCE(kind,'classification'), so
// a database written before a kind existed keeps working and a row of a new
// kind is simply a new row. This asserts that rather than assuming it: a schema
// change that started rejecting an unknown kind, or a reader that started
// normalising one away, would fail here instead of surfacing as a run that
// saves and reopens as the wrong product.
func TestRunKindsRoundTrip(t *testing.T) {
	s := openTestStore(t)
	for _, kind := range []string{
		RunKindClassification, RunKindWater, RunKindSolar, RunKindWind,
		RunKindFlood,
	} {
		saved, err := s.SaveRun(InferenceRun{
			UserID: LocalUserID, Kind: kind, ModelKind: "test",
			PolygonGeoJSON: "{}", Status: "ok", SummaryJSON: "{}",
			ResultJSON: "{}", NDates: 1,
		})
		if err != nil {
			t.Fatalf("save %s: %v", kind, err)
		}
		got, err := s.GetRun(LocalUserID, saved.ID)
		if err != nil {
			t.Fatalf("get %s: %v", kind, err)
		}
		if got.Kind != kind {
			t.Fatalf("kind round trip: got %q, want %q", got.Kind, kind)
		}
	}

	// An empty kind is still normalised to a classification, which is what
	// makes rows written before the column existed readable.
	saved, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "test", PolygonGeoJSON: "{}",
		Status: "ok", SummaryJSON: "{}", ResultJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRun(LocalUserID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != RunKindClassification {
		t.Fatalf("empty kind normalised to %q, want %q", got.Kind, RunKindClassification)
	}

	runs, err := s.ListRuns(LocalUserID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 6 {
		t.Fatalf("listed %d runs, want 6", len(runs))
	}
	seen := map[string]bool{}
	for _, r := range runs {
		seen[r.Kind] = true
	}
	if !seen[RunKindWind] {
		t.Fatal("a wind run did not survive ListRuns")
	}
	if !seen[RunKindFlood] {
		t.Fatal("a flood run did not survive ListRuns")
	}
}
