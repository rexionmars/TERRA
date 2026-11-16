package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/models"
	"geosense-infer/internal/store"
)

// The NDVI trajectory: an area's Sentinel-2 series through an installed
// time-series model, as a daily NDVI with its interval
// (internal/analysis/types_trajectory.go). Queued as a job over the area in
// hand or the fields of an area, and recorded as a run of its own kind under
// its area. Nothing is written to disk but the row: the result is a series.

// AnalyzeTrajectory runs an installed time-series model over an area's series.
func (a *App) AnalyzeTrajectory(req analysis.TrajectoryRequest) (*analysis.TrajectoryAnalysis, error) {
	return a.analyzeTrajectory(a.ctx, req)
}

// analyzeTrajectory is AnalyzeTrajectory under a context of the caller's; see predict.
func (a *App) analyzeTrajectory(ctx context.Context, req analysis.TrajectoryRequest) (*analysis.TrajectoryAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	root := a.modelsDir()
	if root == "" {
		return nil, errors.New("the local store is not open")
	}
	pkg, err := resolveTrajectoryModel(root, req.ModelID, req.ModelVersion)
	if err != nil {
		return nil, err
	}
	res, err := runner.AnalyzeTrajectory(ctx, req, pkg.Dir)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistTrajectoryRun(req, res)
	return res, nil
}

/*
resolveTrajectoryModel finds the installed package a trajectory runs. Only a
time-series package resolves, as only a land-cover one resolves for the
classification (app_analysis.go): a model of one task cannot do another's.
*/
func resolveTrajectoryModel(root, id, version string) (*models.Package, error) {
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("no time-series model was chosen; install one from Models")
	}
	return models.Resolve(root, models.TimeSeries, id, version)
}

/*
persistTrajectoryRun saves a trajectory run.

The summary carries how many dates the model kept of those it used, the scale
of the interval and the model, which is what a run list can say of a field in
one line; the series stays in the result. The model's id is the run's model
kind, as a classification records the model it ran.
*/
func (a *App) persistTrajectoryRun(req analysis.TrajectoryRequest, res *analysis.TrajectoryAnalysis) string {
	if res == nil {
		return ""
	}
	kept := 0
	for _, o := range res.Observations {
		if o.Kept {
			kept++
		}
	}
	label := aoiLabel(req.Label)
	summary := map[string]any{
		"trajectory_n_observations": len(res.Observations),
		"trajectory_n_kept":         kept,
		"trajectory_scale":          res.Scale,
		"trajectory_model":          res.Model.Name,
		"trajectory_model_version":  res.Model.Version,
		"aoi_label":                 label,
	}
	if n := len(res.Dates); n > 0 {
		summary["trajectory_from"] = res.Dates[0]
		summary["trajectory_to"] = res.Dates[n-1]
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindTrajectory,
		modelKind:   res.Model.ID,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      len(res.Observations),
		summary:     summary,
		result: func(_, _ string) any {
			stored := *res
			stored.RunID = ""
			return stored
		},
	})
}

// loadTrajectoryRun reads a saved trajectory run back from its row.
func loadTrajectoryRun(run *store.InferenceRun) *analysis.TrajectoryAnalysis {
	var r analysis.TrajectoryAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &r)
	}
	r.NormalizeNilSlices()
	r.RunID = run.ID
	return &r
}
