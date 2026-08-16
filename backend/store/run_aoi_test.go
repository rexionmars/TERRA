package store

import "testing"

// TestRunAoiIDRoundTrip pins the link between a run and the area it is of.
//
// The board reads this to keep a drawing and the runs over it as one subject.
// Without it the same ground is an area per drawing PLUS an area per run, which
// is what two drawings and two runs turned into four outlines on the board.
//
// The empty case is the one that has to keep working: every row written before
// this column existed carries no link, and both readers select
// COALESCE(aoi_id,”) so those rows resolve by geometry on the frontend instead
// of failing to load. A migration that started requiring a value, or a reader
// that dropped the column, would fail here rather than surfacing as a board
// that quietly draws every field twice again.
func TestRunAoiIDRoundTrip(t *testing.T) {
	s := openTestStore(t)

	linked, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "test", PolygonGeoJSON: "{}",
		Status: "ok", SummaryJSON: "{}", ResultJSON: "{}", NDates: 1,
		AoiID: "aoi:abc",
	})
	if err != nil {
		t.Fatalf("save linked: %v", err)
	}
	got, err := s.GetRun(LocalUserID, linked.ID)
	if err != nil {
		t.Fatalf("get linked: %v", err)
	}
	if got.AoiID != "aoi:abc" {
		t.Fatalf("aoi_id round trip: got %q, want %q", got.AoiID, "aoi:abc")
	}

	// A run over an example area, or one written before the column existed.
	loose, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "test", PolygonGeoJSON: "{}",
		Status: "ok", SummaryJSON: "{}", ResultJSON: "{}", NDates: 1,
	})
	if err != nil {
		t.Fatalf("save unlinked: %v", err)
	}
	if got, err := s.GetRun(LocalUserID, loose.ID); err != nil {
		t.Fatalf("get unlinked: %v", err)
	} else if got.AoiID != "" {
		t.Fatalf("unlinked run: got %q, want empty", got.AoiID)
	}

	// The list reads the column too: the board resolves areas from it, and a
	// list that dropped it would leave every run looking unlinked.
	runs, err := s.ListRuns(LocalUserID, 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	seen := map[string]string{}
	for _, r := range runs {
		seen[r.ID] = r.AoiID
	}
	if seen[linked.ID] != "aoi:abc" {
		t.Fatalf("list linked: got %q, want %q", seen[linked.ID], "aoi:abc")
	}
	if seen[loose.ID] != "" {
		t.Fatalf("list unlinked: got %q, want empty", seen[loose.ID])
	}
}
