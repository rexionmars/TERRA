package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"sort"

	"geosense-infer/internal/analysis"
)

// A delineation's rasters cover the grid the network read, which is the area's
// bounding box plus a margin, so that the fields along the edge were seen
// whole. The sidecar now writes them cut to the area; runs saved before that
// carry the whole grid, and drawn it is a rectangle over the area rather than
// the area. These cut a saved raster at load, leaving the file as it is.

// maskPNGToArea returns the PNG with every pixel outside the polygon made
// transparent.
//
// PLACED THE WAY THE GLOBE PLACES IT. The image is drawn stretched linearly
// over `extent` in longitude and latitude, so each pixel centre is taken to
// that position here, and the cut follows the outline drawn over it. The grid
// underneath is UTM; the difference is the one the globe already shows.
//
// Even-odd, over every ring of every part: a hole is outside, a second part
// is inside.
func maskPNGToArea(data []byte, extent analysis.Bounds, polygonGeoJSON string) ([]byte, error) {
	rings, err := areaRings(polygonGeoJSON)
	if err != nil {
		return nil, err
	}
	if extent.LonMax <= extent.LonMin || extent.LatMax <= extent.LatMin {
		return nil, errors.New("the extent is empty")
	}
	src, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	img := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(img, img.Bounds(), src, b.Min, draw.Src)

	w, h := img.Rect.Dx(), img.Rect.Dy()
	dLon := (extent.LonMax - extent.LonMin) / float64(w)
	dLat := (extent.LatMax - extent.LatMin) / float64(h)
	crossings := make([]float64, 0, 16)
	for y := 0; y < h; y++ {
		lat := extent.LatMax - (float64(y)+0.5)*dLat
		crossings = crossings[:0]
		for _, ring := range rings {
			for i := range ring {
				p, q := ring[i], ring[(i+1)%len(ring)]
				// Half open in latitude, so a vertex on the scanline counts once.
				if (p[1] > lat) == (q[1] > lat) {
					continue
				}
				crossings = append(crossings, p[0]+(lat-p[1])/(q[1]-p[1])*(q[0]-p[0]))
			}
		}
		sort.Float64s(crossings)
		row := img.Pix[y*img.Stride : y*img.Stride+w*4]
		k := 0
		inside := false
		for x := 0; x < w; x++ {
			lon := extent.LonMin + (float64(x)+0.5)*dLon
			for k < len(crossings) && crossings[k] <= lon {
				inside = !inside
				k++
			}
			if !inside {
				row[x*4+3] = 0
			}
		}
	}

	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// areaRings is every ring of a Polygon or MultiPolygon, as lon/lat pairs.
func areaRings(polygonGeoJSON string) ([][][]float64, error) {
	var g struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	}
	if err := json.Unmarshal([]byte(polygonGeoJSON), &g); err != nil {
		return nil, err
	}
	var rings [][][]float64
	switch g.Type {
	case "Polygon":
		if err := json.Unmarshal(g.Coordinates, &rings); err != nil {
			return nil, err
		}
	case "MultiPolygon":
		var parts [][][][]float64
		if err := json.Unmarshal(g.Coordinates, &parts); err != nil {
			return nil, err
		}
		for _, p := range parts {
			rings = append(rings, p...)
		}
	default:
		return nil, fmt.Errorf("geometry %q is not a polygon", g.Type)
	}
	kept := rings[:0]
	for _, r := range rings {
		if len(r) < 3 {
			continue
		}
		for _, pt := range r {
			if len(pt) < 2 {
				return nil, errors.New("a position has fewer than two coordinates")
			}
		}
		kept = append(kept, r)
	}
	if len(kept) == 0 {
		return nil, errors.New("the polygon has no ring")
	}
	return kept, nil
}
