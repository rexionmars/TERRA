package research

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"geosense-infer/internal/analysis"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildResearchPackZIP(t *testing.T) {
	peak := 0.82
	sos := 30.0
	result := &analysis.PredictResult{
		Extent:         analysis.Bounds{LonMin: -45, LatMin: -10, LonMax: -44, LatMax: -9},
		MeanConfidence: 0.7,
		NDates:         2,
		DateRange:      []string{"2024-01-01", "2024-02-01"},
		ClassStats: []analysis.ClassStat{
			{ClassID: 39, Name: "Soybean", Color: "#4292c6", Pixels: 100, Pct: 55.5, AreaHa: 12.3},
		},
		VISeries: []analysis.VISeriesPoint{
			{Date: "2024-01-15", NDVIMean: 0.6, NDVIStd: 0.1, EVIMean: 0.4, EVIStd: 0.05, SAVIMean: 0.5, SAVIStd: 0.08},
		},
		Phenology: analysis.PhenologyMetrics{SOSDOY: &sos, Peak: &peak},
		LULC: &analysis.LULCAnalysis{
			Year:   2023,
			Source: "MapBiomas",
			Metrics: analysis.LULCMetrics{
				AreaHa: 20, NPixels: 200, NClasses: 3, ShannonH: 0.9, PielouJ: 0.8,
				DominantClass: "Pasture", DominantPct: 40, SojaPct: 10,
			},
			Composition: []analysis.LULCClassRow{
				{ClassID: 15, Name: "Pasture", Color: "#c59a6c", Group: "Farming", Pixels: 80, Pct: 40, AreaHa: 8},
			},
			Groups: []analysis.LULCGroupRow{
				{Group: "Farming", Color: "#c59a6c", Pct: 40, AreaHa: 8},
			},
			PredVsRef: []analysis.LULCCompareRow{
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

	meta := analysis.ResearchExportMeta{
		ModelKind:      "temporal_transformer",
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
	if int(manifest["schema_version"].(float64)) != researchExportSchemaVersion {
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

// A package says where its numbers came from: the scenes and the catalogue,
// the model down to its digest, the parameters and when the imagery was read,
// and carries the accuracy assessment and the whole fingerprint.
func TestAPackageCarriesItsProvenanceAndItsAccuracy(t *testing.T) {
	producers, users := 81.5, 77.25
	result := &analysis.PredictResult{
		RunID:      "run-1",
		NDates:     2,
		DateRange:  []string{"2025-01-09", "2025-02-08"},
		ComputedAt: "2026-11-16T19:00:00Z",
		Parameters: &analysis.RunParameters{
			Source: "stac", Start: "2025-01-01", End: "2025-02-28", MaxCloud: 60, MonthlyBest: true, Mode: "single",
		},
		Scenes: []analysis.RunScene{
			{ID: "S2C_T21JYN_20250109T134417_L2A", Date: "2025-01-09", ProcessingBaseline: "05.11"},
			{ID: "S2C_T21JYN_20250208T134417_L2A", Date: "2025-02-08", ProcessingBaseline: "05.11"},
		},
		ImagerySource: []analysis.ImagerySource{{
			Collection: "sentinel-2-l2a", Source: "earth-search", Title: "Element 84 Earth Search",
			URL: "https://earth-search.aws.element84.com/v1", CatalogueCollection: "sentinel-2-c1-l2a",
		}},
		Model: &analysis.ModelRef{ID: "spectral", Version: "1.0.1", Digest: "5f4d"},
		LULC: &analysis.LULCAnalysis{
			Year: 2023, Source: "MapBiomas Collection 10",
			Agreement: &analysis.LULCAgreement{
				NReferenceCells: 120, OverallPct: 79.2, OverallCI: []float64{71.1, 85.5},
				QuantityDisagreementPct: 8, AllocationDisagreementPct: 12.8,
				PerClass: []analysis.LULCClassAccuracy{{
					ClassID: 39, Name: "Soybean", Color: "#c27ba0",
					ProducersPct: &producers, ProducersCI: []float64{70, 89},
					UsersPct: &users, NReference: 60, NPredicted: 64,
				}},
				Matrix:        [][]int{{50, 4}, {10, 56}},
				MatrixClasses: []int{39, 41},
			},
		},
		DomainFingerprint: &analysis.DomainFingerprint{Space: "spectral", NFeatures: 2, Mean: []float64{0.1, 0.2}},
	}

	raw, err := BuildResearchPackZIP(analysis.ResearchExportMeta{ModelKind: "spectral", AoiLabel: "A"}, result, "")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	for _, name := range []string{"lulc_agreement.csv", "lulc_accuracy.csv", "lulc_confusion.csv", "domain_fingerprint.json"} {
		if files[name] == nil {
			t.Fatalf("%s is missing from the package", name)
		}
	}

	var manifest struct {
		RunID      string                 `json:"run_id"`
		ComputedAt string                 `json:"computed_at"`
		Parameters analysis.RunParameters `json:"parameters"`
		Model      analysis.ModelRef      `json:"model"`
		Reference  map[string]any         `json:"reference"`
		Files      []string               `json:"files"`
		Imagery    struct {
			Sources []analysis.ImagerySource `json:"sources"`
			Scenes  []analysis.RunScene      `json:"scenes"`
		} `json:"imagery"`
	}
	if err := json.Unmarshal(mustReadZip(t, files["manifest.json"]), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.RunID != "run-1" || manifest.ComputedAt != "2026-11-16T19:00:00Z" {
		t.Fatalf("run %q at %q", manifest.RunID, manifest.ComputedAt)
	}
	if manifest.Model.Digest != "5f4d" || manifest.Parameters.MaxCloud != 60 {
		t.Fatalf("model %+v, parameters %+v", manifest.Model, manifest.Parameters)
	}
	if len(manifest.Imagery.Scenes) != 2 || manifest.Imagery.Sources[0].CatalogueCollection != "sentinel-2-c1-l2a" {
		t.Fatalf("imagery %+v", manifest.Imagery)
	}
	if manifest.Reference["year"] != float64(2023) {
		t.Fatalf("reference %+v", manifest.Reference)
	}
	for _, f := range zr.File {
		found := false
		for _, listed := range manifest.Files {
			found = found || listed == f.Name
		}
		if !found {
			t.Fatalf("%s is in the package but not in the manifest's list", f.Name)
		}
	}

	rows, err := csv.NewReader(bytes.NewReader(mustReadZip(t, files["lulc_confusion.csv"]))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	// matrix[pred][ref]: 10 cells the reference calls 39 were classified 41.
	if len(rows) != 5 || strings.Join(rows[3], ",") != "41,39,10" {
		t.Fatalf("confusion rows %v", rows)
	}
	rows, err = csv.NewReader(bytes.NewReader(mustReadZip(t, files["lulc_accuracy.csv"]))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(rows[1], ",") != "39,Soybean,#c27ba0,81.5,70,89,77.25,,,60,64" {
		t.Fatalf("accuracy row %v", rows[1])
	}
}
