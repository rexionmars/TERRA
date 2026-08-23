package analysis

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// age backdates an entry so the sweep sees it as old, rather than the test
// waiting for a retention to elapse.
func age(t *testing.T, path string, d time.Duration) {
	t.Helper()
	when := time.Now().Add(-d)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatalf("backdating %s: %v", path, err)
	}
}

func TestSweepTempArtifactsRemovesOnlyAgedEntries(t *testing.T) {
	tempDir := t.TempDir()
	retention := time.Hour

	cache := filepath.Join(tempDir, exportCacheDirName)
	if err := os.MkdirAll(cache, 0o700); err != nil {
		t.Fatal(err)
	}
	oldExport := filepath.Join(cache, "1-classification.tif")
	freshExport := filepath.Join(cache, "2-composite.tif")
	for _, f := range []string{oldExport, freshExport} {
		if err := os.WriteFile(f, []byte("raster"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	age(t, oldExport, 3*time.Hour)

	// One directory per kept prefix, plus a work directory that is removed on
	// return and so must never be a candidate, plus something this program did
	// not create at all.
	oldRun := filepath.Join(tempDir, "terra-run-aged")
	oldSiting := filepath.Join(tempDir, "terra-solar-siting-aged")
	oldTerrain := filepath.Join(tempDir, "terra-solar-terrain-aged")
	freshRun := filepath.Join(tempDir, "terra-run-recent")
	oldWater := filepath.Join(tempDir, "terra-water-aged")
	foreign := filepath.Join(tempDir, "someone-elses-aged")
	for _, d := range []string{oldRun, oldSiting, oldTerrain, freshRun, oldWater, foreign} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(d, "raster.tif"), []byte("raster"), 0o600); err != nil {
			t.Fatal(err)
		}
		// After the file, since writing one moves the directory's mtime back
		// to now and the sweep reads that mtime.
		if d != freshRun {
			age(t, d, 3*time.Hour)
		}
	}

	if got := sweepTempArtifacts(tempDir, retention); got != 4 {
		t.Fatalf("removed %d entries, want 4", got)
	}

	for _, gone := range []string{oldExport, oldRun, oldSiting, oldTerrain} {
		if _, err := os.Stat(gone); !os.IsNotExist(err) {
			t.Errorf("%s survived the sweep", filepath.Base(gone))
		}
	}
	for _, kept := range []string{freshExport, freshRun, oldWater, foreign, cache} {
		if _, err := os.Stat(kept); err != nil {
			t.Errorf("%s was removed: %v", filepath.Base(kept), err)
		}
	}
}

// The sweep runs at boot, before the interface has been given any path, and a
// missing temp directory or an empty one is the normal case on a fresh
// machine. Neither may be reported as work done or crash the constructor.
func TestSweepTempArtifactsToleratesMissingDirectories(t *testing.T) {
	if got := sweepTempArtifacts(filepath.Join(t.TempDir(), "absent"), time.Hour); got != 0 {
		t.Fatalf("removed %d entries from a directory that does not exist", got)
	}
	if got := sweepTempArtifacts(t.TempDir(), time.Hour); got != 0 {
		t.Fatalf("removed %d entries from an empty directory", got)
	}
}

// The retention has to outlive a session that runs an analysis and exports
// from it later; a value that fits inside one working day would delete the
// raster behind a result the window is still showing.
func TestTempRetentionIsGenerous(t *testing.T) {
	if tempRetention < 7*24*time.Hour {
		t.Fatalf("tempRetention is %v, too short to protect a pending export", tempRetention)
	}
}
