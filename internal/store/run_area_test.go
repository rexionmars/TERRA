package store

import "testing"

// The link between a run and the ground it was measured on, both ways round.
//
// The board reads this to keep an area and the runs over it as one subject.
// Without it the same ground is an area per drawing PLUS an area per run, which
// is what two drawings and two runs turned into four outlines on the board.
//
// The empty case has to keep working: a run restored from a shape that was
// never made an area carries no link, and every reader selects
// COALESCE(area_id,”) so those rows resolve by geometry on the frontend rather
// than failing to load. A reader that dropped the column would fail here rather
// than surfacing as a board that quietly draws every field twice again.
//
// It was TestRunAoiIDRoundTrip, over inference_runs.aoi_id: the same idea
// against the JSON-array catalogue that preceded the `areas` table. That column
// is dropped at schema 4, and an id like "aoi:abc" -- which this test used to
// assert round-tripped -- can no longer be written by anything.
func TestRunAreaIDRoundTrip(t *testing.T) {
	s := openTestStore(t)

	linked, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "test", PolygonGeoJSON: "{}",
		Status: "ok", SummaryJSON: "{}", ResultJSON: "{}", NDates: 1,
		AreaID: "area-abc",
	})
	if err != nil {
		t.Fatalf("save linked: %v", err)
	}
	got, err := s.GetRun(LocalUserID, linked.ID)
	if err != nil {
		t.Fatalf("get linked: %v", err)
	}
	if got.AreaID != "area-abc" {
		t.Fatalf("area_id round trip: got %q, want %q", got.AreaID, "area-abc")
	}

	// A run put back from a shape that was never catalogued.
	loose, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "test", PolygonGeoJSON: "{}",
		Status: "ok", SummaryJSON: "{}", ResultJSON: "{}", NDates: 1,
	})
	if err != nil {
		t.Fatalf("save unlinked: %v", err)
	}
	if got, err := s.GetRun(LocalUserID, loose.ID); err != nil {
		t.Fatalf("get unlinked: %v", err)
	} else if got.AreaID != "" {
		t.Fatalf("unlinked run: got %q, want empty", got.AreaID)
	}

	// The list reads the column too: the board resolves areas from it, and a
	// list that dropped it would leave every run looking unlinked.
	runs, err := s.ListRuns(LocalUserID, 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	seen := map[string]string{}
	for _, r := range runs {
		seen[r.ID] = r.AreaID
	}
	if seen[linked.ID] != "area-abc" {
		t.Fatalf("list linked: got %q, want %q", seen[linked.ID], "area-abc")
	}
	if seen[loose.ID] != "" {
		t.Fatalf("list unlinked: got %q, want empty", seen[loose.ID])
	}
}

// The column the old link lived in is gone from the table, not merely unused.
//
// A column nothing writes always reads ” and will disagree with the table one
// day; this is the assertion that the drop actually ran, on a fresh database
// and on one migrated up from an older version.
func TestAoiIDColumnIsDropped(t *testing.T) {
	s := openTestStore(t)
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info('inference_runs') WHERE name = 'aoi_id'`,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("inference_runs still declares aoi_id")
	}
}
