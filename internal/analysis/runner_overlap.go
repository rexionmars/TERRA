package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// AnalyzeOverlap reads the public registers under an area (types_overlap.go
// says what the result is and is not). The map is read into a data URI, so
// the work directory goes when the call returns.
func (r *Runner) AnalyzeOverlap(ctx context.Context, req OverlapRequest) (*OverlapAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	workDir, err := os.MkdirTemp("", "terra-overlap-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	reqBytes, err := json.Marshal(map[string]any{
		"action":          "socioenvironmental_overlap",
		"polygon_geojson": req.PolygonGeoJSON,
		"work_dir":        workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseOverlapPayload([]byte(raw))
}

// parseOverlapPayload reads the sidecar's `overlap` object, the map as a data
// URI. A map that cannot be read costs the layer on the globe, not the figures.
func parseOverlapPayload(raw []byte) (*OverlapAnalysis, error) {
	var wrapped struct {
		Overlap *overlapSidecarResult `json:"overlap"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse socio-environmental overlap result: %w", err)
	}
	src := wrapped.Overlap
	if src == nil {
		return nil, errors.New("sidecar returned an empty socio-environmental overlap payload")
	}
	res := &OverlapAnalysis{
		AreaHa:           src.AreaHa,
		ReadAt:           src.ReadAt,
		Extent:           src.Extent,
		Biomes:           src.Biomes,
		States:           src.States,
		ForestCodeCutoff: src.ForestCodeCutoff,
		EUDRCutoff:       src.EUDRCutoff,
		Layers:           src.Layers,
		Periods:          src.Periods,
	}
	if src.MapPNG != "" {
		if uri, err := pngToDataURI(src.MapPNG); err == nil {
			res.MapURI = uri
		}
	}
	res.NormalizeNilSlices()
	return res, nil
}
