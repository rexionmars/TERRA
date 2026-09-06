package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
The rendering comes out of the row and the rest of the row stays.

The rows this repairs were written by a path that has since stopped writing
them, so the assertion that matters is not only that overlay_uri is gone: it is
that the figures beside it, which are the whole reason the row exists, came
through.
*/
func TestStripStoredOverlayURIsLeavesTheRestOfTheRow(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "solar-1", LocalUserID)
	seedRun(t, s, "class-1", LocalUserID)

	const withOverlay = `{"overlay_uri":"data:image/png;base64,AAAA","unit":"kWh/m2","season":"annual"}`
	if _, err := s.db.Exec(
		`UPDATE inference_runs SET kind = 'solar', result_json = ? WHERE id = 'solar-1'`,
		withOverlay,
	); err != nil {
		t.Fatal(err)
	}
	// A classification stores no data URI and must not be rewritten anyway:
	// the strip is scoped to the kind whose write path had the defect.
	if _, err := s.db.Exec(
		`UPDATE inference_runs SET kind = 'classification', result_json = ? WHERE id = 'class-1'`,
		withOverlay,
	); err != nil {
		t.Fatal(err)
	}

	if err := s.stripStoredOverlayURIs(); err != nil {
		t.Fatalf("strip: %v", err)
	}

	solar, err := s.GetRun(LocalUserID, "solar-1")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(solar.ResultJSON, "overlay_uri") {
		t.Errorf("the data uri survived: %s", solar.ResultJSON)
	}
	for _, keep := range []string{"kWh/m2", "annual"} {
		if !strings.Contains(solar.ResultJSON, keep) {
			t.Errorf("%q was removed with the overlay: %s", keep, solar.ResultJSON)
		}
	}

	other, err := s.GetRun(LocalUserID, "class-1")
	if err != nil {
		t.Fatal(err)
	}
	if other.ResultJSON != withOverlay {
		t.Errorf("a row of another kind was rewritten: %s", other.ResultJSON)
	}
}

// A row whose result is not JSON is left alone rather than taking the pass
// down with it, the way one malformed view_json used to take the whole repair.
func TestStripStoredOverlayURIsSurvivesMalformedResult(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "solar-1", LocalUserID)
	if _, err := s.db.Exec(
		`UPDATE inference_runs SET kind = 'solar', result_json = 'not json' WHERE id = 'solar-1'`,
	); err != nil {
		t.Fatal(err)
	}
	if err := s.stripStoredOverlayURIs(); err != nil {
		t.Fatalf("strip refused to run: %v", err)
	}
	got, err := s.GetRun(LocalUserID, "solar-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ResultJSON != "not json" {
		t.Errorf("result was rewritten: %q", got.ResultJSON)
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
