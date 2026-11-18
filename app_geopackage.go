package main

/*
Files opened from disk: the dialog that chooses one, the text of a KML or
GeoJSON file for the page to make an area of, and a GeoPackage opened on the
map, its layers served to the page.

THE DIALOG IS NATIVE AND OPENED FROM HERE, not from a file input in the page. A
GeoPackage is an SQLite database the sidecar reads, and that needs its path; a
page is given a file's bytes and never its path. KML and GeoJSON go through the
same dialog, and their text is handed to the page, which parses them as it
always has.
*/

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/google/uuid"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"geosense-infer/internal/analysis"
)

// areaFileMaxBytes bounds a KML or GeoJSON file handed to the page, which
// parses it in one piece. A field or a municipality is kilobytes to a few
// megabytes; past this the file is a register, and a GeoPackage of it is what
// can be opened instead.
const areaFileMaxBytes = 64 << 20

// ChooseAreaFile asks for a file to make an area from, or a GeoPackage to open,
// and returns its path, empty when the reader cancels.
func (a *App) ChooseAreaFile() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Import an area from a file",
		Filters: []wruntime.FileFilter{
			{DisplayName: "KML, GeoJSON or GeoPackage", Pattern: "*.kml;*.geojson;*.json;*.gpkg"},
		},
	})
}

// ChooseGeoPackage asks for a GeoPackage to open on the map and returns its
// path, empty when the reader cancels.
func (a *App) ChooseGeoPackage() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Open a GeoPackage",
		Filters: []wruntime.FileFilter{
			{DisplayName: "GeoPackage (*.gpkg)", Pattern: "*.gpkg"},
		},
	})
}

// ReadAreaFile returns the text of a KML or GeoJSON file, for the page to parse.
func (a *App) ReadAreaFile(path string) (string, error) {
	return readAreaFile(path)
}

func readAreaFile(path string) (string, error) {
	name := filepath.Base(path)
	switch strings.ToLower(filepath.Ext(path)) {
	case ".kml", ".geojson", ".json":
	default:
		return "", fmt.Errorf("%s is not a KML or GeoJSON file", name)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", name, err)
	}
	if info.Size() > areaFileMaxBytes {
		return "", fmt.Errorf("%s holds %.0f MB, and an area file over %d MB is not read; save it as a GeoPackage and open that",
			name, float64(info.Size())/(1<<20), areaFileMaxBytes>>20)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", name, err)
	}
	return string(raw), nil
}

/*
openedGeoPackages maps the id of each open GeoPackage to the directory its
layers were written into.

AN ID, NOT A PATH, in the URL the page fetches: the route serves only
directories this process created for a file it opened, and only the layer
files in them, so a page's script cannot use it to read anything else.
*/
type openedGeoPackages struct {
	mu   sync.Mutex
	dirs map[string]string
}

func (o *openedGeoPackages) add(dir string) string {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.dirs == nil {
		o.dirs = map[string]string{}
	}
	id := uuid.NewString()
	o.dirs[id] = dir
	return id
}

func (o *openedGeoPackages) dir(id string) (string, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	d, ok := o.dirs[id]
	return d, ok
}

func (o *openedGeoPackages) remove(id string) (string, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	d, ok := o.dirs[id]
	delete(o.dirs, id)
	return d, ok
}

const geoPackageURLPrefix = "/geopackage-layer/"

// geoPackageProgressEvent carries the sidecar's progress while a file is opened.
const geoPackageProgressEvent = "geopackage:progress"

// geoPackageLayerFile is the only name the sidecar gives a layer's file.
var geoPackageLayerFile = regexp.MustCompile(`^[0-9]+\.geojson$`)

/*
OpenGeoPackage reads the GeoPackage at path and writes its layers for the map.

Nothing is written to the project: the file is shown, and a polygon of it
becomes an area only when the reader asks for that on the map. The layers stay
servable until CloseGeoPackage, or until the application quits and the sweep
of temporary directories takes them.
*/
func (a *App) OpenGeoPackage(path string) (*analysis.GeoPackage, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	/*
		Each layer the sidecar reads is reported on an event of its own, with the
		file's path, so the page can say where a long open is. Not on the shared
		"predict:progress", which the run band reads as its own.
	*/
	ctx := analysis.WithProgress(a.ctx, func(ev analysis.ProgressEvent) {
		wruntime.EventsEmit(a.ctx, geoPackageProgressEvent, map[string]any{
			"path":     path,
			"progress": ev.Progress,
			"msg":      ev.Msg,
		})
	})
	gp, dir, err := runner.OpenGeoPackage(ctx, path)
	if err != nil {
		return nil, err
	}
	gp.ID = a.geoPackages.add(dir)
	for i := range gp.Layers {
		if f := gp.Layers[i].File; f != "" {
			gp.Layers[i].URL = geoPackageURLPrefix + gp.ID + "/" + f
		}
	}
	return gp, nil
}

// CloseGeoPackage stops serving an opened file's layers and removes them.
func (a *App) CloseGeoPackage(id string) error {
	dir, ok := a.geoPackages.remove(id)
	if !ok {
		return nil
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("remove the layers of the closed file: %w", err)
	}
	return nil
}

// geoPackageLayerPath is the file behind a layer URL's path, or false.
func (a *App) geoPackageLayerPath(rest string) (string, bool) {
	id, file, ok := strings.Cut(rest, "/")
	if !ok || !geoPackageLayerFile.MatchString(file) {
		return "", false
	}
	dir, ok := a.geoPackages.dir(id)
	if !ok {
		return "", false
	}
	return filepath.Join(dir, file), true
}

/*
geoPackageLayerMiddleware serves the GeoJSON of an open file's layers.

Over HTTP and not through a bound method for the reason run images are (see
runOverlayMiddleware): a layer of a few hundred thousand features is tens of
megabytes, and a bound method hands its result to the page as one string.
*/
func (a *App) geoPackageLayerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest, ok := strings.CutPrefix(r.URL.Path, geoPackageURLPrefix)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		path, ok := a.geoPackageLayerPath(rest)
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/geo+json")
		http.ServeFile(w, r, path)
	})
}
