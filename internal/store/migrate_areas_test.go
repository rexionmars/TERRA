package store

/*
The discard that turns a flat database into an owned one, and the two halves of
it that the rows alone do not show.

TestLegacyDatabaseWithoutAVersionMigrates already asserts that the domain tables
end empty, that the account survives, and that a copy of the database is left
beside it. What it cannot see is what happens OUTSIDE the database: the run and
project directories, which hold every raster the discarded rows named, and the
area catalogue that lived inside a preferences blob rather than in a table.

Both are the kind of failure that is invisible until it matters. Assets deleted
instead of moved are gone with no way back; a catalogue left in the blob keeps
handing the frontend a list of areas that reference nothing.
*/

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The assets of discarded rows are SET ASIDE, not removed, and the catalogue
// they were listed in goes with them.
func TestDiscardSetsAssetsAsideAndClearsTheCatalogue(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, dbFileName)
	buildLegacyDatabase(t, dbPath)

	s := openStoreOnFile(t, dbPath)
	s.dataDir = dir

	// A raster under each directory the discard is responsible for, and a
	// catalogue in the blob, as an install written before areas would have.
	for _, rel := range []string{
		filepath.Join("runs", "run-legacy", "prediction.png"),
		filepath.Join("projects", "project-legacy", "overlays", "composition.png"),
	} {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("raster"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(
		`INSERT INTO preferences (user_id, extras_json) VALUES (?, ?)`,
		"user-legacy",
		`{"saved_aois":[{"id":"aoi:1","name":"drawn"}],"active_aoi_id":"aoi:1","theme":"dark"}`,
	); err != nil {
		t.Fatal(err)
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	// The directories moved rather than vanished.
	for _, name := range []string{"runs", "projects"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			t.Errorf("%s/ is still in place; the discard should have moved it aside", name)
		}
		if !hasSiblingWithPrefix(t, dir, name+".replaced-") {
			t.Errorf("%s/ was removed rather than set aside; its rasters are unrecoverable", name)
		}
	}

	// The catalogue is gone from the blob, and the preference that is not
	// domain data is not.
	var extras string
	if err := s.db.QueryRow(
		`SELECT extras_json FROM preferences WHERE user_id = ?`, "user-legacy",
	).Scan(&extras); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"saved_aois", "active_aoi_id"} {
		if strings.Contains(extras, gone) {
			t.Errorf("%s survived the discard: %s", gone, extras)
		}
	}
	if !strings.Contains(extras, "dark") {
		t.Errorf("the theme was discarded with the catalogue: %s", extras)
	}
}

// A database with nothing in it costs nothing: no copy, no directory set aside.
// Every fresh install reaches the discard, and a snapshot beside an empty
// database reads as damage where there was none.
func TestDiscardLeavesAnEmptyDatabaseAlone(t *testing.T) {
	dir := t.TempDir()
	s := openStoreOnFile(t, filepath.Join(dir, dbFileName))
	s.dataDir = dir

	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	if hasSiblingWithPrefix(t, dir, dbFileName+".replaced-") {
		t.Error("a database that held nothing was copied before being emptied")
	}
}

func hasSiblingWithPrefix(t *testing.T, dir, prefix string) bool {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			return true
		}
	}
	return false
}
