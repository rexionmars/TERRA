package store

import (
	"os"
	"path/filepath"
	"testing"
)

/*
The data directory was renamed when the application stopped carrying the name
of the research repository it grew out of. These cover the move, because it runs
once on a real user's machine against the only copy of their work and there is
no second chance at it.
*/

// TestAdoptsLegacyDataDirectory is the migration working: a pre-rename install
// opens with its analyses intact.
func TestAdoptsLegacyDataDirectory(t *testing.T) {
	cfg := t.TempDir()
	legacy := filepath.Join(cfg, legacyDirName)
	if err := os.MkdirAll(filepath.Join(legacy, "runs", "run-1"), 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(legacy, "runs", "run-1", "overlay.png")
	if err := os.WriteFile(marker, []byte("an overlay"), 0o600); err != nil {
		t.Fatal(err)
	}

	dataDir := filepath.Join(cfg, dataDirName)
	if err := adoptLegacyDataDir(cfg, dataDir); err != nil {
		t.Fatal(err)
	}

	moved := filepath.Join(dataDir, "runs", "run-1", "overlay.png")
	if _, err := os.Stat(moved); err != nil {
		t.Errorf("the overlay did not move to the new directory: %v", err)
	}
	// Moved, not copied: two directories that both look current would leave the
	// next release guessing which one the user has been adding to.
	if _, err := os.Stat(legacy); err == nil {
		t.Error("the legacy directory is still there, so the data now exists twice")
	}
}

/*
TestDoesNotReplaceExistingData is the assertion that matters most.

If both directories exist the new one wins untouched. That state means a
restore, a fresh install beside an old one, or a migration that already
happened -- and in none of them is replacing current data with older data
right. Getting this backwards would destroy the newer work silently, which is
the one outcome a migration must never have.
*/
func TestDoesNotReplaceExistingData(t *testing.T) {
	cfg := t.TempDir()

	legacy := filepath.Join(cfg, legacyDirName)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "which.txt"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	dataDir := filepath.Join(cfg, dataDirName)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "which.txt"), []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := adoptLegacyDataDir(cfg, dataDir); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(dataDir, "which.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "current" {
		t.Errorf("the current data was replaced with the legacy data: %q", got)
	}
	// And the legacy directory is left alone rather than quietly discarded.
	if _, err := os.Stat(legacy); err != nil {
		t.Error("the legacy directory was removed despite not being adopted")
	}
}

// TestFreshInstallNeedsNoMigration checks that a machine with neither
// directory is not an error.
func TestFreshInstallNeedsNoMigration(t *testing.T) {
	cfg := t.TempDir()
	dataDir := filepath.Join(cfg, dataDirName)

	if err := adoptLegacyDataDir(cfg, dataDir); err != nil {
		t.Fatalf("a fresh install should not fail migration: %v", err)
	}
	if _, err := os.Stat(dataDir); err == nil {
		t.Error("migration created the data directory; Open is what should do that")
	}
}

// TestLegacyPathThatIsAFileIsIgnored checks that a stray file under the old
// name does not become the data directory.
func TestLegacyPathThatIsAFileIsIgnored(t *testing.T) {
	cfg := t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg, legacyDirName), []byte("not a dir"), 0o600); err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(cfg, dataDirName)

	if err := adoptLegacyDataDir(cfg, dataDir); err != nil {
		t.Fatalf("a file under the legacy name should be ignored, not fatal: %v", err)
	}
	if _, err := os.Stat(dataDir); err == nil {
		t.Error("a file was adopted as the data directory")
	}
}

// TestOpenAdoptsLegacyData checks the migration through Open, which is how it
// actually runs -- the ordering against MkdirAll is the part that breaks.
func TestOpenAdoptsLegacyData(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))

	// Asked rather than assumed: os.UserConfigDir is HOME/Library/Application
	// Support on darwin and XDG_CONFIG_HOME on linux, so building the legacy
	// path by hand tests the wrong directory on one of the two platforms.
	cfg, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}

	legacy := filepath.Join(cfg, legacyDirName)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(legacy, "runs", "keep.txt")
	if err := os.MkdirAll(filepath.Dir(marker), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("kept"), 0o600); err != nil {
		t.Fatal(err)
	}

	s, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if filepath.Base(s.DataDir()) != dataDirName {
		t.Errorf("store opened at %s, want a directory named %s",
			s.DataDir(), dataDirName)
	}
	if _, err := os.Stat(filepath.Join(s.DataDir(), "runs", "keep.txt")); err != nil {
		t.Errorf("Open did not carry the legacy data across: %v", err)
	}
}
