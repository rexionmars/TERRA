package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"geosense-infer/internal/models"
)

// The catalogue this build carries is what the Models screen shows offline,
// and scripts/package_models.py writes it. Every entry must be one this
// version can install, or the screen would offer a download it then refuses.
func TestTheBuiltInCatalogueOffersOnlyWhatThisVersionInstalls(t *testing.T) {
	c, err := models.ParseCatalog(builtinCatalog)
	if err != nil {
		t.Fatal(err)
	}
	if c.Unsupported != 0 {
		t.Fatalf("%d entries this version cannot install", c.Unsupported)
	}
	if len(c.Models) == 0 {
		t.Fatal("the catalogue offers no model")
	}
	for _, e := range c.Models {
		if e.PictureURI == "" {
			t.Errorf("%s has no picture for its card", e.Manifest.ID)
		}
		for _, s := range e.Sources {
			if u, _ := url.Parse(s.URL); u.Scheme != "https" {
				t.Errorf("%s: %s is not HTTPS", e.Manifest.ID, s.URL)
			}
		}
	}
}

// A model in preparation that does not read is left out without a word, so the
// catalogue this build carries must hold none that would be.
func TestTheBuiltInCatalogueShowsEveryModelInPreparationItLists(t *testing.T) {
	var raw struct {
		Upcoming []json.RawMessage `json:"upcoming"`
	}
	if err := json.Unmarshal(builtinCatalog, &raw); err != nil {
		t.Fatal(err)
	}
	c, err := models.ParseCatalog(builtinCatalog)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Upcoming) != len(raw.Upcoming) {
		t.Fatalf("%d models in preparation listed, %d shown", len(raw.Upcoming), len(c.Upcoming))
	}
}

func TestAModelInPreparationCannotBeInstalled(t *testing.T) {
	a := newTestApp(t)
	body, err := json.Marshal(map[string]any{
		"format": 1,
		"models": []any{},
		"upcoming": []any{map[string]any{
			"id": "gp-interval", "name": "Interval", "task": "time_series",
			"summary": "A series with its interval.", "status": "Not yet evaluated.",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer s.Close()
	t.Setenv("TERRA_MODEL_CATALOG", s.URL+"/catalog.json")

	c, err := a.ModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if c.Origin != "online" || len(c.Upcoming) != 1 {
		t.Fatalf("read %s with %d upcoming; want the served catalogue and its one model", c.Origin, len(c.Upcoming))
	}
	for _, version := range []string{"", "1.0.0"} {
		_, err := a.InstallCatalogModel("gp-interval", version)
		if err == nil || !strings.Contains(err.Error(), "is not in the catalogue that was read") {
			t.Fatalf("version %q: got %v, want it refused as not in the catalogue", version, err)
		}
	}
}
