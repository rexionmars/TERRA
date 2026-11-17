package main

import (
	"reflect"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/pyenv"
)

func TestARadarRunCarriesTheTokenOnlyWhenItsSourceNeedsIt(t *testing.T) {
	t.Setenv(analysis.EarthdataTokenEnv, "")
	t.Setenv("TERRA_SENTINEL1_SOURCE", "")

	planetary := pyenv.AppConfig{EarthdataToken: "tok"}
	if got := radarEarthdataToken(planetary); got != "" {
		t.Fatalf("a radar read from the Planetary Computer was handed the token")
	}
	opera := pyenv.AppConfig{
		EarthdataToken: "tok",
		ImagerySources: map[string]string{"sentinel-1-rtc": "opera"},
	}
	if got := radarEarthdataToken(opera); got != "tok" {
		t.Fatalf("a radar read from OPERA was handed %q", got)
	}

	// With EARTHDATA_TOKEN exported, the child inherits it and nothing is added.
	t.Setenv(analysis.EarthdataTokenEnv, "from-shell")
	if got := radarEarthdataToken(opera); got != "" {
		t.Fatalf("handed %q over an inherited EARTHDATA_TOKEN", got)
	}
}

func TestChoosingASourceIsSavedAndTheDefaultLeavesNoEntry(t *testing.T) {
	a := newTestApp(t)
	t.Setenv("TERRA_SENTINEL2_SOURCE", "")
	t.Setenv("TERRA_SENTINEL1_SOURCE", "")

	status, err := a.SetImagerySource("sentinel-2-l2a", "earth-search")
	if err != nil {
		t.Fatal(err)
	}
	if status[0].Collection != "sentinel-2-l2a" || status[0].Chosen != "earth-search" {
		t.Fatalf("status after choosing = %+v", status[0])
	}
	if got := a.appConfig().ImagerySources["sentinel-2-l2a"]; got != "earth-search" {
		t.Fatalf("saved %q", got)
	}
	if env := a.runnerEnvironment(); len(env) != 1 || env[0] != "TERRA_SENTINEL2_SOURCE=earth-search" {
		t.Fatalf("runs would start with %v", env)
	}

	if _, err := a.SetImagerySource("sentinel-2-l2a", "planetary-computer"); err != nil {
		t.Fatal(err)
	}
	if cfg := a.appConfig(); cfg.ImagerySources != nil {
		t.Fatalf("the default left %v in the settings file", cfg.ImagerySources)
	}
}

func TestASourceTheCollectionDoesNotHaveIsRefused(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.SetImagerySource("sentinel-2-l2a", "opera"); err == nil {
		t.Fatal("Sentinel-2 was set to read from OPERA, which serves only radar")
	}
	if _, err := a.SetImagerySource("landsat-c2-l2", "earth-search"); err == nil {
		t.Fatal("a collection TERRA does not read was accepted")
	}
}

// A saved run keeps the catalogue it read, so reopening it says where its
// numbers came from. Asserted on water, the product whose stored copy is the
// whole result with only its image cleared.
func TestASavedRunKeepsTheCatalogueItRead(t *testing.T) {
	a := newTestApp(t)
	read := []analysis.ImagerySource{{
		Collection:          "sentinel-2-l2a",
		Source:              "earth-search",
		Title:               "Element 84 Earth Search",
		URL:                 "https://earth-search.aws.element84.com/v1",
		CatalogueCollection: "sentinel-2-c1-l2a",
	}}
	poly := &analysis.GeoJSONGeometry{
		Type:        "Polygon",
		Coordinates: [][][]float64{{{-54.345, -24.875}, {-54.325, -24.875}, {-54.325, -24.857}, {-54.345, -24.875}}},
	}
	runID := a.persistWaterRun(
		analysis.WaterRequest{PolygonGeoJSON: poly, Start: "2025-01-01", End: "2025-06-30"},
		&analysis.WaterAnalysis{Index: "MNDWI", NDates: 4, ImagerySource: read},
	)
	if runID == "" {
		t.Fatal("the water run was not saved")
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Water == nil || !reflect.DeepEqual(out.Water.ImagerySource, read) {
		t.Fatalf("reopened with %+v, want %+v", out.Water, read)
	}
}
