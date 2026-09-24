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
AnalyzeFields delineates the fields inside an area.

weightsDir is where the network's checkpoint is cached, downloaded by the
sidecar on first use. It is the caller's to choose because it belongs to the
installation, not to the run: a directory under the application's data, so the
file survives an update of the application and is fetched once per machine.

The work directory is kept, as the mineral map's is: the GeoTIFF the result
names is a file in it until the run is saved. Its prefix is in
keptWorkDirPrefixes, which is what bounds it.
*/
func (r *Runner) AnalyzeFields(ctx context.Context, req FieldsRequest, weightsDir string) (*FieldsAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.PolygonGeoJSON == nil {
		return nil, errors.New("no polygon provided")
	}
	for name, w := range map[string]FieldsWindow{"A": req.WindowA, "B": req.WindowB} {
		if strings.TrimSpace(w.Start) == "" || strings.TrimSpace(w.End) == "" {
			return nil, fmt.Errorf("set the start and end of window %s", name)
		}
	}
	if strings.TrimSpace(weightsDir) == "" {
		return nil, errors.New("no directory to keep the field-boundary weights in")
	}

	workDir, err := os.MkdirTemp("", "terra-fields-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	payload := map[string]any{
		"action":          "field_boundaries",
		"polygon_geojson": req.PolygonGeoJSON,
		"window_a":        req.WindowA,
		"window_b":        req.WindowB,
		"weights_dir":     weightsDir,
		"work_dir":        workDir,
	}
	if req.MaxCloud > 0 {
		payload["max_cloud"] = req.MaxCloud
	}
	if req.MinAreaM2 > 0 {
		payload["min_area_m2"] = req.MinAreaM2
	}
	if s := strings.TrimSpace(req.Checkpoint); s != "" {
		payload["checkpoint"] = s
	}
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseFieldsPayload([]byte(raw))
}

/*
parseFieldsPayload reads the sidecar's `fields` object into what the interface
receives: the polygons read in as text, the three images as data URIs.

The GeoJSON is required and the images are not. A result without its polygons
has nothing left to show, while a missing image costs one layer of the map.
*/
func parseFieldsPayload(raw []byte) (*FieldsAnalysis, error) {
	var wrapped struct {
		Fields *fieldsSidecarResult `json:"fields"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse field-boundary result: %w", err)
	}
	src := wrapped.Fields
	if src == nil {
		return nil, errors.New("sidecar returned an empty field-boundary payload")
	}
	geojson, err := os.ReadFile(src.FieldsGeoJSON)
	if err != nil {
		return nil, fmt.Errorf("the field polygons could not be read: %w", err)
	}
	res := &FieldsAnalysis{
		Extent:            src.Extent,
		Checkpoint:        src.Checkpoint,
		WindowA:           src.WindowA,
		WindowB:           src.WindowB,
		Grid:              src.Grid,
		ResizeFactor:      src.ResizeFactor,
		MinAreaM2:         src.MinAreaM2,
		SimplifyM:         src.SimplifyM,
		AreaHa:            src.AreaHa,
		MaskedFraction:    src.MaskedFraction,
		ClassFraction:     src.ClassFraction,
		NFields:           src.NFields,
		FieldAreaHa:       src.FieldAreaHa,
		CroplandReference: src.CroplandReference,
		FieldsGeoJSON:     string(geojson),
		ClassesTIF:        src.ClassesTIF,
	}
	for _, img := range []struct {
		path string
		dst  *string
	}{
		{src.ClassesPNG, &res.ClassesURI},
		{src.WindowAPNG, &res.WindowAURI},
		{src.WindowBPNG, &res.WindowBURI},
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
