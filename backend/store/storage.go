package store

import (
	"os"
	"path/filepath"
	"sort"
)

/*
What the local data is made of, and what can be removed.

The application writes to one directory and never reports on it. A user whose
disk is filling has no way to learn that this is where it went, which of their
analyses is responsible, or whether anything in there is safe to delete -- the
only visible option is deleting the whole thing.

MEASURED, NOT ESTIMATED. Every figure here comes from walking the directory.
Sizes could be inferred from the database, but the database records what was
saved, not what is on disk: a failed delete, an interrupted write or a restore
from an older archive all put those two out of step, and the whole point of
this screen is to be believed when it says where the space went.
*/

// StorageBucket is one kind of thing taking up space.
type StorageBucket struct {
	// What this holds, in the user's terms.
	Label string `json:"label"`
	Bytes int64  `json:"bytes"`
	Files int    `json:"files"`
	// What deleting it would cost, stated where the number is shown rather than
	// left for the user to guess.
	Consequence string `json:"consequence"`
}

// StorageRunItem is one analysis, with what it occupies.
type StorageRunItem struct {
	RunID string `json:"run_id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
	// Empty for a run whose row was written before labels existed.
	CreatedAt string `json:"created_at"`
	Bytes     int64  `json:"bytes"`
	// True when the run has a row but no files on disk. Not an error: several
	// products write nothing durable, and a run may predate asset saving.
	Empty bool `json:"empty"`
}

// StorageReport is the whole picture.
type StorageReport struct {
	DataDir    string          `json:"data_dir"`
	TotalBytes int64           `json:"total_bytes"`
	Buckets    []StorageBucket `json:"buckets"`
	// The heaviest analyses, so deleting is aimed rather than indiscriminate.
	LargestRuns []StorageRunItem `json:"largest_runs"`
	// Directories under runs/ with no row in the database. These are the only
	// files here that nothing can reach, so they are the only ones the
	// application offers to delete on its own.
	OrphanBytes int64 `json:"orphan_bytes"`
	OrphanCount int   `json:"orphan_count"`
}

// PurgeResult is what a purge removed.
//
// A named type because it crosses into TypeScript: the binding generator emits
// `any` for an anonymous struct, and a field read on the other side would stop
// being checked.
type PurgeResult struct {
	Removed    int   `json:"removed"`
	FreedBytes int64 `json:"freed_bytes"`
}

// maxListedRuns bounds the list the screen shows.
//
// The point is to find what is worth deleting, and that is at the top; a
// hundred rows of a few kilobytes each is a list nobody reads. The total above
// it always covers everything, so nothing is hidden by this -- only unlisted.
const maxListedRuns = 12

// InspectStorage measures the data directory.
func (s *Store) InspectStorage() (*StorageReport, error) {
	report := &StorageReport{DataDir: s.dataDir}

	buckets := []struct {
		dir         string
		label       string
		consequence string
	}{
		{"runs", "Analyses", "the overlays and rasters saved with each analysis"},
		{"projects", "Projects", "compositions and exports saved under a project"},
		{"avatars", "Profile photos", "the picture on your account"},
	}
	for _, b := range buckets {
		bytes, files := dirSize(filepath.Join(s.dataDir, b.dir))
		report.Buckets = append(report.Buckets, StorageBucket{
			Label:       b.label,
			Bytes:       bytes,
			Files:       files,
			Consequence: b.consequence,
		})
		report.TotalBytes += bytes
	}

	// The database itself, which is small next to the images but is the thing
	// everything else refers to -- listed so the total adds up, and marked as
	// what it is so nobody reads it as something to clear.
	if info, err := os.Stat(filepath.Join(s.dataDir, dbFileName)); err == nil {
		report.Buckets = append(report.Buckets, StorageBucket{
			Label:       "Database",
			Bytes:       info.Size(),
			Files:       1,
			Consequence: "every analysis, project and preference; not removable here",
		})
		report.TotalBytes += info.Size()
	}

	runs, orphanBytes, orphanCount, err := s.measureRuns()
	if err != nil {
		return nil, err
	}
	report.LargestRuns = runs
	report.OrphanBytes = orphanBytes
	report.OrphanCount = orphanCount
	return report, nil
}

/*
measureRuns sizes every run directory and matches it against the database.

Walks the directory and looks each one up, rather than listing rows and sizing
what they point at. A row whose files are gone costs nothing and is worth
knowing about; a directory with no row is space nothing can reach, and that is
invisible from the database side -- which is exactly why it accumulates.
*/
func (s *Store) measureRuns() ([]StorageRunItem, int64, int, error) {
	runsDir := filepath.Join(s.dataDir, "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return nil, 0, 0, nil // No analyses saved yet.
	}

	var items []StorageRunItem
	var orphanBytes int64
	var orphanCount int

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		bytes, _ := dirSize(filepath.Join(runsDir, e.Name()))

		var label, kind, createdAt string
		err := s.db.QueryRow(
			`SELECT COALESCE(label,''), COALESCE(kind,'classification'), created_at
			 FROM inference_runs WHERE id = ?`, e.Name(),
		).Scan(&label, &kind, &createdAt)
		if err != nil {
			// No row: nothing in the application can open these files.
			orphanBytes += bytes
			orphanCount++
			continue
		}
		items = append(items, StorageRunItem{
			RunID:     e.Name(),
			Label:     label,
			Kind:      kind,
			CreatedAt: createdAt,
			Bytes:     bytes,
			Empty:     bytes == 0,
		})
	}

	sort.Slice(items, func(i, j int) bool { return items[i].Bytes > items[j].Bytes })
	if len(items) > maxListedRuns {
		items = items[:maxListedRuns]
	}
	return items, orphanBytes, orphanCount, nil
}

/*
PurgeOrphanedRunAssets removes run directories with no row in the database.

The only deletion the application performs on its own, because these are the
only files it can be certain nothing will miss: no row refers to them, so
nothing in the interface can open them and no export will include them.

Everything else visible on the storage screen is deleted by deleting the
analysis it belongs to, which the user does deliberately and which already
removes the files. Offering a button that clears "old" or "large" analyses
would be the application deciding which of someone's work matters.
*/
func (s *Store) PurgeOrphanedRunAssets() (int, int64, error) {
	runsDir := filepath.Join(s.dataDir, "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return 0, 0, nil
	}

	var removed int
	var freed int64
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(*) FROM inference_runs WHERE id = ?`, e.Name(),
		).Scan(&n); err != nil {
			// A query that fails is not evidence the row is absent. Skipping is
			// the safe reading: the cost is space that stays used, and the
			// alternative is deleting a live analysis's files.
			continue
		}
		if n > 0 {
			continue
		}
		path := filepath.Join(runsDir, e.Name())
		bytes, _ := dirSize(path)
		if err := os.RemoveAll(path); err != nil {
			continue
		}
		removed++
		freed += bytes
	}
	return removed, freed, nil
}

// dirSize totals the regular files under a directory.
//
// Unreadable entries are skipped rather than failing the walk: a report that
// refuses to say anything because one file could not be stat'd is worse than
// one that is short by that file.
func dirSize(root string) (int64, int) {
	var total int64
	var count int
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		if info.IsDir() || !info.Mode().IsRegular() {
			return nil
		}
		total += info.Size()
		count++
		return nil
	})
	return total, count
}
