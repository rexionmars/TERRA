package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
Keeping the data directory from growing on its own, and from holding what this
build cannot read.

Two things accumulate here without anyone choosing them, and none of the code
that produces them takes them away again: the free pages a delete leaves in the
database file, and the snapshots a discard sets aside. A third is left behind by
a product this build no longer carries: the runs it stored, which no reader here
can open. All three are dealt with at open, after migrate, because that is the
moment the file is this process's alone and nothing is reading it yet.

Every one of them is best effort in the same sense saveRun is: none of them is
worth refusing to open the database over. A failure leaves the directory as it
was, which is the state the previous release shipped.
*/

/*
retiredRunKinds are the run kinds this build has no product for.

Solar and wind runs were written by products that have since been removed, and
every reader that could open what they stored went with them. LoadAnalysis has
no branch for either kind, so a row of one falls through to the classification
path and reopens as an empty classification with nothing raising an error,
while the run list and the storage screen go on offering it as a run that can
be opened. The rows are deleted instead, with everything that refers to them.

A list rather than two literals inside the step, so a kind retired later is one
line here and not a second copy of purgeRetiredRunKinds. A kind stays on it once
its rows are gone: on a database that never held one the step costs a query that
returns nothing, and an archive written before the removal and restored after it
is exactly the file that still holds them.
*/
var retiredRunKinds = []string{"solar", "wind"}

/*
purgeRetiredRunKinds deletes every run of a retired kind, whoever it belongs
to, and the files each one wrote.

Each row goes the way DeleteRun removes one, because what a run leaves behind is
the same whoever deletes it: the studio_members rows naming it, the arrangements
in view_json that name it, and the run_id of a composition made under it, which
is cleared rather than the composition deleted -- the composition is still a
raster of real ground. All of it in one transaction, so a failure part way
leaves every row where it was and the next open repeats the step from the start.

EVERY USER, NOT THE ONE SIGNED IN. The runs are selected without a user, and the
arrangements are rewritten user by user because that is how dropRunsFromViews
is scoped: a studio can only name runs of its own user.

The directories go after the commit, as in DeleteRun. Removed first, a row that
then failed to delete would be a run whose files are gone; removed after, a
directory that cannot be removed is one with no row, which is what the storage
screen reports and PurgeOrphanedRunAssets reclaims.

The project a run was filed under is not touched. DeleteRun bumps it because a
reader has just acted on that project; nobody has here, and reordering the
project list at open would say otherwise.
*/
func (s *Store) purgeRetiredRunKinds() error {
	doomed, err := s.retiredRuns()
	if err != nil || len(doomed) == 0 {
		// A query that cannot be answered leaves the rows where they are, and
		// the next open asks again.
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil
	}
	defer func() { _ = tx.Rollback() }()

	byUser := map[string]map[string]bool{}
	for _, r := range doomed {
		if _, err := tx.Exec(
			`DELETE FROM inference_runs WHERE id = ? AND user_id = ?`, r.id, r.userID,
		); err != nil {
			return nil
		}
		if _, err := tx.Exec(
			`DELETE FROM studio_members WHERE run_id = ?`, r.id,
		); err != nil {
			return nil
		}
		if _, err := tx.Exec(
			`UPDATE project_overlays SET run_id = NULL WHERE run_id = ?`, r.id,
		); err != nil {
			return nil
		}
		if byUser[r.userID] == nil {
			byUser[r.userID] = map[string]bool{}
		}
		byUser[r.userID][r.id] = true
	}
	for userID, drop := range byUser {
		if _, err := dropRunsFromViews(tx, userID, drop); err != nil {
			return nil
		}
	}
	if err := tx.Commit(); err != nil {
		return nil
	}

	for _, r := range doomed {
		_ = os.RemoveAll(s.RunsDir(r.id))
	}
	return nil
}

// retiredRun is one row purgeRetiredRunKinds removes, and the user whose
// arrangements it rewrites.
type retiredRun struct{ id, userID string }

// retiredRuns lists the rows of a retired kind. Split from the writes for the
// reason dropRunsFromViews gives: the cursor is closed before the first write
// goes out on the one connection this package holds.
func (s *Store) retiredRuns() ([]retiredRun, error) {
	marks := strings.TrimSuffix(strings.Repeat("?,", len(retiredRunKinds)), ",")
	args := make([]any, len(retiredRunKinds))
	for i, kind := range retiredRunKinds {
		args[i] = kind
	}
	rows, err := s.db.Query(
		`SELECT id, user_id FROM inference_runs WHERE kind IN (`+marks+`)`, args...,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []retiredRun
	for rows.Next() {
		var r retiredRun
		if err := rows.Scan(&r.id, &r.userID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
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
