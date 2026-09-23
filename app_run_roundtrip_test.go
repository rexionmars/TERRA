package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

/*
loadRecordedPayload reads a recorded sidecar payload from
internal/research/testdata and unmarshals the block under the given key.

It fails rather than skips when the file is missing or does not bind. A skip on
a fixture that is present is a test that reports success without running, and a
skip on one that is absent is a round trip nobody checked; both are failures
here.
*/
func loadRecordedPayload(t *testing.T, name, key string, dst any) {
	t.Helper()
	path := filepath.Join("internal", "research", "testdata", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	block, ok := wrapped[key]
	if !ok {
		t.Fatalf("%s carries no %q key", path, key)
	}
	if err := json.Unmarshal(block, dst); err != nil {
		t.Fatalf("unmarshal %s from %s: %v", key, path, err)
	}
}

// TestMineralRunRoundTrip checks that a mineral map is saved under its own
// kind, restored through the mineral field, and keeps both class maps and its
// GeoTIFF, on a payload recorded from a real run: EMIT L2A V001 over the
// Quadrilatero Ferrifero, 2024-08-30 and 2024-09-03.
func TestMineralRunRoundTrip(t *testing.T) {
	a := newTestApp(t)

	var res analysis.MineralAnalysis
	loadRecordedPayload(t, "mineral_qf.json", "mineral", &res)
	res.NormalizeNilSlices()
	if len(res.Groups) != 2 || len(res.Scenes) == 0 || res.ObservedCells == 0 {
		t.Fatalf("the recorded payload did not bind: %d groups, %d scenes, %d observed cells",
			len(res.Groups), len(res.Scenes), res.ObservedCells)
	}
	if len(res.Groups[0].Classes) == 0 || len(res.Groups[1].Entries) == 0 {
		t.Fatal("the class and reference tables did not bind")
	}

	// The recorded paths point into a work directory that never existed here.
	tifSrc := filepath.Join(t.TempDir(), "mineral_map.tif")
	if err := os.WriteFile(tifSrc, []byte("not a real geotiff, but a real file"), 0o600); err != nil {
		t.Fatal(err)
	}
	res.GeoTIFF = tifSrc
	for i := range res.Groups {
		res.Groups[i].ClassPNG = ""
		res.Groups[i].ClassURI = onePixelPNG
	}

	a.persistMineralRun(analysis.MineralRequest{Label: "Quadrilatero", Start: "2024-08-01", End: "2024-09-30"}, &res)

	runID := latestRunID(t, a)
	runs, _ := a.store.ListRuns(store.LocalUserID, 10)
	if runs[0].Kind != store.RunKindMineral {
		t.Fatalf("kind = %q, want %q", runs[0].Kind, store.RunKindMineral)
	}
	if runs[0].NDates != len(res.Scenes) {
		t.Fatalf("n_dates = %d, want the %d passes used", runs[0].NDates, len(res.Scenes))
	}
	var summary struct {
		Observed float64 `json:"mineral_observed_area_ha"`
		AOI      float64 `json:"mineral_aoi_area_ha"`
		Top2     string  `json:"mineral_group2_top_class"`
	}
	if err := json.Unmarshal([]byte(runs[0].SummaryJSON), &summary); err != nil {
		t.Fatal(err)
	}
	// Identified areas without the ground they were taken over read as the
	// whole area; the row carries both.
	if summary.Observed != res.ObservedAreaHa || summary.AOI != res.AOIAreaHa || summary.AOI == 0 {
		t.Fatalf("the run row lists no observed area beside its identified areas: %+v", summary)
	}
	if summary.Top2 != res.Groups[1].Classes[0].Class {
		t.Fatalf("top class = %q, want %q", summary.Top2, res.Groups[1].Classes[0].Class)
	}

	stored, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.ResultJSON, "data:image") {
		t.Fatal("a class map's base64 reached the database")
	}

	loaded, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Mineral == nil {
		t.Fatal("the mineral run reopened with no mineral result")
	}
	m := loaded.Mineral
	if m.RunID != runID {
		t.Fatalf("run id = %q, want %q", m.RunID, runID)
	}
	for _, g := range m.Groups {
		if !strings.HasPrefix(g.ClassURI, "data:image/png;base64,") {
			t.Fatalf("group %d reopened without its class map", g.Group)
		}
		if !strings.HasPrefix(g.ClassPNG, a.store.RunsDir(runID)) {
			t.Fatalf("group %d class map path %q is not in the run's folder", g.Group, g.ClassPNG)
		}
	}
	if m.GeoTIFF == "" || !strings.HasPrefix(m.GeoTIFF, a.store.RunsDir(runID)) {
		t.Fatalf("GeoTIFF path %q is not in the run's folder", m.GeoTIFF)
	}
	if m.ObservedCells != res.ObservedCells || len(m.Groups[1].Entries) != len(res.Groups[1].Entries) {
		t.Fatal("the figures did not survive the round trip")
	}
}
