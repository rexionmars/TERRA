package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// Sentinel-1 radar: every pass over an area in a period, its series by orbit,
// its canopy losses and two maps of the latest pass
// (internal/analysis/types_radar.go). Queued as a job over the area in hand or
// the fields of an area, and recorded as a run of its own kind under its area.

const (
	radarCompositePNG = "radar_composite.png"
	radarWaterPNG     = "radar_water.png"
)

// AnalyzeRadar reads every Sentinel-1 pass over an area in a period.
func (a *App) AnalyzeRadar(req analysis.RadarRequest) (*analysis.RadarAnalysis, error) {
	return a.analyzeRadar(a.ctx, req)
}

// analyzeRadar is AnalyzeRadar under a context of the caller's; see predict.
func (a *App) analyzeRadar(ctx context.Context, req analysis.RadarRequest) (*analysis.RadarAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeRadar(ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistRadarRun(req, res)
	return res, nil
}

/*
persistRadarRun saves a radar run with its two maps as files of the run.

The summary carries the passes read and the latest canopy loss, which is what a
run list can say of a field in one line; the series stay in the result.
*/
func (a *App) persistRadarRun(req analysis.RadarRequest, res *analysis.RadarAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	summary := map[string]any{
		"radar_n_passes": len(res.Series),
		"radar_n_orbits": len(res.Orbits),
		"radar_n_losses": len(res.Losses),
		"radar_map_date": res.MapDate,
		"aoi_label":      label,
	}
	if n := len(res.Losses); n > 0 {
		last := res.Losses[n-1]
		summary["radar_last_loss_from"] = last.DateFrom
		summary["radar_last_loss_to"] = last.DateTo
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindRadar,
		modelKind:   "sentinel-1-rtc",
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      len(res.Series),
		summary:     summary,
		result: func(assetsDir, _ string) any {
			_ = store.WriteDataURIFile(res.CompositeURI, filepath.Join(assetsDir, radarCompositePNG))
			_ = store.WriteDataURIFile(res.WaterURI, filepath.Join(assetsDir, radarWaterPNG))
			stored := *res
			stored.CompositeURI = ""
			stored.WaterURI = ""
			stored.RunID = ""
			return stored
		},
		overlayFile: radarCompositePNG,
	})
}

// loadRadarRun reads a saved radar run back: its series from the row, its maps
// from the run's directory.
func loadRadarRun(run *store.InferenceRun, assetsDir string) *analysis.RadarAnalysis {
	var r analysis.RadarAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &r)
	}
	r.NormalizeNilSlices()
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, radarCompositePNG), "image/png"); err == nil {
		r.CompositeURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, radarWaterPNG), "image/png"); err == nil {
		r.WaterURI = uri
	}
	r.RunID = run.ID
	return &r
}
