package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

/*
A delineation saved, reopened, and made the fields of the area it was run over.

On a payload recorded from a real run -- FTW PRUE B7 over a western Paraná box,
2024-10-31 and 2025-03-05 -- and five of its 389 polygons: the largest, two
that the clip to the area split into parts, and two under half a hectare.
*/

func recordedDelineation(t *testing.T) *analysis.FieldsAnalysis {
	t.Helper()
	var res analysis.FieldsAnalysis
	loadRecordedPayload(t, "fields_pr.json", "fields", &res)
	geojson, err := os.ReadFile(filepath.Join("internal", "research", "testdata", "fields_pr.geojson"))
	if err != nil {
		t.Fatal(err)
	}
	res.FieldsGeoJSON = string(geojson)
	res.ClassesURI = onePixelPNG
	res.WindowAURI = onePixelPNG
	res.WindowBURI = onePixelPNG
	tif := filepath.Join(t.TempDir(), "field_classes.tif")
	if err := os.WriteFile(tif, []byte("tif"), 0o600); err != nil {
		t.Fatal(err)
	}
	res.ClassesTIF = tif
	res.NormalizeNilSlices()
	return &res
}

func seedAreaForFields(t *testing.T, a *App) (*store.Project, *store.Area) {
	t.Helper()
	p, err := a.store.CreateProject(store.Project{UserID: store.LocalUserID, Name: "Oeste"})
	if err != nil {
		t.Fatal(err)
	}
	area, err := a.store.CreateArea(store.LocalUserID, store.Area{
		ProjectID:      p.ID,
		PolygonGeoJSON: `{"type":"Polygon","coordinates":[[[-53.24,-25.34],[-53.18,-25.34],[-53.18,-25.28],[-53.24,-25.28],[-53.24,-25.34]]]}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	return p, area
}

func fieldsRequestFor(p *store.Project, area *store.Area) analysis.FieldsRequest {
	return analysis.FieldsRequest{
		WindowA:   analysis.FieldsWindow{Start: "2024-10-10", End: "2024-11-30"},
		WindowB:   analysis.FieldsWindow{Start: "2025-01-10", End: "2025-03-10"},
		Label:     area.Name,
		AreaID:    area.ID,
		ProjectID: p.ID,
	}
}

func TestFieldsRunRoundTrip(t *testing.T) {
	a := newTestApp(t)
	p, area := seedAreaForFields(t, a)
	res := recordedDelineation(t)

	runID := a.persistFieldsRun(fieldsRequestFor(p, area), res)
	if runID == "" {
		t.Fatal("nothing was saved")
	}
	run, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Kind != store.RunKindFields || run.AreaID != area.ID {
		t.Fatalf("saved as kind %q of area %q", run.Kind, run.AreaID)
	}
	if strings.Contains(run.ResultJSON, "data:image") || strings.Contains(run.ResultJSON, "FeatureCollection") {
		t.Fatal("an image or the polygons reached the database row")
	}
	var summary struct {
		N      int    `json:"fields_n"`
		Window string `json:"fields_window_a"`
	}
	if err := json.Unmarshal([]byte(run.SummaryJSON), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.N != 389 || summary.Window != "2024-10-31" {
		t.Fatalf("summary: %+v", summary)
	}

	loaded, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	f := loaded.Fields
	if f == nil {
		t.Fatal("a field delineation reopened without its fields")
	}
	if f.RunID != runID || loaded.RunID != runID {
		t.Errorf("reopened as run %q / %q, want %q", f.RunID, loaded.RunID, runID)
	}
	if f.FieldsGeoJSON != res.FieldsGeoJSON {
		t.Error("the polygons did not come back as they were saved")
	}
	if f.ClassesURI == "" || f.WindowAURI == "" || f.WindowBURI == "" {
		t.Error("an image did not come back")
	}
	if _, err := os.Stat(f.ClassesTIF); err != nil {
		t.Errorf("the class GeoTIFF does not point at a file: %v", err)
	}
	if f.NFields != 389 || f.Checkpoint.Name != "FTW_PRUE_EFNET_B7" {
		t.Errorf("figures did not survive: %d fields, %q", f.NFields, f.Checkpoint.Name)
	}
}

func TestAdoptingADelineationMakesFields(t *testing.T) {
	a := newTestApp(t)
	p, area := seedAreaForFields(t, a)
	runID := a.persistFieldsRun(fieldsRequestFor(p, area), recordedDelineation(t))

	fields, err := a.AdoptFields(runID, 0.5, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, f := range fields {
		names = append(names, f.Name)
		if f.ParentID != area.ID || f.SourceRunID != runID {
			t.Errorf("%s: parent %q, source %q", f.Name, f.ParentID, f.SourceRunID)
		}
		var g analysis.GeoJSONGeometry
		if err := json.Unmarshal([]byte(f.PolygonGeoJSON), &g); err != nil || g.Type != "Polygon" || len(g.Coordinates) == 0 {
			t.Errorf("%s is not a Polygon every product can read: %v %q", f.Name, err, g.Type)
		}
	}
	// The two under half a hectare are left out; the numbering is the
	// delineation's own.
	if strings.Join(names, ",") != "field 1,field 6,field 36" {
		t.Errorf("adopted %v", names)
	}

	if _, err := a.AdoptFields(runID, 0.5, 0, false); !errors.Is(err, store.ErrFieldsExist) {
		t.Errorf("adopting over adopted fields without replace returned %v", err)
	}
	again, err := a.AdoptFields(runID, 0, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 5 {
		t.Errorf("replace with no minimum adopted %d fields, want 5", len(again))
	}
	all, err := a.ListAreas(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 6 {
		t.Errorf("project holds %d areas, want the area and 5 fields", len(all))
	}
}

// A split field is adopted as its largest part, the one inside the area; the
// others are slivers the clip left along the edge.
func TestASplitFieldIsAdoptedAsItsLargestPart(t *testing.T) {
	ring := func(x0, y0, side float64) [][]float64 {
		return [][]float64{{x0, y0}, {x0 + side, y0}, {x0 + side, y0 + side}, {x0, y0 + side}, {x0, y0}}
	}
	coords, _ := json.Marshal([][][][]float64{
		{ring(-53.20, -25.30, 0.001)},
		{ring(-53.21, -25.31, 0.004)},
		{ring(-53.22, -25.32, 0.002)},
	})
	rings, err := largestPolygon("MultiPolygon", coords)
	if err != nil {
		t.Fatal(err)
	}
	if rings[0][0][0] != -53.21 {
		t.Errorf("kept the part starting at %v, want the largest", rings[0][0])
	}
	if _, err := largestPolygon("Point", json.RawMessage(`[0,0]`)); err == nil {
		t.Error("a point was adopted as a field")
	}
}

func TestOnlyADelineationCanBeAdopted(t *testing.T) {
	a := newTestApp(t)
	runID := a.persistWaterRun(
		analysis.WaterRequest{Label: "AOI"},
		&analysis.WaterAnalysis{OccurrenceURI: onePixelPNG},
	)
	if _, err := a.AdoptFields(runID, 0, 0, false); err == nil {
		t.Error("a water run was adopted as fields")
	}
}

func TestCreateFieldPutsAHandDrawnFieldInsideAnArea(t *testing.T) {
	a := newTestApp(t)
	_, area := seedAreaForFields(t, a)
	f, err := a.CreateField(area.ID, "", area.PolygonGeoJSON)
	if err != nil {
		t.Fatal(err)
	}
	if f.ParentID != area.ID || f.SourceRunID != "" || f.Name != "field" {
		t.Errorf("hand-drawn field: parent %q, source %q, name %q", f.ParentID, f.SourceRunID, f.Name)
	}
	if _, err := a.CreateField(f.ID, "", area.PolygonGeoJSON); err == nil {
		t.Error("a field was drawn inside a field")
	}
}

// The cropland filter drops the polygons MapBiomas mostly calls something else.
// In the recorded delineation the largest polygon, 234 ha, is 2.6% cropland:
// the pasture confusion the FTW documentation warns of.
func TestAdoptionCanLeaveOutWhatMapBiomasDoesNotCallCropland(t *testing.T) {
	a := newTestApp(t)
	p, area := seedAreaForFields(t, a)
	runID := a.persistFieldsRun(fieldsRequestFor(p, area), recordedDelineation(t))

	var fc struct {
		Features []fieldFeature `json:"features"`
	}
	raw, err := os.ReadFile(filepath.Join("internal", "research", "testdata", "fields_pr.geojson"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		t.Fatal(err)
	}
	want := 0
	for _, f := range fc.Features {
		if f.Properties.CroplandShare == nil {
			t.Fatal("the recorded delineation carries no cropland share")
		}
		if *f.Properties.CroplandShare >= 0.5 {
			want++
		}
	}
	fields, err := a.AdoptFields(runID, 0, 0.5, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != want {
		t.Errorf("adopted %d fields with cropland share >= 0.5, want %d", len(fields), want)
	}
	for _, f := range fields {
		if f.Name == "field 1" {
			t.Error("the 234 ha polygon MapBiomas calls 2.6% cropland was adopted")
		}
	}
}
