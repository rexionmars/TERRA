package store

import (
	"os"
	"path/filepath"
	"testing"
)

// writeRunAssets puts a file of the given size under a run directory.
func writeRunAssets(t *testing.T, s *Store, runID string, size int) {
	t.Helper()
	dir := filepath.Join(s.dataDir, "runs", runID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "overlay.png"),
		make([]byte, size), 0o600); err != nil {
		t.Fatal(err)
	}
}

// insertRun creates the row a run directory belongs to.
func insertRun(t *testing.T, s *Store, userID, runID, label string) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO inference_runs
		   (id, user_id, created_at, model_kind, period_start, period_end,
		    polygon_geojson, status, label)
		 VALUES (?, ?, ?, 'spectral', '2024-01-01', '2024-02-01', '{}', 'ok', ?)`,
		runID, userID, nowISO(), label,
	); err != nil {
		t.Fatal(err)
	}
}

// TestInspectStorageMeasuresWhatIsOnDisk checks the report against files of
// known size, since a storage screen that is merely plausible is worse than
// none: it would be believed.
func TestInspectStorageMeasuresWhatIsOnDisk(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	writeRunAssets(t, s, "run-big", 4096)
	insertRun(t, s, LocalUserID, "run-big", "Big analysis")
	writeRunAssets(t, s, "run-small", 512)
	insertRun(t, s, LocalUserID, "run-small", "Small analysis")

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatal(err)
	}

	var runsBucket *StorageBucket
	for i := range report.Buckets {
		if report.Buckets[i].Label == "Analyses" {
			runsBucket = &report.Buckets[i]
		}
	}
	if runsBucket == nil {
		t.Fatal("no Analyses bucket in the report")
	}
	if runsBucket.Bytes != 4608 {
		t.Errorf("Analyses bucket is %d bytes, want 4608", runsBucket.Bytes)
	}
	if runsBucket.Files != 2 {
		t.Errorf("Analyses bucket counts %d files, want 2", runsBucket.Files)
	}

	// Largest first, so deleting can be aimed.
	if len(report.Runs) != 2 {
		t.Fatalf("report lists %d runs, want 2", len(report.Runs))
	}
	if report.Runs[0].RunID != "run-big" {
		t.Errorf("largest run is %q, want run-big", report.Runs[0].RunID)
	}
	if report.Runs[0].Label != "Big analysis" {
		t.Errorf("the run is not labelled: %q", report.Runs[0].Label)
	}
	if report.TotalBytes < 4608 {
		t.Errorf("total is %d, below the runs alone", report.TotalBytes)
	}
}

/*
TestOrphanedAssetsAreFoundAndOnlyThose is the assertion the purge rests on.

A directory with no row is space nothing in the application can reach, and it
is invisible from the database side -- which is why it accumulates. A directory
with a row is somebody's analysis. Confusing the two in the direction of
deleting is the failure that matters, so the test checks both directions.
*/
func TestOrphanedAssetsAreFoundAndOnlyThose(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	writeRunAssets(t, s, "live-run", 1024)
	insertRun(t, s, LocalUserID, "live-run", "Kept")
	// No row for this one.
	writeRunAssets(t, s, "orphan-run", 2048)

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatal(err)
	}
	if report.OrphanCount != 1 {
		t.Errorf("found %d orphans, want 1", report.OrphanCount)
	}
	if report.OrphanBytes != 2048 {
		t.Errorf("orphan bytes %d, want 2048", report.OrphanBytes)
	}
	// The live run is listed as a run, not counted as an orphan.
	if len(report.Runs) != 1 || report.Runs[0].RunID != "live-run" {
		t.Errorf("the live run was not listed: %+v", report.Runs)
	}

	removed, freed, err := s.PurgeOrphanedRunAssets()
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 || freed != 2048 {
		t.Errorf("purge removed %d dirs freeing %d bytes, want 1 and 2048",
			removed, freed)
	}

	// The orphan is gone.
	if _, err := os.Stat(filepath.Join(s.dataDir, "runs", "orphan-run")); err == nil {
		t.Error("the orphaned directory survived the purge")
	}
	// And the live one is untouched. This is the assertion that matters: a
	// purge that took a real analysis with it would be data loss.
	if _, err := os.Stat(filepath.Join(s.dataDir, "runs", "live-run", "overlay.png")); err != nil {
		t.Errorf("the purge deleted a live analysis's files: %v", err)
	}
}

// TestRunWithNoAssetsIsNotAnOrphan covers the case this machine actually has:
// rows whose products write nothing durable.
//
// They have no directory at all, so nothing should report them as reclaimable
// space -- and nothing should offer to delete a row on the strength of it.
func TestRunWithNoAssetsIsNotAnOrphan(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	insertRun(t, s, LocalUserID, "row-only", "No assets")

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatal(err)
	}
	if report.OrphanCount != 0 {
		t.Errorf("a row with no directory was counted as %d orphans",
			report.OrphanCount)
	}
	removed, _, err := s.PurgeOrphanedRunAssets()
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Errorf("purge removed %d directories when none existed", removed)
	}
}

// TestInspectStorageOnAFreshInstall checks that a data directory holding
// nothing but a database does not error.
func TestInspectStorageOnAFreshInstall(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatalf("a fresh install failed to report storage: %v", err)
	}
	if len(report.Runs) != 0 {
		t.Errorf("a fresh install lists %d runs", len(report.Runs))
	}
	// The database exists, so the total is not zero -- and every bucket has a
	// consequence line, since a number with no stated cost invites deleting it.
	if report.TotalBytes == 0 {
		t.Error("the total ignores the database")
	}
	for _, b := range report.Buckets {
		if b.Consequence == "" {
			t.Errorf("bucket %q does not say what removing it costs", b.Label)
		}
	}
}

/*
TestEveryRunIsListed checks the report holds them all.

It used to return a top slice. A capped list leaves "what else is in there"
unanswerable from inside the application, which is the question this screen
exists to answer -- the modal can page or scroll, but the data has to be there
to page through.
*/
func TestEveryRunIsListed(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	const n = 20
	for i := 0; i < n; i++ {
		id := "run-" + string(rune('a'+i))
		writeRunAssets(t, s, id, 100+i)
		insertRun(t, s, LocalUserID, id, "Analysis")
	}

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Runs) != n {
		t.Errorf("listed %d runs, want all %d", len(report.Runs), n)
	}
	// Largest first, so the modal opens on what matters.
	for i := 1; i < len(report.Runs); i++ {
		if report.Runs[i-1].Bytes < report.Runs[i].Bytes {
			t.Errorf("runs are not ordered by size at %d", i)
			break
		}
	}
	// And the listed bytes account for the whole bucket: nothing is hidden.
	var listed int64
	for _, r := range report.Runs {
		listed += r.Bytes
	}
	for _, b := range report.Buckets {
		if b.Label == "Analyses" && b.Bytes != listed {
			t.Errorf("bucket says %d bytes, listed runs total %d", b.Bytes, listed)
		}
	}
}

/*
TestBreakdownsAgreeWithTheTotal checks the two cuts against the same bytes.

By-kind and by-file-type are the same space counted two ways, so either one
disagreeing with the bucket it came from means one of them is wrong -- and a
breakdown that does not add up is worse than no breakdown, because it is still
believed.
*/
func TestBreakdownsAgreeWithTheTotal(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	// Two kinds, and two file types within one analysis.
	writeRunAssets(t, s, "run-class", 1000)
	insertRun(t, s, LocalUserID, "run-class", "A classification")
	writeRunAssets(t, s, "run-solar", 3000)
	insertRun(t, s, LocalUserID, "run-solar", "A solar study")
	if _, err := s.db.Exec(
		`UPDATE inference_runs SET kind = ? WHERE id = ?`, RunKindSolar, "run-solar",
	); err != nil {
		t.Fatal(err)
	}
	// A GeoTIFF beside a PNG, so the file-type cut has more than one row.
	tif := filepath.Join(s.dataDir, "runs", "run-solar", "raster.tif")
	if err := os.WriteFile(tif, make([]byte, 500), 0o600); err != nil {
		t.Fatal(err)
	}

	report, err := s.InspectStorage()
	if err != nil {
		t.Fatal(err)
	}

	var runsBucket int64
	for _, b := range report.Buckets {
		if b.Label == "Analyses" {
			runsBucket = b.Bytes
		}
	}

	var byKind int64
	for _, g := range report.ByKind {
		byKind += g.Bytes
	}
	if byKind != runsBucket {
		t.Errorf("by-kind totals %d, the Analyses bucket is %d", byKind, runsBucket)
	}

	// The file-type cut spans every directory, so it matches the sum of the
	// file buckets rather than the runs alone.
	var fileBuckets int64
	for _, b := range report.Buckets {
		if b.Label != "Database" {
			fileBuckets += b.Bytes
		}
	}
	var byType int64
	for _, g := range report.ByFileType {
		byType += g.Bytes
	}
	if byType != fileBuckets {
		t.Errorf("by-file-type totals %d, the file buckets total %d",
			byType, fileBuckets)
	}

	// And the kinds are named, not passed through as raw keys.
	for _, g := range report.ByKind {
		if g.Label == "" || g.Label == g.Key {
			t.Errorf("kind %q reaches the screen unlabelled", g.Key)
		}
	}
	if len(report.ByFileType) < 2 {
		t.Errorf("expected GeoTIFF and PNG rows, got %d", len(report.ByFileType))
	}
}
