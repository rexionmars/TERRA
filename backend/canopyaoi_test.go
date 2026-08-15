package backend

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"
)

// A synthetic season: bare soil, green-up, peak, senescence. Shaped rather than
// sampled from a run, so the test states what it exercises instead of depending
// on an acquisition someone could delete.
func season(n int) []VIObservation {
	out := make([]VIObservation, n)
	base := time.Date(2024, 10, 1, 0, 0, 0, 0, time.UTC)
	for i := range out {
		t := float64(i) / float64(n-1)
		ndvi := 0.16 + 0.68*math.Exp(-math.Pow(t-0.55, 2)/(2*math.Pow(0.19, 2)))
		out[i] = VIObservation{
			Date:     base.AddDate(0, 0, 10*i).Format("2006-01-02"),
			NDVIMean: ndvi,
		}
	}
	return out
}

func f64(v float64) *float64 { return &v }

/*
The season crosses as a canopy, and the refusals cross with it.

What this holds is the shape of the reply rather than its numbers: that a bare
date carries a reason instead of an age, that the plateau yields a lower bound
instead of an invented age, and that a declining canopy is marked. Each of those
was a defect at some point, and each is invisible in an aggregate.
*/
func TestCanopyFromAOIReadsASeasonAndSaysWhatItCannotRead(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", root+"/..")

	if !hasPyHelios(t, py) {
		t.Skip("pyhelios is not installed in this interpreter; nothing to grow")
	}

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Second)
	defer cancel()

	// No location: the reference suns answer and no POWER request is made, so
	// this stays offline and fast.
	got, err := r.BuildCanopyFromAOI(ctx, CanopyFromAOIRequest{
		Species: "sorghum", VISeries: season(20),
		InterRow: f64(0.8), InterPlant: f64(0.25),
	})
	if err != nil {
		t.Fatal(err)
	}

	if got.Density < 4.9 || got.Density > 5.1 {
		t.Errorf("0.8 x 0.25 m is 5 plants/m2, got %.2f", got.Density)
	}
	if got.ReachableLAI <= 0 {
		t.Error("the species reaches no LAI at this density")
	}
	if len(got.Resolved) != 20 || len(got.States) != 20 {
		t.Fatalf("20 observations in, %d resolved and %d states out",
			len(got.Resolved), len(got.States))
	}
	if got.NUsable == 0 {
		t.Fatal("no date in a full season could be read as a canopy")
	}

	var refused, plateau, declining int
	for _, row := range got.Resolved {
		if row.Error != "" {
			refused++
			// A refusal that does not say what to change is a blank stare.
			if len(row.Error) < 10 {
				t.Errorf("%s refused with %q", row.Date, row.Error)
			}
			if row.Day != nil {
				t.Errorf("%s carries both an age and a refusal", row.Date)
			}
		}
		if row.AtPlateau && row.Day == nil && row.DayAtLeast == nil {
			t.Errorf("%s is at the plateau with neither an age nor a bound",
				row.Date)
		}
		if row.AtPlateau {
			plateau++
		}
		if row.Declining {
			declining++
			// The ladder only grows, so past the peak the two ages measure
			// different things and must not be compared.
			if row.AgeCheck.Comparable {
				t.Errorf("%s is declining and still compared ages", row.Date)
			}
		}
	}
	if refused == 0 {
		t.Error("a season that starts and ends on bare soil refused nothing")
	}
	if declining == 0 {
		t.Error("a season with a peak in it marked nothing as declining")
	}

	// Without a location the sun is the reference set, and the payload has to
	// say so rather than implying a sky it did not read.
	if got.Sun.Source != "reference" {
		t.Errorf("no location given, sun source is %q", got.Sun.Source)
	}
	if got.Light != nil {
		t.Error("no location given, yet a canopy was lit")
	}

	if b, err := json.Marshal(got); err != nil || len(b) < 100 {
		t.Errorf("the reply does not round-trip through JSON: %v", err)
	}
}
