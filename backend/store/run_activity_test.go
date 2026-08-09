package store

import "testing"

// TestRunActivityCountsPerDay guards the two properties the activity grid reads.
//
// The grid draws a year of squares from these rows, so an empty square has to
// mean "no run that day". Two failures would both look like an idle year rather
// than like a bug: a nil slice, which marshals to null and leaves the caller
// with nothing to iterate, and a grouping that emitted one row per run instead
// of one per day, which would make every square read as a single run.
//
// It is counted in the database rather than derived from ListRuns because that
// one caps at 100 rows and carries result_json on each; a year read through it
// would show empty weeks that are not empty.
func TestRunActivityCountsPerDay(t *testing.T) {
	s := openTestStore(t)

	empty, err := s.RunActivity(LocalUserID, 365)
	if err != nil {
		t.Fatalf("activity on an empty store: %v", err)
	}
	if empty == nil {
		t.Fatal("nil slice marshals to null, not to an empty list")
	}
	if len(empty) != 0 {
		t.Fatalf("a store with no runs reported %d days", len(empty))
	}

	for i := 0; i < 3; i++ {
		if _, err := s.SaveRun(InferenceRun{
			UserID: LocalUserID, Kind: RunKindClassification, ModelKind: "test",
			PolygonGeoJSON: "{}", Status: "ok", SummaryJSON: "{}",
			ResultJSON: "{}", NDates: 1,
		}); err != nil {
			t.Fatalf("save %d: %v", i, err)
		}
	}

	days, err := s.RunActivity(LocalUserID, 365)
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	// All three were written now, so they share a calendar day.
	if len(days) != 1 {
		t.Fatalf("three runs on one day produced %d rows, want 1", len(days))
	}
	if days[0].Count != 3 {
		t.Fatalf("counted %d, want 3", days[0].Count)
	}
	if days[0].Day == "" {
		t.Fatal("the day is empty, so every square would key on the same string")
	}
}

// TestRunActivityIsPerUser keeps one user's year out of another's grid.
func TestRunActivityIsPerUser(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, Kind: RunKindSolar, ModelKind: "test",
		PolygonGeoJSON: "{}", Status: "ok", SummaryJSON: "{}",
		ResultJSON: "{}", NDates: 1,
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	other, err := s.RunActivity("someone-else", 365)
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("another user's grid carried %d days of runs", len(other))
	}
}
