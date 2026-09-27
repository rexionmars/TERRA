package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// Socio-environmental overlap: an area against the public registers of
// deforestation, embargoes, indigenous lands, conservation units and CAR
// (internal/analysis/types_overlap.go). Queued over the fields of an area as
// jobs, or over the area in hand; recorded as a run of its own kind under its
// area, with the moment its registers were read.

const overlapMapPNG = "overlap_map.png"

// AnalyzeOverlap reads the public registers under an area.
func (a *App) AnalyzeOverlap(req analysis.OverlapRequest) (*analysis.OverlapAnalysis, error) {
	return a.analyzeOverlap(a.ctx, req)
}

// analyzeOverlap is AnalyzeOverlap under a context of the caller's; see predict.
func (a *App) analyzeOverlap(ctx context.Context, req analysis.OverlapRequest) (*analysis.OverlapAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeOverlap(ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistOverlapRun(req, res)
	return res, nil
}

/*
persistOverlapRun saves an overlap run with its map as a file of the run.

The summary carries each register's hectares and whether it was read, which is
what a run list can say of a field in one line; the features stay in the
result.
*/
func (a *App) persistOverlapRun(req analysis.OverlapRequest, res *analysis.OverlapAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	overlapHa := map[string]float64{}
	status := map[string]string{}
	for _, l := range res.Layers {
		overlapHa[l.ID] = l.OverlapHa
		status[l.ID] = l.Status
	}
	summary := map[string]any{
		"overlap_read_at":  res.ReadAt,
		"overlap_area_ha":  res.AreaHa,
		"overlap_ha":       overlapHa,
		"overlap_status":   status,
		"overlap_biomes":   res.Biomes,
		"aoi_label":        label,
		"overlap_n_layers": len(res.Layers),
	}
	return a.saveRun(savedRun{
		kind:      store.RunKindOverlap,
		modelKind: "public-registers",
		polygon:   req.PolygonGeoJSON,
		aoiLabel:  label,
		runLabel:  req.RunLabel,
		projectID: req.ProjectID,
		areaID:    req.AreaID,
		summary:   summary,
		result: func(assetsDir, _ string) any {
			_ = store.WriteDataURIFile(res.MapURI, filepath.Join(assetsDir, overlapMapPNG))
			stored := *res
			stored.MapURI = ""
			stored.RunID = ""
			return stored
		},
		overlayFile: overlapMapPNG,
	})
}

// loadOverlapRun reads a saved overlap run back: its registers from the row,
// its map from the run's directory.
func loadOverlapRun(run *store.InferenceRun, assetsDir string) *analysis.OverlapAnalysis {
	var o analysis.OverlapAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &o)
	}
	o.NormalizeNilSlices()
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, overlapMapPNG), "image/png"); err == nil {
		o.MapURI = uri
	}
	o.RunID = run.ID
	return &o
}
