package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
	"time"

	"geosense-infer/internal/analysis"
)

func opaquePNG(t testing.TB, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// alphaRows reads the mask back as rows of '#' (kept) and '.' (cut), top first.
func alphaRows(t *testing.T, data []byte) []string {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	rows := make([]string, 0, b.Dy())
	for y := b.Min.Y; y < b.Max.Y; y++ {
		row := make([]byte, 0, b.Dx())
		for x := b.Min.X; x < b.Max.X; x++ {
			if color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA).A == 0 {
				row = append(row, '.')
			} else {
				row = append(row, '#')
			}
		}
		rows = append(rows, string(row))
	}
	return rows
}

func sameRows(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d: got %s, want %s\nall: %v", i, got[i], want[i], got)
		}
	}
}

// One degree per pixel: pixel (x, y) is centred on lon x+0.5, lat 3.5-y.
var unitExtent = analysis.Bounds{LonMin: 0, LatMin: 0, LonMax: 4, LatMax: 4}

func TestMaskPNGToAreaCutsOutsideThePolygon(t *testing.T) {
	// The left half, as the drawn outline would sit over the image.
	poly := `{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,4],[0,4],[0,0]]]}`
	got, err := maskPNGToArea(opaquePNG(t, 4, 4), unitExtent, poly)
	if err != nil {
		t.Fatal(err)
	}
	sameRows(t, alphaRows(t, got), []string{"##..", "##..", "##..", "##.."})
}

func TestMaskPNGToAreaFollowsASlantedEdge(t *testing.T) {
	// Below the line lat = 0.75 lon, which no pixel centre lies on.
	poly := `{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,3],[0,0]]]}`
	got, err := maskPNGToArea(opaquePNG(t, 4, 4), unitExtent, poly)
	if err != nil {
		t.Fatal(err)
	}
	sameRows(t, alphaRows(t, got), []string{"....", "...#", "..##", ".###"})
}

func TestMaskPNGToAreaLeavesAHoleOutAndKeepsEveryPart(t *testing.T) {
	poly := `{"type":"MultiPolygon","coordinates":[
		[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]],
		[[[3,3],[4,3],[4,4],[3,4],[3,3]]]
	]}`
	got, err := maskPNGToArea(opaquePNG(t, 4, 4), unitExtent, poly)
	if err != nil {
		t.Fatal(err)
	}
	sameRows(t, alphaRows(t, got), []string{"...#", "###.", "#.#.", "###."})
}

func TestMaskPNGToAreaRefusesWhatItCannotPlace(t *testing.T) {
	data := opaquePNG(t, 2, 2)
	poly := `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`
	for name, tc := range map[string]struct {
		extent analysis.Bounds
		poly   string
	}{
		"point":        {unitExtent, `{"type":"Point","coordinates":[0,0]}`},
		"not json":     {unitExtent, `{`},
		"no ring":      {unitExtent, `{"type":"Polygon","coordinates":[]}`},
		"empty extent": {analysis.Bounds{}, poly},
	} {
		if _, err := maskPNGToArea(data, tc.extent, tc.poly); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

// The size of a real delineation, measured because it runs on every load of a
// saved run.
func TestMaskPNGToAreaAtTheSizeOfARun(t *testing.T) {
	if testing.Short() {
		t.Skip("timing")
	}
	data := opaquePNG(t, 2639, 2246)
	ext := analysis.Bounds{LonMin: -53.2, LatMin: -25.1, LonMax: -52.95, LatMax: -24.9}
	poly := `{"type":"Polygon","coordinates":[[[-53.18,-25.08],[-52.97,-25.06],[-53.0,-24.92],[-53.15,-24.93],[-53.18,-25.08]]]}`
	start := time.Now()
	if _, err := maskPNGToArea(data, ext, poly); err != nil {
		t.Fatal(err)
	}
	t.Logf("2639x2246: %v", time.Since(start))
}
