package main

import (
	"net/url"
	"testing"

	"geosense-infer/internal/models"
)

// The catalogue this build carries is what the Models screen shows offline,
// and scripts/package_models.py writes it. Every entry must be one this
// version can install, or the screen would offer a download it then refuses.
func TestTheBuiltInCatalogueOffersOnlyWhatThisVersionInstalls(t *testing.T) {
	entries, unsupported, err := models.ParseCatalog(builtinCatalog)
	if err != nil {
		t.Fatal(err)
	}
	if unsupported != 0 {
		t.Fatalf("%d entries this version cannot install", unsupported)
	}
	if len(entries) == 0 {
		t.Fatal("the catalogue offers no model")
	}
	for _, e := range entries {
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
