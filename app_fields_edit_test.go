package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// withSidecar gives the app a runner over this checkout's sidecar, or skips
// where no Python has the packages a field edit needs.
func withSidecar(t *testing.T, a *App) {
	t.Helper()
	root, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	py := os.Getenv("TERRA_PYTHON")
	if py == "" {
		py = filepath.Join(root, ".venv", "bin", "python")
	}
	if err := exec.Command(py, "-c", "import shapely, pyproj").Run(); err != nil {
		t.Skip("no python with shapely and pyproj available")
	}
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	r, err := analysis.NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	a.runner = r
	// Progress goes nowhere: outside Wails the shared event ends the process.
	a.ctx = analysis.WithProgress(context.Background(), func(analysis.ProgressEvent) {})
}

// squareAt is a field about 200 m a side whose south-west corner is at
// (lon, lat), near Toledo, PR.
func squareAt(lon, lat float64) string {
	return polygonText([][]float64{
		{lon, lat}, {lon + 0.002, lat}, {lon + 0.002, lat + 0.0018}, {lon, lat + 0.0018}, {lon, lat},
	})
}

func polygonText(ring [][]float64) string {
	parts := make([]string, len(ring))
	for i, p := range ring {
		parts[i] = "[" + strconv.FormatFloat(p[0], 'f', -1, 64) + "," + strconv.FormatFloat(p[1], 'f', -1, 64) + "]"
	}
	return `{"type":"Polygon","coordinates":[[` + strings.Join(parts, ",") + `]]}`
}

func adoptTwo(t *testing.T, a *App, area *store.Area) []store.Area {
	t.Helper()
	made, err := a.store.AdoptFields(store.LocalUserID, area.ID, "delineation", []store.Area{
		{Name: "field 1", PolygonGeoJSON: squareAt(-53.75, -24.73)},
		// 10 m north of the first, across the strip a delineation leaves.
		{Name: "field 2", PolygonGeoJSON: squareAt(-53.75, -24.73+0.0018+0.00009)},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	return made
}

func TestSplittingAFieldReplacesItWithItsParts(t *testing.T) {
	a := newTestApp(t)
	withSidecar(t, a)
	_, area := seedAreaForFields(t, a)
	fields := adoptTwo(t, a, area)

	parts, err := a.SplitField(fields[0].ID, analysis.GeoJSONLine{
		Type:        "LineString",
		Coordinates: [][]float64{{-53.7495, -24.731}, {-53.7495, -24.727}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Largest first: the line runs a quarter of the way across.
	if len(parts) != 2 || parts[0].Name != "field 1a" || parts[1].Name != "field 1b" {
		t.Fatalf("parts %+v", parts)
	}
	for _, p := range parts {
		if p.ParentID != area.ID || p.SourceRunID != "delineation" || p.EditedAt == "" {
			t.Errorf("%s: parent %q, source %q, edited %q", p.Name, p.ParentID, p.SourceRunID, p.EditedAt)
		}
	}
	if _, err := a.store.GetArea(store.LocalUserID, fields[0].ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("the field cut is still there: %v", err)
	}
}

func TestJoiningFieldsMakesOneNamedAfterTheFirst(t *testing.T) {
	a := newTestApp(t)
	withSidecar(t, a)
	_, area := seedAreaForFields(t, a)
	fields := adoptTwo(t, a, area)

	joined, err := a.JoinFields([]string{fields[0].ID, fields[1].ID})
	if err != nil {
		t.Fatal(err)
	}
	if joined.Name != "field 1" || joined.SourceRunID != "delineation" || joined.EditedAt == "" {
		t.Errorf("joined %q, source %q, edited %q", joined.Name, joined.SourceRunID, joined.EditedAt)
	}

	// With a field drawn by hand it counts as drawn by hand.
	hand, err := a.CreateField(area.ID, "corner", squareAt(-53.75, -24.73-0.0018-0.00009))
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.JoinFields([]string{joined.ID, hand.ID})
	if err != nil {
		t.Fatal(err)
	}
	if again.SourceRunID != "" {
		t.Errorf("a join with a hand-drawn field kept the delineation %q", again.SourceRunID)
	}
}

func TestOnlyFieldsOfOneAreaAreCutOrJoined(t *testing.T) {
	a := newTestApp(t)
	p, area := seedAreaForFields(t, a)
	fields := adoptTwo(t, a, area)
	other, err := a.store.CreateArea(store.LocalUserID, store.Area{ProjectID: p.ID, PolygonGeoJSON: squareAt(-53.6, -24.7)})
	if err != nil {
		t.Fatal(err)
	}
	stray, err := a.CreateField(other.ID, "stray", squareAt(-53.6, -24.7))
	if err != nil {
		t.Fatal(err)
	}
	line := analysis.GeoJSONLine{Type: "LineString", Coordinates: [][]float64{{0, 0}, {1, 1}}}
	if _, err := a.SplitField(area.ID, line); err == nil || !strings.Contains(err.Error(), "only a field") {
		t.Errorf("cutting an area: %v", err)
	}
	if _, err := a.JoinFields([]string{fields[0].ID}); err == nil {
		t.Error("joined one field")
	}
	if _, err := a.JoinFields([]string{fields[0].ID, stray.ID}); err == nil || !strings.Contains(err.Error(), "one area") {
		t.Errorf("joining fields of two areas: %v", err)
	}
}

func TestReshapeAreaTakesOnlyAPolygon(t *testing.T) {
	a := newTestApp(t)
	_, area := seedAreaForFields(t, a)
	for _, bad := range []string{
		`not json`,
		`{"type":"LineString","coordinates":[[0,0],[1,1]]}`,
		`{"type":"Polygon","coordinates":[[[0,0],[1,1],[0,0]]]}`,
	} {
		if _, err := a.ReshapeArea(area.ID, bad); err == nil {
			t.Errorf("reshaped to %s", bad)
		}
	}
	got, err := a.ReshapeArea(area.ID, squareAt(-53.24, -25.34))
	if err != nil {
		t.Fatal(err)
	}
	if got.EditedAt == "" {
		t.Error("a reshaped area is not stamped as edited")
	}
}

func TestPartNames(t *testing.T) {
	for i, want := range map[int]string{0: "field 12a", 1: "field 12b", 25: "field 12z", 26: "field 12-27"} {
		if got := partName("field 12", i); got != want {
			t.Errorf("part %d named %q, want %q", i, got, want)
		}
	}
}
