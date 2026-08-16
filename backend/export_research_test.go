package backend

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildResearchPackZIP(t *testing.T) {
	peak := 0.82
	sos := 30.0
	result := &PredictResult{
		Extent:         Bounds{LonMin: -45, LatMin: -10, LonMax: -44, LatMax: -9},
		MeanConfidence: 0.7,
		NDates:         2,
		DateRange:      []string{"2024-01-01", "2024-02-01"},
		ClassStats: []ClassStat{
			{ClassID: 39, Name: "Soybean", Color: "#4292c6", Pixels: 100, Pct: 55.5, AreaHa: 12.3},
		},
		VISeries: []VISeriesPoint{
			{Date: "2024-01-15", NDVIMean: 0.6, NDVIStd: 0.1, EVIMean: 0.4, EVIStd: 0.05, SAVIMean: 0.5, SAVIStd: 0.08},
		},
		Phenology: PhenologyMetrics{SOSDOY: &sos, Peak: &peak},
		LULC: &LULCAnalysis{
			Year:   2023,
			Source: "MapBiomas",
			Metrics: LULCMetrics{
				AreaHa: 20, NPixels: 200, NClasses: 3, ShannonH: 0.9, PielouJ: 0.8,
				DominantClass: "Pasture", DominantPct: 40, SojaPct: 10,
			},
			Composition: []LULCClassRow{
				{ClassID: 15, Name: "Pasture", Color: "#c59a6c", Group: "Farming", Pixels: 80, Pct: 40, AreaHa: 8},
			},
			Groups: []LULCGroupRow{
				{Group: "Farming", Color: "#c59a6c", Pct: 40, AreaHa: 8},
			},
			PredVsRef: []LULCCompareRow{
				{ClassID: 39, Name: "Soybean", Color: "#4292c6", PctRef: 5, PctPred: 55.5},
			},
		},
	}

	dir := t.TempDir()
	tifPath := filepath.Join(dir, "classification.tif")
	if err := os.WriteFile(tifPath, []byte("fake-tif"), 0o644); err != nil {
		t.Fatal(err)
	}
	result.RasterTIF = tifPath

	meta := ResearchExportMeta{
		ModelKind:      "temporal_transformer",
		AreaID:         "",
		AoiLabel:       "Test AOI",
		PolygonGeoJSON: `{"type":"Polygon","coordinates":[[[-45,-10],[-44,-10],[-44,-9],[-45,-9],[-45,-10]]]}`,
	}

	zipBytes, err := BuildResearchPackZIP(meta, result, dir)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatal(err)
	}

	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	required := []string{
		"manifest.json",
		"aoi.geojson",
		"class_stats.csv",
		"vi_series.csv",
		"phenology.csv",
		"lulc_metrics.csv",
		"lulc_composition.csv",
		"lulc_groups.csv",
		"lulc_pred_vs_ref.csv",
		"rasters/classification.tif",
	}
	for _, name := range required {
		if _, ok := files[name]; !ok {
			t.Fatalf("missing zip entry %s", name)
		}
	}

	manifestRaw := mustReadZip(t, files["manifest.json"])
	var manifest map[string]any
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatal(err)
	}
	if int(manifest["schema_version"].(float64)) != 1 {
		t.Fatalf("schema_version=%v", manifest["schema_version"])
	}
	if manifest["model_kind"] != "temporal_transformer" {
		t.Fatalf("model_kind=%v", manifest["model_kind"])
	}
	if manifest["aoi_label"] != "Test AOI" {
		t.Fatalf("aoi_label=%v", manifest["aoi_label"])
	}

	classCSV := mustReadZip(t, files["class_stats.csv"])
	r := csv.NewReader(bytes.NewReader(classCSV))
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("class_stats rows=%d", len(rows))
	}
	if rows[0][0] != "class_id" || rows[1][0] != "39" {
		t.Fatalf("class_stats unexpected: %v", rows)
	}

	tifData := mustReadZip(t, files["rasters/classification.tif"])
	if string(tifData) != "fake-tif" {
		t.Fatalf("tif payload=%q", tifData)
	}

	aoi := string(mustReadZip(t, files["aoi.geojson"]))
	if !strings.Contains(aoi, `"type": "Feature"`) {
		t.Fatalf("aoi should be Feature: %s", aoi)
	}
}

func TestResolveRasterPathRelative(t *testing.T) {
	dir := t.TempDir()
	rel := filepath.Join("runs", "abc", "classification.tif")
	abs := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ResolveRasterPath(rel, dir)
	if got != abs {
		t.Fatalf("got %q want %q", got, abs)
	}
	if ResolveRasterPath("data:image/png;base64,xx", dir) != "" {
		t.Fatal("data URI should be skipped")
	}
	if ResolveRasterPath("", dir) != "" {
		t.Fatal("empty should be skipped")
	}
}

func TestDefaultResearchPackFilename(t *testing.T) {
	name := DefaultResearchPackFilename("José de Freitas–PI")
	if !strings.HasPrefix(name, "terra-export-") || !strings.HasSuffix(name, ".zip") {
		t.Fatalf("bad name %q", name)
	}
	if strings.Contains(name, " ") {
		t.Fatalf("spaces in %q", name)
	}
}

func mustReadZip(t *testing.T, f *zip.File) []byte {
	t.Helper()
	rc, err := f.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
