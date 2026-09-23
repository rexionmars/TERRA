package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// EarthdataTokenEnv is the variable the sidecar reads the NASA Earthdata Login
// token from. The token travels in the child's environment and never in the
// request JSON, so it cannot reach a saved run's result or a log of requests.
const EarthdataTokenEnv = "EARTHDATA_TOKEN"

/*
AnalyzeMinerals maps surface mineralogy over an area from EMIT reflectance.

The work directory is kept: the GeoTIFF the result names is a file in it, and
nothing copies it out until the run is saved. Its prefix is in
keptWorkDirPrefixes, which is what bounds it.

token is the Earthdata Login token to hand the sidecar, or empty when the
process environment already carries EARTHDATA_TOKEN -- which then wins, as
TERRA_PYTHON does.
*/
func (r *Runner) AnalyzeMinerals(ctx context.Context, req MineralRequest, token string) (*MineralAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	if strings.TrimSpace(req.End) == "" {
		return nil, errors.New("set the end of the acquisition period")
	}

	workDir, err := os.MkdirTemp("", "terra-mineral-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	payload := map[string]any{
		"action":          "mineral_map",
		"polygon_geojson": req.PolygonGeoJSON,
		"end":             req.End,
		"work_dir":        workDir,
	}
	if s := strings.TrimSpace(req.Start); s != "" {
		payload["start"] = s
	}
	if req.MaxCloud > 0 {
		payload["max_cloud"] = req.MaxCloud
	}
	if req.MaxScenes > 0 {
		payload["max_scenes"] = req.MaxScenes
	}
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	var env []string
	if token != "" {
		env = append(env, EarthdataTokenEnv+"="+token)
	}
	raw, err := r.runSidecarJSONEnv(ctx, reqBytes, env)
	if err != nil {
		return nil, err
	}
	return parseMineralPayload([]byte(raw))
}

// parseMineralPayload reads the sidecar's `mineral` object and loads each
// group's class map into a data URI for the map.
func parseMineralPayload(raw []byte) (*MineralAnalysis, error) {
	var wrapped struct {
		Mineral *MineralAnalysis `json:"mineral"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse mineral result: %w", err)
	}
	if wrapped.Mineral == nil {
		return nil, errors.New("sidecar returned empty mineral payload")
	}
	res := wrapped.Mineral
	res.NormalizeNilSlices()
	for i := range res.Groups {
		if res.Groups[i].ClassPNG == "" {
			continue
		}
		if uri, err := pngToDataURI(res.Groups[i].ClassPNG); err == nil {
			res.Groups[i].ClassURI = uri
		}
	}
	return res, nil
}
