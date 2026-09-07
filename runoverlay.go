package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

/*
The image a run is recognised by, served over HTTP.

WHY THERE IS A ROUTE AND NOT A BOUND METHOD. main.go states the rule for the
grown stand and it holds here for the same reason: everything a bound method
returns is marshalled to JSON and handed to the webview as a string, so a
raster has to be base64 to survive the trip. One raster that way is affordable
and a WALL of them is not -- the studio browser lists every run a project
holds, and the panel exists to be scrolled. Fetched instead, each is bytes the
webview caches, decodes on its own thread, and can be told to load only when it
scrolls into view.

WHAT THIS REPLACES. The browser drew no thumbnail at all. Its own docblock says
why: "a run's raster is not on the row that lists it -- overlay_uri arrives
with the loaded payload, so a wall of thumbnails is a wall of loads" -- and it
drew a type plate instead, the product's glyph over the product's colour. That
reasoning was about the PAYLOAD, and the payload is not the only place the
raster is. Every run that writes one records where, in overlay_relpath.

WHICH IS ONLY TRUE AS OF NOW. That column was filled by two products out of
five -- classification and flood -- so a reader of it was right for a fifth of
the table and silently wrong for the rest, which is why nothing read it. Water
and the two solar rasters record theirs as well now, and the invariant is held
by TestEveryRasterRunRecordsItsOverlay. This route is the first reader the
column has had, and it could not have been written before that test passed.

A RUN ID, NOT A PATH. The caller names the run and this looks up where its
image is; a route taking a path would be a route that serves any file the
process can open, over a surface a page's own script can reach.
*/
const runOverlayURLPrefix = "/run-overlay/"

/*
assetMiddleware is the one middleware the asset server is given, and the two
routes it holds.

Wails takes a single Middleware, so a second route cannot be added beside the
first -- it has to be composed with it. Written as a composition rather than as
one function with two prefix tests because each half is about a different
subject and says so in its own docblock; the order between them does not
matter, since neither answers a path the other claims.
*/
func (a *App) assetMiddleware(next http.Handler) http.Handler {
	return a.meshMiddleware(a.runOverlayMiddleware(next))
}

func (a *App) runOverlayMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, runOverlayURLPrefix) {
			next.ServeHTTP(w, r)
			return
		}
		runID := strings.TrimPrefix(r.URL.Path, runOverlayURLPrefix)
		path, err := a.runOverlayPath(runID)
		if err != nil {
			/*
				Answered here rather than passed on, for the reason the mesh
				route gives: the asset server behind this replies to an unknown
				path with index.html, and an <img> pointed at HTML shows a
				broken image with nothing saying why.
			*/
			http.NotFound(w, r)
			return
		}
		/*
			The bytes behind one of these URLs never change: a run's raster is
			written once, when the run is saved, and a run whose image is
			replaced is a different run with a different id. So the webview may
			hold it for as long as it likes.
		*/
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, path)
	})
}

/*
runOverlayPath is where a run's representative image is, or an error.

THE PATH IS CHECKED AGAINST THE DATA DIRECTORY EVEN THOUGH THIS PROCESS WROTE
IT. The column holds a relative path and relative paths compose: a row carrying
`../../` would name a file outside the store, and the fact that no writer here
produces one is a property of today's code rather than of the data. A store
restored from an archive, or edited by hand, is the same column with someone
else's contents in it.
*/
func (a *App) runOverlayPath(runID string) (string, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return "", os.ErrNotExist
	}
	st, err := a.requireStore()
	if err != nil {
		return "", err
	}
	run, err := st.GetRun(a.effectiveUserID(), runID)
	if err != nil {
		return "", err
	}
	rel := strings.TrimSpace(run.OverlayRelPath)
	if rel == "" {
		// A product whose whole result is figures. Not an error in the store,
		// and not something to serve either.
		return "", os.ErrNotExist
	}
	root := filepath.Clean(st.DataDir())
	path := filepath.Clean(filepath.Join(root, rel))
	if path != root && !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		return "", os.ErrNotExist
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", os.ErrNotExist
	}
	return path, nil
}

// RunOverlayURL is the address of a run's image, empty where it has none.
//
// Bound so the browser can ask without knowing the route's shape: the prefix
// is this file's business, and a literal repeated in TypeScript is a second
// place to edit when it changes.
func (a *App) RunOverlayURL(runID string) string {
	if _, err := a.runOverlayPath(runID); err != nil {
		return ""
	}
	return runOverlayURLPrefix + runID
}
