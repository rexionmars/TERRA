package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// The handler under test, with a next that says it was reached.
func overlayHandler(a *App) http.Handler {
	return a.runOverlayMiddleware(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}),
	)
}

/*
A run whose image is on disk is served, and the bytes are the file's.

The route is the first reader inference_runs.overlay_relpath has ever had, so
this is also what says the column is worth reading: it saves a run through the
same path the application uses and asks the route for it by id alone.
*/
func TestRunOverlayServesTheRecordedImage(t *testing.T) {
	a := newTestApp(t)
	runID := a.persistWaterRun(
		analysis.WaterRequest{Label: "AOI"},
		&analysis.WaterAnalysis{OccurrenceURI: onePixelPNG},
	)
	if runID == "" {
		t.Fatal("nothing was saved")
	}

	rec := httptest.NewRecorder()
	overlayHandler(a).ServeHTTP(
		rec, httptest.NewRequest(http.MethodGet, runOverlayURLPrefix+runID, nil),
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	run, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(a.store.DataDir(), run.OverlayRelPath))
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.Body.Bytes(); len(got) != len(want) {
		t.Errorf("served %d bytes, the file holds %d", len(got), len(want))
	}
	if a.RunOverlayURL(runID) != runOverlayURLPrefix+runID {
		t.Errorf("bound url = %q", a.RunOverlayURL(runID))
	}
}

/*
A product whose whole result is figures has no image, and the answer is 404
rather than a fall-through.

The asset server behind this replies to an unknown path with index.html, so a
request that fell through would hand an <img> a page of HTML -- a broken image
with nothing saying why.
*/
func TestRunOverlayAnswersForARunWithNoImage(t *testing.T) {
	a := newTestApp(t)
	runID := a.persistSolarRun(
		analysis.SolarRequest{Label: "AOI"},
		&analysis.SolarAnalysis{},
	)
	if runID == "" {
		t.Fatal("nothing was saved")
	}

	rec := httptest.NewRecorder()
	overlayHandler(a).ServeHTTP(
		rec, httptest.NewRequest(http.MethodGet, runOverlayURLPrefix+runID, nil),
	)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if url := a.RunOverlayURL(runID); url != "" {
		t.Errorf("bound url = %q, want empty", url)
	}
}

// An id nobody has is the same answer, and so is a run of another user.
func TestRunOverlayAnswersForAnUnknownRun(t *testing.T) {
	a := newTestApp(t)
	for _, id := range []string{"", "no-such-run"} {
		rec := httptest.NewRecorder()
		overlayHandler(a).ServeHTTP(
			rec, httptest.NewRequest(http.MethodGet, runOverlayURLPrefix+id, nil),
		)
		if rec.Code != http.StatusNotFound {
			t.Errorf("id %q: status = %d, want 404", id, rec.Code)
		}
	}
}

/*
A relative path that climbs out of the data directory is refused.

No writer here produces one, and that is a property of today's code rather than
of the data: a store restored from an archive, or edited by hand, is the same
column with someone else's contents in it. The column is joined to the data
directory and the result has to still be inside it.
*/
func TestRunOverlayRefusesAPathOutOfTheStore(t *testing.T) {
	a := newTestApp(t)
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(a.store.DataDir(), outside)
	if err != nil {
		t.Fatal(err)
	}
	// Written through the store's own writer, so the row is one the store
	// would accept rather than one this test reached in and made.
	saved, err := a.store.SaveRun(store.InferenceRun{
		UserID:         store.LocalUserID,
		Kind:           store.RunKindWater,
		OverlayRelPath: rel,
	})
	if err != nil {
		t.Fatal(err)
	}

	if path, err := a.runOverlayPath(saved.ID); err == nil {
		t.Errorf("resolved to %q, want a refusal", path)
	}
}

// Anything that is not this route passes through untouched.
func TestRunOverlayPassesEverythingElseOn(t *testing.T) {
	a := newTestApp(t)
	rec := httptest.NewRecorder()
	overlayHandler(a).ServeHTTP(
		rec, httptest.NewRequest(http.MethodGet, "/index.html", nil),
	)
	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want the next handler's 418", rec.Code)
	}
}
