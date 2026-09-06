package store

import (
	"encoding/json"
	"strings"
	"testing"
)

/*
The arrangement of one run, in every key convention the board writes.

Built as a literal rather than through SaveStudio because the shape under test
is the frontend's, and a test that produced it through this package's own
writer would only prove that writer consistent with itself. The keys mirror
components/studio/boardMemory.ts. The separator between an area id and a scene
id is a NUL there; it is written as a JSON escape here so this source file
carries no control character.
*/
const twoRunView = `{
  "runIds": ["run-a", "run-b"],
  "added": {"run-a": ["solar:terrain"], "run-b": ["prediction"]},
  "order": {"run-a": ["solar:terrain"], "run-b": ["prediction"]},
  "places": {"run-a": {"x": 1, "z": 2}, "run-b": {"x": 3, "z": 4}},
  "extraState": {"run-a\u0000solar:terrain": {"opacity": 0.5, "visible": true},
                 "run-b\u0000prediction": {"opacity": 1, "visible": true}},
  "planePlaces": {"run-a\u0000solar:terrain": {"x": 0.25, "z": 0.5}},
  "removed": ["run-a\u0000confidence", "run-b\u0000confidence"],
  "flat": ["run-a\u0000solar:terrain"],
  "names": {"stack::run-a": "Sol do cerrado", "stack::run-b": "Tocantins"},
  "nodePlaces": {"product": {"x": 295.32118395303326, "y": -162.77005870841484}},
  "gap": 0.1,
  "links": false
}`

func TestPruneViewRunsRemovesEveryKeyConvention(t *testing.T) {
	out, changed := pruneViewRuns(twoRunView, map[string]bool{"run-a": true})
	if !changed {
		t.Fatal("prune reported no change")
	}
	if strings.Contains(out, "run-a") {
		t.Errorf("run-a survives somewhere in the view:\n%s", out)
	}
	// The other run is untouched, which is the half that makes this a prune
	// rather than a reset.
	for _, want := range []string{"run-b", "prediction", "Tocantins"} {
		if !strings.Contains(out, want) {
			t.Errorf("%q was removed with run-a", want)
		}
	}
}

// A field this package has never heard of belongs to the frontend, and a
// coordinate rewritten by a round trip is a change nothing asked for.
func TestPruneViewRunsPreservesForeignFieldsAndPrecision(t *testing.T) {
	out, _ := pruneViewRuns(twoRunView, map[string]bool{"run-a": true})
	if !strings.Contains(out, "295.32118395303326") {
		t.Errorf("coordinate was rewritten:\n%s", out)
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(out), &obj); err != nil {
		t.Fatalf("output is not json: %v", err)
	}
	if _, ok := obj["nodePlaces"]; !ok {
		t.Error("nodePlaces was dropped")
	}
	if _, ok := obj["links"]; !ok {
		t.Error("links was dropped")
	}
}

func TestPruneViewRunsLeavesUnrelatedViewsAlone(t *testing.T) {
	out, changed := pruneViewRuns(twoRunView, map[string]bool{"run-z": true})
	if changed {
		t.Error("a view naming none of the dropped runs was rewritten")
	}
	if out != twoRunView {
		t.Error("view was modified")
	}
}

// Unparseable input is returned as it stands: a best-effort cleanup that
// cannot read a field has no business writing it.
func TestPruneViewRunsDeclinesUnparseableView(t *testing.T) {
	const bad = `{"runIds": [`
	out, changed := pruneViewRuns(bad, map[string]bool{"run-a": true})
	if changed || out != bad {
		t.Errorf("rewrote an unparseable view: %q", out)
	}
}

/*
The invariant this exists for: after a run is deleted, nothing in any studio
names it.

Asserted over the stored blob as well as the member rows, because the defect
was that the two disagreed -- a reader that consults only one of them would
have passed while the other was wrong.
*/
func TestDeleteRunLeavesNoStudioReference(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-a", LocalUserID)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveStudio(Studio{
		UserID:   LocalUserID,
		Name:     "two runs",
		ViewJSON: twoRunView,
		Members: []StudioMember{
			{RunID: "run-a"},
			{RunID: "run-b"},
		},
	})
	if err != nil {
		t.Fatalf("save studio: %v", err)
	}

	if err := s.DeleteRun(LocalUserID, "run-a"); err != nil {
		t.Fatalf("delete run: %v", err)
	}

	got, err := s.GetStudio(LocalUserID, saved.ID)
	if err != nil {
		t.Fatalf("get studio: %v", err)
	}
	if strings.Contains(got.ViewJSON, "run-a") {
		t.Errorf("deleted run still named in view_json:\n%s", got.ViewJSON)
	}
	if len(got.Members) != 1 || got.Members[0].RunID != "run-b" {
		t.Errorf("members = %+v, want only run-b", got.Members)
	}
	// The surviving run keeps its arrangement. A prune that cleared the field
	// would also pass the assertion above.
	if !strings.Contains(got.ViewJSON, "Tocantins") {
		t.Error("the surviving run lost its name")
	}
}

/*
The files written before deletion reached the blob.

The studio is saved naming a run no row answers to, which is the state one
installation was found in, and the repair is the pass migrate runs at every
open.
*/
func TestRepairStudioViewsDropsRunsWithNoRow(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveStudio(Studio{
		UserID:   LocalUserID,
		Name:     "carries a ghost",
		ViewJSON: twoRunView,
		Members:  []StudioMember{{RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save studio: %v", err)
	}

	if err := s.repairStudioViews(); err != nil {
		t.Fatalf("repair: %v", err)
	}

	got, err := s.GetStudio(LocalUserID, saved.ID)
	if err != nil {
		t.Fatalf("get studio: %v", err)
	}
	if strings.Contains(got.ViewJSON, "run-a") {
		t.Errorf("run with no row survives the repair:\n%s", got.ViewJSON)
	}
	if !strings.Contains(got.ViewJSON, "run-b") {
		t.Error("the run that does have a row was removed")
	}

	// Idempotent: a second pass finds nothing and writes nothing.
	before := got.ViewJSON
	if err := s.repairStudioViews(); err != nil {
		t.Fatalf("second repair: %v", err)
	}
	after, err := s.GetStudio(LocalUserID, saved.ID)
	if err != nil {
		t.Fatalf("get studio again: %v", err)
	}
	if after.ViewJSON != before {
		t.Errorf("second repair changed the view:\n%s\n%s", before, after.ViewJSON)
	}
}

/*
One unparseable arrangement must not take the repair -- or the open -- with it.

json_extract raises while the statement is stepping, so before the json_valid
guard a single row like this aborted the whole query, and the error travelled
up through migrate to Open. Written straight to the table because SaveStudio
now refuses to store it, which is the other half of the fix.
*/
func TestRepairStudioViewsSurvivesMalformedView(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-b", LocalUserID)

	good, err := s.SaveStudio(Studio{
		UserID:   LocalUserID,
		Name:     "carries a ghost",
		ViewJSON: twoRunView,
		Members:  []StudioMember{{RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save studio: %v", err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO studios (id, user_id, name, created_at, updated_at, view_json)
		 VALUES ('broken', ?, 'not json', ?, ?, 'not json')`,
		LocalUserID, nowISO(), nowISO(),
	); err != nil {
		t.Fatalf("seed malformed studio: %v", err)
	}

	if err := s.repairStudioViews(); err != nil {
		t.Fatalf("repair refused to run: %v", err)
	}

	got, err := s.GetStudio(LocalUserID, good.ID)
	if err != nil {
		t.Fatalf("get studio: %v", err)
	}
	if strings.Contains(got.ViewJSON, "run-a") {
		t.Error("the repair skipped the studio it could read")
	}
}

// An arrangement that is not JSON is stored as none, the way SaveRun stores an
// invalid summary as `{}`.
func TestSaveStudioRejectsMalformedView(t *testing.T) {
	s := openTestStore(t)
	seedRun(t, s, "run-b", LocalUserID)

	saved, err := s.SaveStudio(Studio{
		UserID:   LocalUserID,
		Name:     "bad view",
		ViewJSON: `{"runIds": [`,
		Members:  []StudioMember{{RunID: "run-b"}},
	})
	if err != nil {
		t.Fatalf("save studio: %v", err)
	}
	if saved.ViewJSON != "{}" {
		t.Errorf("view json = %q, want {}", saved.ViewJSON)
	}
}
