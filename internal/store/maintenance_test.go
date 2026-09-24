package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
A run of a retired kind leaves with everything that names it, whoever it
belongs to, and nothing else moves.

Seeded the way the releases that still had the products left them: a solar run
and a flood run of the local user and a wind run of another user, each with its
asset directory on disk, a board of each user naming its runs, and a
composition made under the solar run and another under the flood run. A
sensor-simulation run stands for the kind development builds wrote. The flood
directory holds the agreement GeoTIFF beside its rendering, so the purge is
seen to take a directory with more than one file in it. A classification sits
beside them on the same board and in the same project, with files of its own,
so "nothing else moves" has something to hold. The store is then opened again,
because opening is where the purge runs.
*/
func TestOpenPurgesRetiredRunKinds(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	s := openStoreIn(t, dir)

	other, _, err := s.Register("other@example.com", "secret12", "Other")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: "P"})
	if err != nil {
		t.Fatal(err)
	}
	seed := func(id, userID, kind, projectID string) {
		t.Helper()
		if _, err := s.SaveRun(InferenceRun{
			ID: id, UserID: userID, Kind: kind, ModelKind: "test",
			PolygonGeoJSON: "{}", ProjectID: projectID,
			AssetsRelPath: filepath.Join("runs", id),
		}); err != nil {
			t.Fatalf("seed %s: %v", id, err)
		}
		writeRunAssets(t, s, id, 64)
	}
	// The literals and not constants: the constants went with the products,
	// and these rows are what the release before the removal wrote.
	seed("solar-1", LocalUserID, "solar", p.ID)
	seed("wind-1", other.ID, "wind", "")
	seed("flood-1", LocalUserID, "flood", p.ID)
	seed("hsi-1", LocalUserID, "hsi", "")
	seed("class-1", LocalUserID, RunKindClassification, p.ID)
	if err := os.WriteFile(
		filepath.Join(s.RunsDir("flood-1"), "flood_agreement.tif"),
		make([]byte, 64), 0o600,
	); err != nil {
		t.Fatal(err)
	}

	local, err := s.SaveStudio(Studio{
		UserID: LocalUserID,
		Name:   "local board",
		ViewJSON: strings.NewReplacer("run-a", "solar-1", "run-b", "class-1").
			Replace(twoRunView),
		Members: []StudioMember{
			{RunID: "solar-1"}, {RunID: "flood-1"}, {RunID: "class-1"},
		},
	})
	if err != nil {
		t.Fatalf("save local board: %v", err)
	}
	theirs, err := s.SaveStudio(Studio{
		UserID:   other.ID,
		Name:     "their board",
		ViewJSON: `{"runIds":["wind-1"],"places":{"wind-1":{"x":1,"z":2}}}`,
		Members:  []StudioMember{{RunID: "wind-1"}},
	})
	if err != nil {
		t.Fatalf("save their board: %v", err)
	}
	for _, runID := range []string{"solar-1", "flood-1"} {
		if _, err := s.AddProjectOverlay(LocalUserID, ProjectOverlay{
			ProjectID: p.ID, RunID: runID, Title: "Composition",
		}); err != nil {
			t.Fatal(err)
		}
	}
	// An old stamp, so a purge that touched the project would be visible even
	// inside the second nowISO resolves to.
	const stamp = "2020-01-01T00:00:00Z"
	if _, err := s.db.Exec(
		`UPDATE projects SET updated_at = ? WHERE id = ?`, stamp, p.ID,
	); err != nil {
		t.Fatal(err)
	}
	kept, err := s.GetRun(LocalUserID, "class-1")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	s = openStoreIn(t, dir)

	for _, gone := range []struct{ id, userID string }{
		{"solar-1", LocalUserID},
		{"wind-1", other.ID},
		{"flood-1", LocalUserID},
		{"hsi-1", LocalUserID},
	} {
		if _, err := s.GetRun(gone.userID, gone.id); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: GetRun = %v, want ErrNotFound", gone.id, err)
		}
		if _, err := os.Stat(s.RunsDir(gone.id)); !os.IsNotExist(err) {
			t.Errorf("%s: its asset directory survived (%v)", gone.id, err)
		}
	}
	var left int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM inference_runs WHERE kind IN ('solar', 'wind', 'flood', 'hsi')`,
	).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d rows of a retired kind survived", left)
	}

	// The classification is untouched: its row whole, its files where they were.
	got, err := s.GetRun(LocalUserID, "class-1")
	if err != nil {
		t.Fatalf("the classification went with them: %v", err)
	}
	if *got != *kept {
		t.Errorf("the classification row changed:\n%+v\n%+v", kept, got)
	}
	if _, err := os.Stat(filepath.Join(s.RunsDir("class-1"), "overlay.png")); err != nil {
		t.Errorf("the classification's files went with them: %v", err)
	}

	// Both boards, the member rows and the arrangements alike: the defect a
	// member-only cleanup has is that the two disagree.
	board, err := s.GetStudio(LocalUserID, local.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Members) != 1 || board.Members[0].RunID != "class-1" {
		t.Errorf("local board members = %+v, want only class-1", board.Members)
	}
	if strings.Contains(board.ViewJSON, "solar-1") {
		t.Errorf("the local board still names the solar run:\n%s", board.ViewJSON)
	}
	if !strings.Contains(board.ViewJSON, "class-1") || !strings.Contains(board.ViewJSON, "Tocantins") {
		t.Errorf("the surviving run lost its arrangement:\n%s", board.ViewJSON)
	}
	theirBoard, err := s.GetStudio(other.ID, theirs.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(theirBoard.Members) != 0 {
		t.Errorf("their board members = %+v, want none", theirBoard.Members)
	}
	if strings.Contains(theirBoard.ViewJSON, "wind-1") {
		t.Errorf("their board still names the wind run:\n%s", theirBoard.ViewJSON)
	}

	// The compositions stay and lose their runs, which is what DeleteRun does.
	overlays, err := s.ListProjectOverlays(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(overlays) != 2 {
		t.Errorf("overlays = %+v, want both compositions kept", overlays)
	}
	for _, o := range overlays {
		if o.RunID != "" {
			t.Errorf("composition %q still names run %q", o.ID, o.RunID)
		}
	}
	project, err := s.GetProject(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if project.UpdatedAt != stamp {
		t.Errorf("the project was touched: updated_at %q, want %q", project.UpdatedAt, stamp)
	}

	// Idempotent: on a store with nothing retired left it finds nothing and
	// changes nothing.
	if err := s.purgeRetiredRunKinds(); err != nil {
		t.Fatalf("second purge: %v", err)
	}
	if again, err := s.GetRun(LocalUserID, "class-1"); err != nil || *again != *kept {
		t.Errorf("a second purge moved the classification: %+v, %v", again, err)
	}
}

/*
A file that is mostly free pages is rewritten; one that is not is left alone.

Fragmentation is produced rather than asserted on a fixture: rows are written
and deleted until the ratio is over the threshold, which is what a few months
of saving and removing analyses does.
*/
func TestCompactIfFragmentedShrinksTheFile(t *testing.T) {
	s := openTestStore(t)

	big := strings.Repeat("x", 4096)
	for i := 0; i < 400; i++ {
		seedRun(t, s, "run-"+string(rune('a'+i%26))+strings.Repeat("z", i/26+1), LocalUserID)
	}
	if _, err := s.db.Exec(
		`UPDATE inference_runs SET result_json = ?`, `{"pad":"`+big+`"}`,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DELETE FROM inference_runs`); err != nil {
		t.Fatal(err)
	}

	before := pageCount(t, s)
	if ratio := freeRatio(t, s); ratio < vacuumFreePageRatio {
		t.Fatalf("the setup did not fragment the file: ratio %.3f", ratio)
	}
	if err := s.compactIfFragmented(); err != nil {
		t.Fatalf("compact: %v", err)
	}
	after := pageCount(t, s)
	if after >= before {
		t.Errorf("page count went from %d to %d", before, after)
	}
	if ratio := freeRatio(t, s); ratio >= vacuumFreePageRatio {
		t.Errorf("still fragmented after the rewrite: %.3f", ratio)
	}

	// And a second call is a no-op, so opening the application repeatedly does
	// not rewrite the file every time.
	settled := pageCount(t, s)
	if err := s.compactIfFragmented(); err != nil {
		t.Fatal(err)
	}
	if got := pageCount(t, s); got != settled {
		t.Errorf("an unfragmented file was rewritten: %d -> %d", settled, got)
	}
}

func pageCount(t *testing.T, s *Store) int64 {
	t.Helper()
	var n int64
	if err := s.db.QueryRow(`PRAGMA page_count`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func freeRatio(t *testing.T, s *Store) float64 {
	t.Helper()
	var free int64
	if err := s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free); err != nil {
		t.Fatal(err)
	}
	return float64(free) / float64(pageCount(t, s))
}

/*
One generation of each set-aside copy is kept, and names the application did
not write are not touched.

The second half is the one worth a test: a reader who copies the database aside
by hand before an experiment must not find that the application decided their
copy had aged out.
*/
func TestPruneReplacedSnapshotsKeepsTheNewestAndOnlyItsOwn(t *testing.T) {
	s := openTestStore(t)
	dir := s.DataDir()

	made := []string{
		dbFileName + ".replaced-20260101-000000",
		dbFileName + ".replaced-20260601-120000",
		dbFileName + ".replaced-20260830-181250",
		dbFileName + ".before-cleanup",
		dbFileName + ".safety-033038",
	}
	for _, name := range made {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{
		"runs.replaced-20260101-000000",
		"runs.replaced-20260830-181250",
	} {
		if err := os.MkdirAll(filepath.Join(dir, name, "inner"), 0o700); err != nil {
			t.Fatal(err)
		}
	}

	if err := s.pruneReplacedSnapshots(); err != nil {
		t.Fatalf("prune: %v", err)
	}

	for _, kept := range []string{
		dbFileName + ".replaced-20260830-181250",
		"runs.replaced-20260830-181250",
		dbFileName + ".before-cleanup",
		dbFileName + ".safety-033038",
	} {
		if _, err := os.Stat(filepath.Join(dir, kept)); err != nil {
			t.Errorf("%s was removed: %v", kept, err)
		}
	}
	for _, gone := range []string{
		dbFileName + ".replaced-20260101-000000",
		dbFileName + ".replaced-20260601-120000",
		"runs.replaced-20260101-000000",
	} {
		if _, err := os.Stat(filepath.Join(dir, gone)); !os.IsNotExist(err) {
			t.Errorf("%s survived", gone)
		}
	}
}
