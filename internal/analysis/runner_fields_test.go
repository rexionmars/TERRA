package analysis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// onePixel is a valid PNG, so pngToDataURI has something to encode.
var onePixel = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
	0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
	0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

// recordedFields is the sidecar's payload from a real delineation over
// western Paraná (2024-10-31 and 2025-03-05, FTW PRUE B7), with its paths
// pointed at files written here.
func recordedFields(t *testing.T) (map[string]any, string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "research", "testdata", "fields_pr.json"))
	if err != nil {
		t.Fatal(err)
	}
	var wrapped map[string]map[string]any
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	geojson, err := os.ReadFile(filepath.Join("..", "research", "testdata", "fields_pr.geojson"))
	if err != nil {
		t.Fatal(err)
	}
	f := wrapped["fields"]
	for key, content := range map[string][]byte{
		"fields_geojson": geojson,
		"classes_png":    onePixel,
		"window_a_png":   onePixel,
		"window_b_png":   onePixel,
		"classes_tif":    []byte("tif"),
	} {
		path := filepath.Join(dir, key)
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
		f[key] = path
	}
	return f, string(geojson)
}

func TestParseFieldsPayloadReadsThePolygonsAndImages(t *testing.T) {
	f, geojson := recordedFields(t)
	raw, err := json.Marshal(map[string]any{"fields": f})
	if err != nil {
		t.Fatal(err)
	}
	res, err := parseFieldsPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.FieldsGeoJSON != geojson {
		t.Error("the polygons were not read from the file the sidecar named")
	}
	for name, uri := range map[string]string{
		"classes": res.ClassesURI, "window A": res.WindowAURI, "window B": res.WindowBURI,
	} {
		if !strings.HasPrefix(uri, "data:image/png;base64,") {
			t.Errorf("%s image is %q, want a PNG data URI", name, uri)
		}
	}
	if res.NFields != 389 || res.Checkpoint.Name != "FTW_PRUE_EFNET_B7" {
		t.Errorf("recorded figures did not bind: %d fields, checkpoint %q", res.NFields, res.Checkpoint.Name)
	}
	if res.WindowA.Date != "2024-10-31" || len(res.WindowA.Items) != 4 || res.WindowA.ClearFraction == nil {
		t.Errorf("window A did not bind: %+v", res.WindowA)
	}
	if res.FieldAreaHa == nil || res.FieldAreaHa.Median <= 0 {
		t.Errorf("field sizes did not bind: %+v", res.FieldAreaHa)
	}
}

// Without its polygons a delineation has nothing to show, so that is an error;
// a missing image costs its layer and nothing else.
func TestParseFieldsPayloadNeedsThePolygonsAndNotTheImages(t *testing.T) {
	f, _ := recordedFields(t)
	f["window_b_png"] = filepath.Join(t.TempDir(), "absent.png")
	raw, _ := json.Marshal(map[string]any{"fields": f})
	res, err := parseFieldsPayload(raw)
	if err != nil {
		t.Fatalf("a missing image failed the parse: %v", err)
	}
	if res.WindowBURI != "" {
		t.Error("an absent image produced a data URI")
	}

	f["fields_geojson"] = filepath.Join(t.TempDir(), "absent.geojson")
	raw, _ = json.Marshal(map[string]any{"fields": f})
	if _, err := parseFieldsPayload(raw); err == nil {
		t.Error("a payload whose polygons cannot be read parsed without error")
	}
	if _, err := parseFieldsPayload([]byte(`{"other":{}}`)); err == nil {
		t.Error("a payload with no fields object parsed without error")
	}
}
