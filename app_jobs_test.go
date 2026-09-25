package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/jobs"
)

// An App with a queue that announces nothing: EventsEmit outside a Wails
// context ends the process.
func appWithJobs(t *testing.T) *App {
	t.Helper()
	a := NewApp()
	a.jobs = jobs.New(context.Background(), nil, nil)
	t.Cleanup(a.jobs.Close)
	return a
}

func jobSquare() *analysis.GeoJSONGeometry {
	return &analysis.GeoJSONGeometry{
		Type:        "Polygon",
		Coordinates: [][][]float64{{{0, 0}, {0, 1}, {1, 1}, {0, 0}}},
	}
}

func classifySpec(areaID string) JobSpec {
	return JobSpec{
		Kind:     JobClassify,
		AreaName: "field " + areaID,
		Classify: &analysis.PredictRequest{PolygonGeoJSON: jobSquare(), Start: "2024-10-01", End: "2025-03-31", AreaID: areaID},
	}
}

// A list with one bad spec queues nothing, and the error says which one.
func TestQueueJobsIsAllOrNone(t *testing.T) {
	a := appWithJobs(t)
	bad := []JobSpec{
		{Kind: "fields", AreaName: "x"},
		{Kind: JobClassify, AreaName: "x"},
		{Kind: JobWater, AreaName: "x", Water: &analysis.WaterRequest{AreaID: "x"}},
		{Kind: JobMineral, AreaName: "x", Mineral: &analysis.MineralRequest{PolygonGeoJSON: jobSquare()}},
	}
	for _, spec := range bad {
		_, err := a.QueueJobs([]JobSpec{classifySpec("f1"), spec})
		if err == nil {
			t.Fatalf("spec %+v was accepted", spec)
		}
		if !strings.Contains(err.Error(), "job 2 of 2") {
			t.Fatalf("the error does not say which job: %v", err)
		}
		if n := len(a.ListJobs()); n != 0 {
			t.Fatalf("%d jobs were queued from a refused list", n)
		}
	}
	if _, err := a.QueueJobs(nil); err == nil {
		t.Fatal("an empty list was accepted")
	}
}

// A queued job runs through the product's own method: with no runner it fails
// with the method's own error, named on the job, and does not stop the next.
func TestQueuedJobsRunThroughTheProductMethod(t *testing.T) {
	a := appWithJobs(t)
	queued, err := a.QueueJobs([]JobSpec{classifySpec("f1"), {
		Kind:     JobWater,
		AreaName: "field f2",
		Water:    &analysis.WaterRequest{PolygonGeoJSON: jobSquare(), AreaID: "f2"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(queued) != 2 || queued[0].AreaID != "f1" || queued[1].Kind != JobWater || queued[1].AreaName != "field f2" {
		t.Fatalf("queued = %+v", queued)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.jobs.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	for _, j := range a.ListJobs() {
		if j.State != jobs.Failed || j.Error != "runner not initialized" {
			t.Fatalf("job = %+v", j)
		}
	}
}

// Before startup the bindings answer rather than panic.
func TestJobBindingsBeforeStartup(t *testing.T) {
	a := NewApp()
	if got := a.ListJobs(); got == nil || len(got) != 0 {
		t.Fatalf("ListJobs = %v", got)
	}
	if _, err := a.QueueJobs([]JobSpec{classifySpec("f1")}); err == nil {
		t.Fatal("jobs were queued with no queue")
	}
	a.ClearJobs()
	a.CancelAllJobs()
	a.shutdown(context.Background())
}

// Quitting asks when it would cancel something and names how much.
func TestCloseQuestion(t *testing.T) {
	if _, m := closeQuestion(false, 0); m != "" {
		t.Fatalf("a quit that loses nothing asks %q", m)
	}
	if title, m := closeQuestion(false, 3); title != "Analyses in progress" || !strings.Contains(m, "3 queued analyses") {
		t.Fatalf("got %q, %q", title, m)
	}
	if _, m := closeQuestion(false, 1); !strings.Contains(m, "One queued analysis") {
		t.Fatalf("got %q", m)
	}
	if title, m := closeQuestion(true, 2); title != "Unsaved studio" || !strings.Contains(m, "no saved studio") || !strings.Contains(m, "2 queued") {
		t.Fatalf("got %q, %q", title, m)
	}
}
