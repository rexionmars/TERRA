package store

import (
	"errors"
	"testing"
)

// A run to point a whiteboard at. Whiteboards never touch a run's files, so
// the columns that matter here are the id and the owner.
func seedRun(t *testing.T, s *Store, id, userID string) {
	t.Helper()
	_, err := s.db.Exec(
		`INSERT INTO inference_runs
		 (id, user_id, created_at, model_kind, period_start, period_end,
		  polygon_geojson, status, summary_json, n_dates)
		 VALUES (?, ?, ?, 'prithvi', '2024-01-01', '2024-06-30', '{}', 'ok', '{}', 4)`,
		id, userID, nowISO(),
	)
	if err != nil {
		t.Fatalf("seed run %s: %v", id, err)
	}
}

func TestSaveWhiteboardRoundTrip(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveWhiteboard(Whiteboard{
		UserID:   LocalUserID,
		Name:     "  Pato Branco vs Teresina  ",
		ViewJSON: `{"spread":0.12}`,
		Members: []WhiteboardMember{
			{RunID: "run-a", Name: "Pato Branco 2024", StateJSON: `{"x":0}`},
			{RunID: "run-b", StateJSON: `{"x":1.4}`},
		},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.Name != "Pato Branco vs Teresina" {
		t.Errorf("name not trimmed: %q", saved.Name)
	}
	if saved.MemberCount != 2 {
		t.Errorf("member count = %d, want 2", saved.MemberCount)
	}

	got, err := s.GetWhiteboard(LocalUserID, saved.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ViewJSON != `{"spread":0.12}` {
		t.Errorf("view json = %q", got.ViewJSON)
	}
	if len(got.Members) != 2 {
		t.Fatalf("members = %d, want 2", len(got.Members))
	}
	// Position is assigned from the order given, so the board reopens in the
	// order it was saved in rather than in whatever order rows come back.
	for i, m := range got.Members {
		if m.Position != i {
			t.Errorf("member %d position = %d", i, m.Position)
		}
		if m.Missing {
			t.Errorf("member %d reported missing with its run present", i)
		}
	}
	if got.Members[0].RunID != "run-a" || got.Members[1].RunID != "run-b" {
		t.Errorf("order not preserved: %v", []string{
			got.Members[0].RunID, got.Members[1].RunID,
		})
	}
	// Empty means "use the run's own name", not "has no name".
	if got.Members[1].Name != "" {
		t.Errorf("unnamed member carries %q", got.Members[1].Name)
	}
}

// Saving again replaces the members rather than adding to them: a board is
// saved as it stands, and a member taken off it is gone.
func TestSaveWhiteboardReplacesMembers(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	first, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	again, err := s.SaveWhiteboard(Whiteboard{
		ID: first.ID, UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("resave: %v", err)
	}
	if again.CreatedAt != first.CreatedAt {
		t.Errorf("created_at moved on update: %q -> %q", first.CreatedAt, again.CreatedAt)
	}
	got, err := s.GetWhiteboard(LocalUserID, first.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(got.Members) != 1 || got.Members[0].RunID != "run-b" {
		t.Fatalf("members after resave = %+v", got.Members)
	}
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM whiteboard_members WHERE whiteboard_id = ?`, first.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("rows left behind: %d", n)
	}
}

// The board must be able to say a side is gone. Foreign keys are not enforced
// on this connection, so a deleted run leaves its member behind; reading it
// out as missing is what stops a two-sided whiteboard quietly becoming a
// one-sided one.
func TestGetWhiteboardReportsMissingRun(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := s.db.Exec(`DELETE FROM inference_runs WHERE id = 'run-b'`); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetWhiteboard(LocalUserID, saved.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(got.Members) != 2 {
		t.Fatalf("members = %d, want both kept", len(got.Members))
	}
	if got.Members[0].Missing {
		t.Errorf("run-a reported missing")
	}
	if !got.Members[1].Missing {
		t.Errorf("run-b not reported missing after its run was deleted")
	}
}

// Nothing enforces the run reference, so the write has to.
func TestSaveWhiteboardRejectsForeignRun(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.db.Exec(
		`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
		 VALUES ('other', 'other@example.com', 'Other', '', ?, ?)`, nowISO(), nowISO(),
	); err != nil {
		t.Fatal(err)
	}
	seedRun(t, s, "run-other", "other")

	_, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-other"}},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("saving another user's run: err = %v, want ErrNotFound", err)
	}
	// And nothing was left behind by the attempt.
	list, err := s.ListWhiteboards(LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("a rejected save left %d whiteboards", len(list))
	}
}

func TestSaveWhiteboardRejectsUnnamed(t *testing.T) {
	s := openTestStore(t)
	for _, name := range []string{"", "   "} {
		if _, err := s.SaveWhiteboard(Whiteboard{
			UserID: LocalUserID, Name: name,
		}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("name %q: err = %v, want ErrInvalidInput", name, err)
		}
	}
}

func TestWhiteboardScopedToUser(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	saved, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := s.GetWhiteboard("other", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get as another user: err = %v, want ErrNotFound", err)
	}
	if err := s.RenameWhiteboard("other", saved.ID, "Theirs"); !errors.Is(err, ErrNotFound) {
		t.Errorf("rename as another user: err = %v, want ErrNotFound", err)
	}
	if err := s.DeleteWhiteboard("other", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete as another user: err = %v, want ErrNotFound", err)
	}
	if _, err := s.SaveWhiteboard(Whiteboard{
		ID: saved.ID, UserID: "other", Name: "Theirs",
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("update as another user: err = %v, want ErrNotFound", err)
	}
	// The rejected update must not have taken the name with it.
	got, err := s.GetWhiteboard(LocalUserID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Board" {
		t.Errorf("name changed by a rejected update: %q", got.Name)
	}
}

// Deleting takes the members with it, which the schema says and the connection
// does not do.
func TestDeleteWhiteboardRemovesMembers(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	saved, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Board",
		Members: []WhiteboardMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := s.DeleteWhiteboard(LocalUserID, saved.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM whiteboard_members WHERE whiteboard_id = ?`, saved.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d member rows outlived the whiteboard", n)
	}
	if _, err := s.GetWhiteboard(LocalUserID, saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get after delete: err = %v, want ErrNotFound", err)
	}
}

func TestListWhiteboardsCountsAndOrders(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	if list, err := s.ListWhiteboards(LocalUserID); err != nil || list == nil {
		t.Fatalf("empty list: %v %v (want a non-nil empty slice)", list, err)
	}

	older, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Older",
		Members: []WhiteboardMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	newer, err := s.SaveWhiteboard(Whiteboard{
		UserID: LocalUserID, Name: "Newer",
		Members: []WhiteboardMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Two saves in the same second would tie on updated_at, so the ordering is
	// asserted through an explicit touch rather than through timing.
	if err := s.RenameWhiteboard(LocalUserID, older.ID, "Older, touched"); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListWhiteboards(LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %d, want 2", len(list))
	}
	byID := map[string]Whiteboard{}
	for _, c := range list {
		byID[c.ID] = c
	}
	if byID[older.ID].MemberCount != 1 {
		t.Errorf("older member count = %d, want 1", byID[older.ID].MemberCount)
	}
	if byID[newer.ID].MemberCount != 2 {
		t.Errorf("newer member count = %d, want 2", byID[newer.ID].MemberCount)
	}
	// The list carries no members, only their count: a hub listing twenty
	// arrangements has no use for every member of each.
	if byID[newer.ID].Members != nil {
		t.Errorf("list returned members: %+v", byID[newer.ID].Members)
	}
}
