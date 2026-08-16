package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
The mesh is delivered over HTTP, so the handler is the delivery path.

It exists because returning the bytes from the bound method threw "Maximum call
stack size exceeded" inside the Wails bridge -- before any front-end code ran,
which is why it survived being checked everywhere outside the webview. Nothing
here needs Helios: what is under test is the serving, and a few bytes stand in
for a stand as well as six million would.
*/
func TestMeshHandlerServesEveryHeldStand(t *testing.T) {
	app := NewApp()
	// The middleware wraps the asset server. This stands in for it: a request
	// that falls through must reach `next`, and reaching it here is observable
	// as the sentinel body rather than as a 404.
	const fellThrough = "<!doctype html>"
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fellThrough))
	})
	handler := app.meshMiddleware(next)

	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}

	// Nothing grown yet: there is no mesh to serve and no id that could be right.
	// It must still be answered here rather than falling through, or the SPA
	// hands back index.html and a loader reports "Unrecognized token '<'".
	first := get("/canopy-mesh/anything")
	if first.Code != http.StatusNotFound {
		t.Errorf("with no mesh held, got %d, want 404", first.Code)
	}
	if first.Body.String() == fellThrough {
		t.Error("a mesh path fell through to the assets, which answers with HTML")
	}

	hold := func(id, body string) {
		app.meshMu.Lock()
		if app.meshes == nil {
			app.meshes = make(map[string][]byte)
		}
		app.meshes[id] = []byte(body)
		app.meshOrder = append(app.meshOrder, id)
		for len(app.meshOrder) > maxHeldMeshes {
			delete(app.meshes, app.meshOrder[0])
			app.meshOrder = app.meshOrder[1:]
		}
		app.meshMu.Unlock()
	}

	hold("first", "glTF-pretend-one")

	res := get("/canopy-mesh/first")
	if res.Code != http.StatusOK {
		t.Fatalf("serving a held mesh got %d, want 200", res.Code)
	}
	if body := res.Body.String(); body != "glTF-pretend-one" {
		t.Errorf("served %q", body)
	}
	if ct := res.Header().Get("Content-Type"); ct != "model/gltf-binary" {
		t.Errorf("Content-Type is %q, which is what a loader dispatches on", ct)
	}

	/*
		Two canopy areas are a supported configuration and both grow on mount,
		so two builds are in flight at once and BOTH ids have to be fetchable.
		A single slot made the second build evict the first one's id, and the
		slower area's fetch 404ed with nothing it could do about it.
	*/
	hold("second", "glTF-pretend-two")

	if body := get("/canopy-mesh/first").Body.String(); body != "glTF-pretend-one" {
		t.Errorf("a concurrent build evicted an id still being fetched; got %q", body)
	}
	if body := get("/canopy-mesh/second").Body.String(); body != "glTF-pretend-two" {
		t.Errorf("the newer id served %q", body)
	}

	// Held meshes are megabytes each, so the set is bounded. Growing past the
	// bound retires the oldest, which by then has long been fetched.
	for i := 0; i < maxHeldMeshes; i++ {
		hold(fmt.Sprintf("later-%d", i), "glTF-pretend-later")
	}
	if got := get("/canopy-mesh/first").Code; got != http.StatusNotFound {
		t.Errorf("an aged-out id got %d, want 404", got)
	}
	app.meshMu.RLock()
	held := len(app.meshes)
	app.meshMu.RUnlock()
	if held > maxHeldMeshes {
		t.Errorf("holding %d meshes, over the %d bound", held, maxHeldMeshes)
	}

	// Anything off the prefix belongs to the assets and must reach them
	// untouched -- middleware sits in front of every request, not just its own.
	if body := get("/index.html").Body.String(); body != fellThrough {
		t.Errorf("a non-mesh path did not reach the asset server; got %q", body)
	}
}
