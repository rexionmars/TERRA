package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

/*
Every product that writes a raster records which one it is.

The column exists to answer "which of this run's files is the image to show",
and it was answered by two products out of five: the others that wrote a PNG
left the column NULL, so a reader of it would have been right for a fifth of
the table and silently wrong for the rest. That is why no reader was ever
written, and why the run list loads a whole result to reach an image already
sitting on disk.

Asserted by walking the run's asset directory rather than by naming the file
each product writes. A test that repeated those names would agree with itself
and not with the code; this one fails as soon as a product writes an image and
does not say so, including a product that does not exist yet.
*/
func TestEveryRasterRunRecordsItsOverlay(t *testing.T) {
	cases := []struct {
		name    string
		persist func(a *App) string
	}{
		{
			name: "water",
			persist: func(a *App) string {
				return a.persistWaterRun(
					analysis.WaterRequest{Label: "AOI"},
					&analysis.WaterAnalysis{OccurrenceURI: onePixelPNG},
				)
			},
		},
		{
			name: "classification",
			persist: func(a *App) string {
				return a.persistAnalysis(
					analysis.PredictRequest{Label: "AOI"},
					&analysis.PredictResult{OverlayURI: onePixelPNG},
				)
			},
		},
		{
			name: "mineral",
			persist: func(a *App) string {
				return a.persistMineralRun(
					analysis.MineralRequest{Label: "AOI"},
					&analysis.MineralAnalysis{Groups: []analysis.MineralGroup{
						{Group: 1, ClassURI: onePixelPNG},
						{Group: 2, ClassURI: onePixelPNG},
					}},
				)
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a := newTestApp(t)
			runID := c.persist(a)
			if runID == "" {
				t.Fatal("nothing was saved")
			}
			run, err := a.store.GetRun(store.LocalUserID, runID)
			if err != nil {
				t.Fatalf("get run: %v", err)
			}

			images := imagesUnder(t, a.store.RunsDir(runID))
			if len(images) == 0 {
				t.Fatal("the product wrote no image, so this case proves nothing")
			}
			if run.OverlayRelPath == "" {
				t.Fatalf("wrote %v and recorded no overlay path", images)
			}
			// The path is relative to the data directory, and it has to name a
			// file that is actually there: a column pointing into a directory
			// that does not exist is the shape saveRun already refuses to
			// write for the assets as a whole.
			full := filepath.Join(a.store.DataDir(), run.OverlayRelPath)
			if _, err := os.Stat(full); err != nil {
				t.Errorf("overlay path %q names no file: %v", run.OverlayRelPath, err)
			}
		})
	}
}

func imagesUnder(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".png") {
			out = append(out, e.Name())
		}
	}
	return out
}
