package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// geoPackageDirPrefix names the directories a GeoPackage's layers are written
// into. They outlive the call, because the map fetches from them for as long
// as the file is open, and sweepTempArtifacts removes them once stale.
const geoPackageDirPrefix = "terra-geopackage-"

/*
OpenGeoPackage writes every drawable layer of the GeoPackage at path as GeoJSON
into a directory of its own, and returns the layers and that directory.

The caller owns the directory from here: it serves the files from it and
removes it when the file is closed.
*/
func (r *Runner) OpenGeoPackage(ctx context.Context, path string) (*GeoPackage, string, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, "", fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	dir, err := os.MkdirTemp("", geoPackageDirPrefix)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create work dir: %w", err)
	}
	reqBytes, err := json.Marshal(map[string]any{
		"action":   "geopackage_open",
		"path":     path,
		"work_dir": dir,
	})
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, "", fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, "", err
	}
	gp, err := parseGeoPackage(path, []byte(raw))
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, "", err
	}
	return gp, dir, nil
}

// parseGeoPackage reads the sidecar's listing, with absent lists as empty ones
// so the page never meets a null where it expects a list.
func parseGeoPackage(path string, raw []byte) (*GeoPackage, error) {
	var wrapped struct {
		GeoPackage *GeoPackage `json:"geopackage"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse the GeoPackage listing: %w", err)
	}
	gp := wrapped.GeoPackage
	if gp == nil {
		return nil, errors.New("sidecar returned an empty GeoPackage listing")
	}
	gp.Path = path
	gp.Name = filepath.Base(path)
	if gp.Layers == nil {
		gp.Layers = []GeoPackageLayer{}
	}
	for i := range gp.Layers {
		if gp.Layers[i].Columns == nil {
			gp.Layers[i].Columns = []string{}
		}
	}
	return gp, nil
}
