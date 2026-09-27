package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// Vegetation health: an area's NDVI and NDRE this season against the same days
// of the year in earlier seasons (internal/analysis/types_health.go). Run over
// one area from the band or queued over the fields of an area as jobs; either
// way it is recorded as a run of its own kind under its area.

const (
	healthAnomalyPNG = "health_anomaly.png"
	healthNDVIPNG    = "health_ndvi.png"
)

// AnalyzeHealth compares an area's vegetation with its earlier seasons.
func (a *App) AnalyzeHealth(req analysis.HealthRequest) (*analysis.HealthAnalysis, error) {
	return a.analyzeHealth(a.ctx, req)
}

// analyzeHealth is AnalyzeHealth under a context of the caller's; see predict.
func (a *App) analyzeHealth(ctx context.Context, req analysis.HealthRequest) (*analysis.HealthAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeHealth(ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistHealthRun(req, res)
	return res, nil
}

/*
persistHealthRun saves a health run with its two maps as files of the run.

The summary carries the latest departure, which is what a run list can say of
a field in one line; the series stay in the result.
*/
func (a *App) persistHealthRun(req analysis.HealthRequest, res *analysis.HealthAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	summary := map[string]any{
		"health_map_date":       res.MapDate,
		"health_baseline_years": res.BaselineYears,
		"health_n_current":      len(res.Current),
		"aoi_label":             label,
	}
	if l := res.Latest; l != nil {
		summary["health_latest_date"] = l.Date
		summary["health_latest_ndvi_z"] = l.NDVIZ
		summary["health_latest_ndre_z"] = l.NDREZ
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindHealth,
		modelKind:   "ndvi-ndre-baseline",
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      len(res.Current),
		summary:     summary,
		result: func(assetsDir, _ string) any {
			_ = store.WriteDataURIFile(res.AnomalyURI, filepath.Join(assetsDir, healthAnomalyPNG))
			_ = store.WriteDataURIFile(res.NDVIURI, filepath.Join(assetsDir, healthNDVIPNG))
			stored := *res
			stored.AnomalyURI = ""
			stored.NDVIURI = ""
			stored.RunID = ""
			return stored
		},
		overlayFile: healthAnomalyPNG,
	})
}

// loadHealthRun reads a saved health run back: its figures from the row, its
// maps from the run's directory.
func loadHealthRun(run *store.InferenceRun, assetsDir string) *analysis.HealthAnalysis {
	var h analysis.HealthAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &h)
	}
	h.NormalizeNilSlices()
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, healthAnomalyPNG), "image/png"); err == nil {
		h.AnomalyURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, healthNDVIPNG), "image/png"); err == nil {
		h.NDVIURI = uri
	}
	h.RunID = run.ID
	return &h
}
