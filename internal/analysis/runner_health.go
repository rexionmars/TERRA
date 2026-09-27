package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// AnalyzeHealth compares an area's vegetation this season with the same days
// of the year in earlier seasons (types_health.go says what that is and is
// not). The two maps are read into data URIs, so the work directory goes when
// the call returns.
func (r *Runner) AnalyzeHealth(ctx context.Context, req HealthRequest) (*HealthAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, errors.New("set the start and end of the period")
	}
	workDir, err := os.MkdirTemp("", "terra-health-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	payload := map[string]any{
		"action":          "vegetation_health",
		"polygon_geojson": req.PolygonGeoJSON,
		"start":           req.Start,
		"end":             req.End,
		"work_dir":        workDir,
	}
	if req.MaxCloud > 0 {
		payload["max_cloud"] = req.MaxCloud
	}
	if req.BaselineYears > 0 {
		payload["baseline_years"] = req.BaselineYears
	}
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseHealthPayload([]byte(raw))
}

// parseHealthPayload reads the sidecar's `health` object, the maps as data
// URIs. A map that cannot be read costs its layer, not the figures.
func parseHealthPayload(raw []byte) (*HealthAnalysis, error) {
	var wrapped struct {
		Health *healthSidecarResult `json:"health"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse vegetation health result: %w", err)
	}
	src := wrapped.Health
	if src == nil {
		return nil, errors.New("sidecar returned an empty vegetation health payload")
	}
	res := &HealthAnalysis{
		Extent:        src.Extent,
		WindowDays:    src.WindowDays,
		BaselineYears: src.BaselineYears,
		Current:       src.Current,
		Baseline:      src.Baseline,
		Anomaly:       src.Anomaly,
		Latest:        src.Latest,
		MapDate:       src.MapDate,
		MapRange:      src.MapRange,
	}
	for _, img := range []struct {
		path string
		dst  *string
	}{
		{src.AnomalyPNG, &res.AnomalyURI},
		{src.NDVIPNG, &res.NDVIURI},
	} {
		if img.path == "" {
			continue
		}
		if uri, err := pngToDataURI(img.path); err == nil {
			*img.dst = uri
		}
	}
	res.NormalizeNilSlices()
	return res, nil
}
