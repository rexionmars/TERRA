package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// AnalyzeRadar reads every Sentinel-1 pass over an area in a period
// (types_radar.go says what the result is and is not). The maps are read into
// data URIs, so the work directory goes when the call returns.
func (r *Runner) AnalyzeRadar(ctx context.Context, req RadarRequest) (*RadarAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, errors.New("set the start and end of the period")
	}
	workDir, err := os.MkdirTemp("", "terra-radar-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	reqBytes, err := json.Marshal(map[string]any{
		"action":          "radar_series",
		"polygon_geojson": req.PolygonGeoJSON,
		"start":           req.Start,
		"end":             req.End,
		"work_dir":        workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseRadarPayload([]byte(raw))
}

// parseRadarPayload reads the sidecar's `radar` object, the maps as data URIs.
// A map that cannot be read costs its layer, not the series.
func parseRadarPayload(raw []byte) (*RadarAnalysis, error) {
	var wrapped struct {
		Radar *radarSidecarResult `json:"radar"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse radar result: %w", err)
	}
	src := wrapped.Radar
	if src == nil {
		return nil, errors.New("sidecar returned an empty radar payload")
	}
	res := &RadarAnalysis{
		Extent:    src.Extent,
		Orbits:    src.Orbits,
		Series:    src.Series,
		Losses:    src.Losses,
		MapDate:   src.MapDate,
		MapOrbit:  src.MapOrbit,
		WaterVHDB: src.WaterVHDB,
		WaterVVDB: src.WaterVVDB,
		LossVHDB:  src.LossVHDB,
		LossCRDB:  src.LossCRDB,
	}
	for _, img := range []struct {
		path string
		dst  *string
	}{
		{src.CompositePNG, &res.CompositeURI},
		{src.WaterPNG, &res.WaterURI},
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
