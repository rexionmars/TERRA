package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Only the formats the page parses are read, and the text comes back whole.
func TestReadAreaFileReadsOnlyKMLAndGeoJSON(t *testing.T) {
	dir := t.TempDir()
	kml := filepath.Join(dir, "area.KML")
	if err := os.WriteFile(kml, []byte("<kml/>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := readAreaFile(kml); err != nil || got != "<kml/>" {
		t.Errorf("read = %q, %v", got, err)
	}
	if _, err := readAreaFile(filepath.Join(dir, "fazenda.gpkg")); err == nil {
		t.Error("a GeoPackage was read as text")
	}
	if _, err := readAreaFile(filepath.Join(dir, "absent.geojson")); err == nil {
		t.Error("a missing file was read")
	}
}

/*
The route serves a layer of a file that is open, and nothing else: not a file
under another id, not another name in the same directory, not a path that
climbs out of it, and nothing once the file is closed.
*/
func TestTheLayerRouteServesOnlyTheLayersOfAnOpenFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "0.geojson"), []byte(`{"type":"FeatureCollection","features":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	a := &App{}
	id := a.geoPackages.add(dir)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := a.geoPackageLayerMiddleware(next)
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}

	if w := get(geoPackageURLPrefix + id + "/0.geojson"); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/geo+json" {
		t.Errorf("an open layer answered %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	for _, path := range []string{
		geoPackageURLPrefix + "someone-else/0.geojson",
		geoPackageURLPrefix + id + "/notes.txt",
		geoPackageURLPrefix + id + "/../" + filepath.Base(dir) + "/notes.txt",
		geoPackageURLPrefix + id,
	} {
		if w := get(path); w.Code != http.StatusNotFound {
			t.Errorf("%s answered %d, want 404", path, w.Code)
		}
	}
	if w := get("/index.html"); w.Code != http.StatusTeapot {
		t.Errorf("another path was not passed on: %d", w.Code)
	}

	if err := a.CloseGeoPackage(id); err != nil {
		t.Fatal(err)
	}
	if w := get(geoPackageURLPrefix + id + "/0.geojson"); w.Code != http.StatusNotFound {
		t.Errorf("a closed file's layer answered %d", w.Code)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("closing left the directory: %v", err)
	}
}
