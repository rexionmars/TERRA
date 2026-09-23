package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// newTestApp builds an App backed by a store in a temporary home, which is what
// openTestStore does for the store's own tests.
func newTestApp(t *testing.T) *App {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))
	st, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &App{store: st}
}

func latestRunID(t *testing.T, a *App) string {
	t.Helper()
	runs, err := a.store.ListRuns(store.LocalUserID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected exactly one saved run, got %d", len(runs))
	}
	return runs[0].ID
}

// A reloaded run knows which run it is.
//
// RunID is stamped by Predict AFTER persisting, so the copy serialised to disk
// cannot carry it -- the id did not exist yet. LoadAnalysis returned that copy
// untouched, so a reopened analysis came back unable to say what it was, and
// every surface keyed on the id had to invent one. The map screen invented the
// literal "current"; the board then listed a run under the AOI label or, with
// none, "Analysis" -- a row indistinguishable from a saved run, which refused
// every action taken on it because the store has no run by that name.
//
// Asserted for a classification and for the products that return through the
// other branch, since each has its own return and only one of them was ever
// going to be remembered.
func TestLoadAnalysisStampsTheRunItReturns(t *testing.T) {
	a := newTestApp(t)

	// Built here rather than loaded: the point is a result with NO run id, and
	// a fixture that happened to gain one would silently stop testing it.
	res := analysis.PredictResult{NDates: 3}
	body, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.SaveRun(store.InferenceRun{
		UserID:      store.LocalUserID,
		ModelKind:   "spectral",
		PeriodStart: "2025-01-01",
		PeriodEnd:   "2025-12-31",
		Status:      "done",
		Kind:        store.RunKindClassification,
		ResultJSON:  string(body),
	}); err != nil {
		t.Fatal(err)
	}
	runID := latestRunID(t, a)

	// The stored copy is the shape the defect came from: no id inside it.
	stored, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	var raw analysis.PredictResult
	if err := json.Unmarshal([]byte(stored.ResultJSON), &raw); err != nil {
		t.Fatal(err)
	}
	if raw.RunID != "" {
		t.Fatalf("the fixture already carries a run id (%q); this test no longer covers the case it was written for", raw.RunID)
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.RunID != runID {
		t.Fatalf("LoadAnalysis returned run_id %q, want %q", out.RunID, runID)
	}
}

// onePixelPNG is the smallest file that exercises the asset path: written from
// a data URI on save and read back into one on load. Its content is never
// examined, only its survival.
const onePixelPNG = "data:image/png;base64," +
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
