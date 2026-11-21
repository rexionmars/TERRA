package analysis

import (
	"context"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAFieldEditPartThatIsNotAPolygonIsRefused(t *testing.T) {
	for name, raw := range map[string]string{
		"no edit":   `{}`,
		"no rings":  `{"field_edit":{"op":"join","parts":[{"geometry":{"type":"Polygon","coordinates":[]},"area_ha":1}]}}`,
		"not shape": `{"field_edit":{"op":"join","parts":[{"geometry":{"type":"Point"},"area_ha":1}]}}`,
	} {
		if _, err := parseFieldEdit([]byte(raw)); err == nil {
			t.Errorf("%s: parsed", name)
		}
	}
	parts, err := parseFieldEdit([]byte(
		`{"field_edit":{"op":"split","parts":[` +
			`{"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"area_ha":2.5},` +
			`{"geometry":{"type":"Polygon","coordinates":[[[1,0],[2,0],[2,1],[1,0]]]},"area_ha":1}]}}`))
	if err != nil || len(parts) != 2 || parts[0].AreaHa != 2.5 {
		t.Fatalf("parts %+v, %v", parts, err)
	}
}

// The request and the reply as the two processes exchange them, over the real
// sidecar: a square near Toledo, PR, cut down the middle, and two squares 10 m
// apart joined across the strip between them.
func TestFieldEditsOverTheRealSidecar(t *testing.T) {
	py := findPython(t)
	if err := exec.Command(py, "-c", "import shapely, pyproj").Run(); err != nil {
		t.Skip("no python with shapely and pyproj available")
	}
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))
	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// About 200 m a side; 0.0001 degree of latitude is about 11 m.
	square := func(lat0 float64) string {
		return `{"type":"Polygon","coordinates":[[[-53.75,` + ftoa(lat0) + `],[-53.748,` + ftoa(lat0) +
			`],[-53.748,` + ftoa(lat0+0.0018) + `],[-53.75,` + ftoa(lat0+0.0018) + `],[-53.75,` + ftoa(lat0) + `]]]}`
	}
	parts, err := r.SplitField(ctx, square(-24.73), GeoJSONLine{
		Type: "LineString", Coordinates: [][]float64{{-53.749, -24.731}, {-53.749, -24.727}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 2 || parts[0].AreaHa < parts[1].AreaHa {
		t.Errorf("split into %+v", parts)
	}
	if _, err := r.SplitField(ctx, square(-24.73), GeoJSONLine{
		Type: "LineString", Coordinates: [][]float64{{-53.749, -24.731}, {-53.749, -24.729}},
	}); err == nil || !strings.Contains(err.Error(), "cross the field") {
		t.Errorf("a line that stops inside: %v", err)
	}

	joined, err := r.JoinFields(ctx, []string{square(-24.73), square(-24.73 + 0.0018 + 0.00009)})
	if err != nil {
		t.Fatal(err)
	}
	both := parts[0].AreaHa + parts[1].AreaHa
	if joined.AreaHa <= 2*both || joined.AreaHa > 2*both*1.06 {
		t.Errorf("joined %.3f ha from two of %.3f ha", joined.AreaHa, both)
	}
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
