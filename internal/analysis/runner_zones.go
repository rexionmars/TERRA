package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// AnalyzeZones draws the management zones of a field (types_zones.go says what
// they are and are not). The maps are read into data URIs, so the work
// directory goes when the call returns.
func (r *Runner) AnalyzeZones(ctx context.Context, req ZonesRequest) (*ZonesAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, errors.New("set the start and end of the period")
	}
	workDir, err := os.MkdirTemp("", "terra-zones-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	payload := map[string]any{
		"action":          "management_zones",
		"polygon_geojson": req.PolygonGeoJSON,
		"start":           req.Start,
		"end":             req.End,
		"work_dir":        workDir,
	}
	if req.MaxCloud > 0 {
		payload["max_cloud"] = req.MaxCloud
	}
	if req.EarlierSeasons > 0 {
		payload["earlier_seasons"] = req.EarlierSeasons
	}
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseZonesPayload([]byte(raw))
}

// parseZonesPayload reads the sidecar's `zones` object, each partition's map
// as a data URI. A map that cannot be read costs its layer, not the zones.
func parseZonesPayload(raw []byte) (*ZonesAnalysis, error) {
	var wrapped struct {
		Zones *zonesSidecarResult `json:"zones"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse management zones result: %w", err)
	}
	src := wrapped.Zones
	if src == nil {
		return nil, errors.New("sidecar returned an empty management zones payload")
	}
	res := &ZonesAnalysis{
		Extent:     src.Extent,
		Seasons:    src.Seasons,
		NCells:     src.NCells,
		FieldCells: src.FieldCells,
		Fuzziness:  src.Fuzziness,
		Percentile: src.Percentile,
		MinZoneHa:  src.MinZoneHa,
		SuggestedK: src.SuggestedK,
	}
	for _, p := range src.Partitions {
		out := ZonesPartition{
			K:            p.K,
			FPI:          p.FPI,
			NCE:          p.NCE,
			Iterations:   p.Iterations,
			Zones:        p.Zones,
			ZonesGeoJSON: p.ZonesGeoJSON,
		}
		if p.PNG != "" {
			if uri, err := pngToDataURI(p.PNG); err == nil {
				out.MapURI = uri
			}
		}
		res.Partitions = append(res.Partitions, out)
	}
	res.NormalizeNilSlices()
	return res, nil
}
