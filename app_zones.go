package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// Management zones: a field divided into three to five parts that have grown
// alike over several seasons (internal/analysis/types_zones.go). Queued as a
// job over a field, or the fields of an area, and recorded as a run of its own
// kind under it, every partition kept.

func zonesMapPNG(k int) string { return fmt.Sprintf("zones_%d.png", k) }

// AnalyzeZones draws the management zones of a field.
func (a *App) AnalyzeZones(req analysis.ZonesRequest) (*analysis.ZonesAnalysis, error) {
	return a.analyzeZones(a.ctx, req)
}

// analyzeZones is AnalyzeZones under a context of the caller's; see predict.
func (a *App) analyzeZones(ctx context.Context, req analysis.ZonesRequest) (*analysis.ZonesAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeZones(ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistZonesRun(req, res)
	return res, nil
}

/*
persistZonesRun saves a zones run, each partition's map a file of the run.

The run's overlay is the suggested partition's map, which is what a finished
job puts on the board and what the run list draws.
*/
func (a *App) persistZonesRun(req analysis.ZonesRequest, res *analysis.ZonesAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	used := 0
	for _, s := range res.Seasons {
		if s.Used {
			used++
		}
	}
	summary := map[string]any{
		"zones_suggested_k":  res.SuggestedK,
		"zones_seasons_used": used,
		"zones_n_cells":      res.NCells,
		"aoi_label":          label,
	}
	if p := res.Partition(res.SuggestedK); p != nil {
		summary["zones_fpi"] = p.FPI
		summary["zones_nce"] = p.NCE
	}
	overlay := ""
	if p := res.Partition(res.SuggestedK); p != nil && p.MapURI != "" {
		overlay = zonesMapPNG(p.K)
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindZones,
		modelKind:   "fuzzy-c-means",
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		summary:     summary,
		result: func(assetsDir, _ string) any {
			stored := *res
			stored.Partitions = make([]analysis.ZonesPartition, len(res.Partitions))
			for i, p := range res.Partitions {
				_ = store.WriteDataURIFile(p.MapURI, filepath.Join(assetsDir, zonesMapPNG(p.K)))
				p.MapURI = ""
				stored.Partitions[i] = p
			}
			stored.RunID = ""
			return stored
		},
		overlayFile: overlay,
	})
}

// loadZonesRun reads a saved zones run back: its partitions from the row,
// their maps from the run's directory.
func loadZonesRun(run *store.InferenceRun, assetsDir string) *analysis.ZonesAnalysis {
	var z analysis.ZonesAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &z)
	}
	z.NormalizeNilSlices()
	for i := range z.Partitions {
		k := z.Partitions[i].K
		if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, zonesMapPNG(k)), "image/png"); err == nil {
			z.Partitions[i].MapURI = uri
		}
	}
	z.RunID = run.ID
	return &z
}
