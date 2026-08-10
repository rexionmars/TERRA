package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

/*
openStoreIn opens a store rooted at an explicit directory.

openTestStore derives its location from HOME and XDG_CONFIG_HOME, so two calls
to it inside one test share a directory -- which is the opposite of what a
restore test needs. This gives an independent store, standing in for a second
machine, and reopens one after its files have been replaced underneath it.
*/
func openStoreIn(t *testing.T, dir string) *Store {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, dbFileName))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, dataDir: dir}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

/*
A pre-rename install must open with everything intact.

The narrowest tests cover adoptLegacyDataDir on directories full of marker
files. This one builds a real legacy install -- an account with a password, a
project -- and opens it the way the renamed application does, because the parts
that would break are the ones the marker-file tests cannot see: the database
file keeping its name inside a directory that changed, and a password that has
to keep working across the move.

It is the check that this rename did not cost anybody their work.
*/
func TestEndToEndLegacyInstallSurvives(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))
	cfg, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}

	// Build a legacy install by hand: old directory name, old db name.
	legacy := filepath.Join(cfg, legacyDirName)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	old := openStoreIn(t, legacy)
	u, _, err := old.Register("before@example.com", "old-password", "Before")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.CreateProject(Project{UserID: u.ID, Name: "Legacy project"}); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}

	// Now open as the renamed application does.
	s, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if filepath.Base(s.DataDir()) != dataDirName {
		t.Fatalf("opened at %s", s.DataDir())
	}
	// The account, and crucially the password, still work.
	if _, _, err := s.Login("before@example.com", "old-password"); err != nil {
		t.Errorf("the pre-rename account cannot sign in: %v", err)
	}
	projects, err := s.ListProjects(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Name != "Legacy project" {
		t.Errorf("projects did not survive: %+v", projects)
	}
}
