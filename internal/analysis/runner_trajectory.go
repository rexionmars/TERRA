package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

/*
AnalyzeTrajectory runs the installed time-series package at modelPath over an
area's Sentinel-2 series (types_trajectory.go says what the result is). The
caller resolves the package for the time_series task, so a land-cover model
never reaches the sidecar here, which refuses any family but gp_series.
*/
func (r *Runner) AnalyzeTrajectory(ctx context.Context, req TrajectoryRequest, modelPath string) (*TrajectoryAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, errors.New("set the start and end of the period")
	}
	if modelPath == "" {
		return nil, errors.New("no time-series model given; install one from Models")
	}
	workDir, err := os.MkdirTemp("", "terra-trajectory-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	reqBytes, err := json.Marshal(map[string]any{
		"action":          "series_trajectory",
		"polygon_geojson": req.PolygonGeoJSON,
		"start":           req.Start,
		"end":             req.End,
		"model_path":      modelPath,
		"work_dir":        workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseTrajectoryPayload([]byte(raw))
}

// parseTrajectoryPayload reads the sidecar's `trajectory` object. A trajectory
// whose bounds do not run beside its dates is refused rather than drawn short.
func parseTrajectoryPayload(raw []byte) (*TrajectoryAnalysis, error) {
	var wrapped struct {
		Trajectory *TrajectoryAnalysis `json:"trajectory"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse trajectory result: %w", err)
	}
	res := wrapped.Trajectory
	if res == nil {
		return nil, errors.New("sidecar returned an empty trajectory payload")
	}
	n := len(res.Dates)
	if len(res.NDVI) != n || len(res.Lower) != n || len(res.Upper) != n {
		return nil, fmt.Errorf("sidecar returned %d dates with %d NDVI values and %d and %d bounds",
			n, len(res.NDVI), len(res.Lower), len(res.Upper))
	}
	res.NormalizeNilSlices()
	return res, nil
}
