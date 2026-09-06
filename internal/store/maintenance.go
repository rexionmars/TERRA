package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
Keeping the data directory from growing on its own.

Three things accumulate here without anyone choosing them, and none of the code
that produces them takes them away again: the base64 a solar run used to write
into its own row beside the file it was decoded into, the free pages a delete
leaves in the database file, and the snapshots a discard sets aside. All three
run at open, after migrate, because that is the moment the file is this
process's alone and nothing is reading it yet.

Every one of them is best effort in the same sense saveRun is: none of them is
worth refusing to open the database over. A failure leaves the directory as it
was, which is the state the previous release shipped.
*/

/*
stripStoredOverlayURIs takes the rendering back out of the rows that carry it.

AnalyzeSolarTerrain and AnalyzeSolarSiting handed persistSolarRaster the whole
result, data URI included, so result_json held the overlay as base64 and the
run's asset directory held the same image as a file. Measured on one
installation: 33 rows, 511,818 bytes of base64 against 452 KB of PNG. The write
path no longer does it; these are the rows written before it stopped.

Safe because LoadAnalysis has always preferred the file: it decodes the row,
then overwrites overlay_uri from the PNG on disk. A row that has been stripped
opens the way it did before, and a run whose file is missing opened onto
nothing already -- the base64 was never what it was read from.
*/
func (s *Store) stripStoredOverlayURIs() error {
	res, err := s.db.Exec(`
		UPDATE inference_runs
		   SET result_json = json_remove(result_json, '$.overlay_uri')
		 WHERE kind = 'solar'
		   AND json_valid(result_json)
		   AND json_extract(result_json, '$.overlay_uri') IS NOT NULL`)
	if err != nil {
		// json_remove is part of the JSON extension. A build without it leaves
		// the rows as they are, which costs space and breaks nothing.
		return nil
	}
	_, _ = res.RowsAffected()
	return nil
}

/*
The fraction of the file that has to be free pages before it is worth
rewriting, and where the number comes from.

Firefox measures the same ratio -- freelist_count over page_count -- to decide
when places.sqlite needs vacuuming, and its threshold is 0.1. Taking the number
from a program that has run this maintenance on hundreds of millions of
profiles is better than choosing one here, and the ratio is the right measure
either way: it is the share of the file that is being carried and not used.

One installation measured 1004 free pages of 1554, or 0.65. A database at that
ratio is two thirds air.
*/
const vacuumFreePageRatio = 0.1

/*
The size past which the rewrite is not done at open.

VACUUM rebuilds the whole file, so its cost is the file. At the sizes this
application produces -- the images are on disk and the rows are text -- it is
milliseconds, and doing it before the window appears costs nothing anyone can
see. This bound is for the case that is not those sizes: a file large enough
for the rewrite to be felt is one where a delay at every open would be worse
than the space, and the storage screen reports the space either way.
*/
const vacuumMaxBytes = 256 << 20

/*
compactIfFragmented rewrites the database when enough of it is free pages.

Not auto_vacuum, and the reason is in SQLite's own documentation: the mode
cannot be turned on for a database that already has tables without running a
full VACUUM first, so the cheap-sounding option costs the expensive one before
it does anything. FULL also only truncates free pages at commit -- it does not
repack, and can leave the file more fragmented than it found it. A VACUUM when
the ratio says so does the whole job and does it once.
*/
func (s *Store) compactIfFragmented() error {
	var pages, free int64
	if err := s.db.QueryRow(`PRAGMA page_count`).Scan(&pages); err != nil {
		return nil
	}
	if err := s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free); err != nil {
		return nil
	}
	if pages == 0 || float64(free)/float64(pages) < vacuumFreePageRatio {
		return nil
	}
	var pageSize int64
	if err := s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return nil
	}
	if pages*pageSize > vacuumMaxBytes {
		return nil
	}
	// Outside a transaction, which VACUUM requires. migrate holds none.
	if _, err := s.db.Exec(`VACUUM`); err != nil {
		return fmt.Errorf("compact the database: %w", err)
	}
	return nil
}

// replacedMarker is what a set-aside copy carries in its name. See
// discardPreAreaData, which writes them.
const replacedMarker = ".replaced-"

/*
pruneReplacedSnapshots keeps the most recent copy of each thing set aside and
removes the ones behind it.

A discard copies the database and moves runs/ and projects/ out of the way
before it drops anything, stamped with the hour. Nothing has ever removed them.
On one installation they came to 16.6 MB across four entries, of which the
newest was the only one that could still be wanted: the older ones are states
the file has since been migrated past twice over.

ONE, NOT NONE. The most recent is the rollback the copy exists to be. Keeping a
single generation is the retention every log rotation settles on for the same
reason -- the last one is evidence, the ones before it are weight.

Names it did not write are not touched. A reader who copied the database aside
by hand named it something else, and this must not be the thing that decides
their copy has aged out.
*/
func (s *Store) pruneReplacedSnapshots() error {
	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		return nil
	}
	// Grouped by what was set aside, because the database, runs/ and projects/
	// are stamped separately and each keeps its own most recent.
	generations := map[string][]string{}
	for _, e := range entries {
		name := e.Name()
		i := strings.Index(name, replacedMarker)
		if i <= 0 {
			continue
		}
		base := name[:i]
		generations[base] = append(generations[base], name)
	}
	for _, names := range generations {
		if len(names) < 2 {
			continue
		}
		// The stamp is fixed-width and ordered, so lexical order is time order.
		sort.Strings(names)
		for _, old := range names[:len(names)-1] {
			_ = os.RemoveAll(filepath.Join(s.dataDir, old))
		}
	}
	return nil
}
