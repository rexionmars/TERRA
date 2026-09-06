package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// A run to point a studio at. Studios never touch a run's files, so
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

func TestSaveStudioRoundTrip(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveStudio(Studio{
		UserID:   LocalUserID,
		Name:     "  Pato Branco vs Teresina  ",
		ViewJSON: `{"spread":0.12}`,
		Members: []StudioMember{
			{RunID: "run-a"},
			{RunID: "run-b"},
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

	got, err := s.GetStudio(LocalUserID, saved.ID)
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
}

// Saving again replaces the members rather than adding to them: a board is
// saved as it stands, and a member taken off it is gone.
func TestSaveStudioReplacesMembers(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	first, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	again, err := s.SaveStudio(Studio{
		ID: first.ID, UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("resave: %v", err)
	}
	if again.CreatedAt != first.CreatedAt {
		t.Errorf("created_at moved on update: %q -> %q", first.CreatedAt, again.CreatedAt)
	}
	got, err := s.GetStudio(LocalUserID, first.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(got.Members) != 1 || got.Members[0].RunID != "run-b" {
		t.Fatalf("members after resave = %+v", got.Members)
	}
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM studio_members WHERE studio_id = ?`, first.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("rows left behind: %d", n)
	}
}

// The board must be able to say a side is gone. Foreign keys are not enforced
// on this connection, so a deleted run leaves its member behind; reading it
// out as missing is what stops a two-sided studio quietly becoming a
// one-sided one.
func TestGetStudioReportsMissingRun(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := s.db.Exec(`DELETE FROM inference_runs WHERE id = 'run-b'`); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetStudio(LocalUserID, saved.ID)
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
func TestSaveStudioRejectsForeignRun(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.db.Exec(
		`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
		 VALUES ('other', 'other@example.com', 'Other', '', ?, ?)`, nowISO(), nowISO(),
	); err != nil {
		t.Fatal(err)
	}
	seedRun(t, s, "run-other", "other")

	_, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-other"}},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("saving another user's run: err = %v, want ErrNotFound", err)
	}
	// And nothing was left behind by the attempt.
	list, err := s.ListStudios(LocalUserID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("a rejected save left %d studios", len(list))
	}
}

func TestSaveStudioRejectsUnnamed(t *testing.T) {
	s := openTestStore(t)
	for _, name := range []string{"", "   "} {
		if _, err := s.SaveStudio(Studio{
			UserID: LocalUserID, Name: name,
		}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("name %q: err = %v, want ErrInvalidInput", name, err)
		}
	}
}

func TestStudioScopedToUser(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	saved, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := s.GetStudio("other", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get as another user: err = %v, want ErrNotFound", err)
	}
	if err := s.RenameStudio("other", saved.ID, "Theirs"); !errors.Is(err, ErrNotFound) {
		t.Errorf("rename as another user: err = %v, want ErrNotFound", err)
	}
	if err := s.DeleteStudio("other", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete as another user: err = %v, want ErrNotFound", err)
	}
	if _, err := s.SaveStudio(Studio{
		ID: saved.ID, UserID: "other", Name: "Theirs",
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("update as another user: err = %v, want ErrNotFound", err)
	}
	// The rejected update must not have taken the name with it.
	got, err := s.GetStudio(LocalUserID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Board" {
		t.Errorf("name changed by a rejected update: %q", got.Name)
	}
}

// Deleting takes the members with it, which the schema says and the connection
// does not do.
func TestDeleteStudioRemovesMembers(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	saved, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Board",
		Members: []StudioMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := s.DeleteStudio(LocalUserID, saved.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM studio_members WHERE studio_id = ?`, saved.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d member rows outlived the studio", n)
	}
	if _, err := s.GetStudio(LocalUserID, saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get after delete: err = %v, want ErrNotFound", err)
	}
}

func TestListStudiosCountsAndOrders(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	if list, err := s.ListStudios(LocalUserID, ""); err != nil || list == nil {
		t.Fatalf("empty list: %v %v (want a non-nil empty slice)", list, err)
	}

	older, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Older",
		Members: []StudioMember{{RunID: "run-a"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	newer, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Newer",
		Members: []StudioMember{{RunID: "run-a"}, {RunID: "run-b"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Two saves in the same second would tie on updated_at, so the ordering is
	// asserted through an explicit touch rather than through timing.
	if err := s.RenameStudio(LocalUserID, older.ID, "Older, touched"); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListStudios(LocalUserID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %d, want 2", len(list))
	}
	byID := map[string]Studio{}
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

/*
A board belongs to a project, and only arranges that project's runs.

Both halves matter and neither is enforced by the database: foreign keys here
are declared and never turned on, so the only thing keeping a board from
naming another project's run is the check in SaveStudio, and the only thing
keeping the menu from offering another project's board is the filter in
ListStudios. A board that quietly mixes projects is how one project came to
show fifty-eight runs from several fields.
*/
func TestStudioBelongsToItsProject(t *testing.T) {
	s := openTestStore(t)
	mine := seedProject(t, s, "Tocantins")
	other := seedProject(t, s, "Piaui")

	runIn := func(p *Project, id string) string {
		t.Helper()
		if _, err := s.SaveRun(InferenceRun{
			ID: id, UserID: LocalUserID, CreatedAt: nowISO(),
			ModelKind: "spectral", Status: "ok",
			PolygonGeoJSON: someGround, ProjectID: p.ID,
		}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	ours := runIn(mine, "run-ours")
	theirs := runIn(other, "run-theirs")

	board, err := s.SaveStudio(Studio{
		UserID: LocalUserID, ProjectID: mine.ID, Name: "Field notes",
		Members: []StudioMember{{RunID: ours}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if board.ProjectID != mine.ID {
		t.Errorf("board project is %q, want %q", board.ProjectID, mine.ID)
	}

	// The run of another project is refused, and the board is left as it was.
	if _, err := s.SaveStudio(Studio{
		ID: board.ID, UserID: LocalUserID, ProjectID: mine.ID, Name: "Field notes",
		Members: []StudioMember{{RunID: ours}, {RunID: theirs}},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("saving another project's run returned %v, want ErrInvalidInput", err)
	}
	if got, err := s.GetStudio(LocalUserID, board.ID); err != nil {
		t.Fatal(err)
	} else if len(got.Members) != 1 || got.Members[0].RunID != ours {
		t.Errorf("the refused save changed the board: %d member(s)", len(got.Members))
	}

	// The menu of the other project does not offer it.
	if list, err := s.ListStudios(LocalUserID, other.ID); err != nil {
		t.Fatal(err)
	} else if len(list) != 0 {
		t.Errorf("another project's menu offers %d board(s)", len(list))
	}
	if list, err := s.ListStudios(LocalUserID, mine.ID); err != nil {
		t.Fatal(err)
	} else if len(list) != 1 || list[0].ID != board.ID {
		t.Errorf("the project's own menu listed %d board(s)", len(list))
	}
}

// A board saved before boards had projects stays reachable: it is offered
// alongside the open project's own, and re-saving it is not refused. Hiding it
// would be indistinguishable from having lost it.
func TestProjectlessStudioStaysReachable(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Tocantins")
	if _, err := s.SaveRun(InferenceRun{
		ID: "run-old", UserID: LocalUserID, CreatedAt: nowISO(),
		ModelKind: "spectral", Status: "ok", PolygonGeoJSON: someGround,
	}); err != nil {
		t.Fatal(err)
	}
	old, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Before projects",
		Members: []StudioMember{{RunID: "run-old"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	list, err := s.ListStudios(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != old.ID {
		t.Fatalf("a projectless board is not offered: %d board(s)", len(list))
	}
	if list[0].ProjectID != "" {
		t.Errorf("board project is %q, want empty", list[0].ProjectID)
	}
}

/*
A database written when this was called a whiteboard opens as studios, with its
rows and its arrangement intact.

THE RENAME IS THE ONE MIGRATION THAT CAN LOSE WORK SILENTLY. Every schema block
in migrate is CREATE TABLE IF NOT EXISTS, so a file still holding `whiteboards`
would be given an empty `studios` beside it and every reader would find the
empty one -- no error, no missing table, just boards that are gone. That is why
the renames run before the first CREATE, and why this builds the old file
rather than asserting on a fresh one.

The members table is the half that is easy to get half-right: it is renamed AND
its whiteboard_id column is, so a rename that moved the table and left the
column would pass a test that only counted rows.
*/
func TestABoardSavedAsAWhiteboardOpensAsAStudio(t *testing.T) {
	dir := t.TempDir()
	s := openStoreOnFile(t, filepath.Join(dir, dbFileName))
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}

	// Put the file back into the shape the previous name left it in. The two
	// added columns are part of that shape: a file written under the old name
	// carries them, and dropping them is the other thing migrate has to do to
	// it. See StudioMember.
	for _, stmt := range []string{
		`ALTER TABLE studios RENAME TO whiteboards`,
		`ALTER TABLE studio_members RENAME COLUMN studio_id TO whiteboard_id`,
		`ALTER TABLE studio_members RENAME TO whiteboard_members`,
		`ALTER TABLE whiteboard_members ADD COLUMN name TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE whiteboard_members ADD COLUMN state_json TEXT NOT NULL DEFAULT '{}'`,
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(
		`INSERT INTO inference_runs
		 (id, user_id, created_at, model_kind, period_start, period_end,
		  polygon_geojson, status, summary_json, n_dates, result_json, label, kind)
		 VALUES ('run-1', ?, ?, 'spectral', '', '', '{}', 'ok', '{}', 1, '{}', 'run-a', 'classification')`,
		LocalUserID, nowISO(),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO whiteboards (id, user_id, name, created_at, updated_at, view_json)
		 VALUES ('board-1', ?, 'Field notes', ?, ?, '{"gap":0.2}')`,
		LocalUserID, nowISO(), nowISO(),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO whiteboard_members (id, whiteboard_id, run_id, position, name, state_json)
		 VALUES ('m-1', 'board-1', 'run-1', 0, 'Left', '{}')`,
	); err != nil {
		t.Fatal(err)
	}

	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetStudio(LocalUserID, "board-1")
	if err != nil {
		t.Fatalf("the studio did not survive the rename: %v", err)
	}
	if got.Name != "Field notes" {
		t.Errorf("studio name is %q, want %q", got.Name, "Field notes")
	}
	if got.ViewJSON != `{"gap":0.2}` {
		t.Errorf("the arrangement was not carried over: %q", got.ViewJSON)
	}
	if len(got.Members) != 1 || got.Members[0].RunID != "run-1" {
		t.Fatalf("the studio came back with %d member(s)", len(got.Members))
	}
	// The legacy row carried name and state_json; those columns are dropped by
	// the same migrate, and what mattered about the member -- which run it is
	// and where in the order -- came through. See StudioMember.
	if got.Members[0].Position != 0 {
		t.Errorf("the member's position is %d, want 0", got.Members[0].Position)
	}
	for _, gone := range []string{"name", "state_json"} {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(1) FROM pragma_table_info('studio_members') WHERE name = ?`,
			gone,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("studio_members still declares %s", gone)
		}
	}

	// The old names are gone rather than left beside the new ones: two tables
	// for one thing is what this rename exists to end.
	for _, gone := range []string{"whiteboards", "whiteboard_members"} {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name = ?`, gone,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s is still a table", gone)
		}
	}
	var col int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info('studio_members') WHERE name = 'whiteboard_id'`,
	).Scan(&col); err != nil {
		t.Fatal(err)
	}
	if col != 0 {
		t.Errorf("studio_members still declares whiteboard_id")
	}
}

/*
A file left holding both names opens, and opens on the work.

NOT HYPOTHETICAL. Every schema block in migrate is CREATE TABLE IF NOT EXISTS,
so a build that ran those before the rename existed left an empty `studios`
beside a populated `whiteboards` -- which is what this author's own database was
in when the rename landed. Refusing there would have meant a store that will not
open at all, with the work intact on disk behind it.

The empty one is what a CREATE made; the rows are what a person did.
*/
func TestBothNamesPresentKeepsTheRows(t *testing.T) {
	dir := t.TempDir()
	s := openStoreOnFile(t, filepath.Join(dir, dbFileName))
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	seedRun(t, s, "run-1", LocalUserID)
	if _, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "Field notes",
		Members: []StudioMember{{RunID: "run-1"}},
	}); err != nil {
		t.Fatal(err)
	}
	// The state an intermediate build left: the old names carrying the work,
	// the new ones created empty beside them.
	for _, stmt := range []string{
		`ALTER TABLE studios RENAME TO whiteboards`,
		`ALTER TABLE studio_members RENAME COLUMN studio_id TO whiteboard_id`,
		`ALTER TABLE studio_members RENAME TO whiteboard_members`,
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(studioSchema); err != nil {
		t.Fatal(err)
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("a file holding both names would not open: %v", err)
	}
	list, err := s.ListStudios(LocalUserID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "Field notes" {
		t.Fatalf("the work was lost to the empty table: %d studio(s)", len(list))
	}
	if list[0].MemberCount != 1 {
		t.Errorf("the studio came back with %d member(s), want 1", list[0].MemberCount)
	}
}

// Two POPULATED tables is a different question, and this cannot answer it: which
// of them is the work is not something to guess at, so it stops and names the
// pair rather than picking one.
func TestBothNamesPopulatedIsRefused(t *testing.T) {
	dir := t.TempDir()
	s := openStoreOnFile(t, filepath.Join(dir, dbFileName))
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	seedRun(t, s, "run-1", LocalUserID)
	if _, err := s.SaveStudio(Studio{UserID: LocalUserID, Name: "In studios"}); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`ALTER TABLE studios RENAME TO whiteboards`,
		`ALTER TABLE studio_members RENAME COLUMN studio_id TO whiteboard_id`,
		`ALTER TABLE studio_members RENAME TO whiteboard_members`,
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(studioSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO studios (id, user_id, name, created_at, updated_at, view_json)
		 VALUES ('other', ?, 'In studios too', ?, ?, '{}')`,
		LocalUserID, nowISO(), nowISO(),
	); err != nil {
		t.Fatal(err)
	}

	err := s.migrate()
	if err == nil {
		t.Fatal("two populated tables were merged silently")
	}
	if !strings.Contains(err.Error(), "both exist") {
		t.Errorf("the error does not name the pair: %v", err)
	}
}
