package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"geosense-infer/internal/analysis"
)

// publish packs a package into a zip and returns the zip's bytes and the
// catalogue entry that describes it truly, with no source yet.
func publish(t *testing.T) ([]byte, analysis.CatalogEntry) {
	t.Helper()
	dir := t.TempDir()
	m := writePackage(t, dir, "1.0.0")
	raw, err := os.ReadFile(zipDir(t, dir, ""))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	return raw, analysis.CatalogEntry{
		Manifest: m,
		Digest:   (&Package{Manifest: m}).Digest(),
		Package:  analysis.ModelFile{Name: "test-rf-1.0.0.zip", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))},
	}
}

func serve(t *testing.T, routes map[string][]byte) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := routes[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(s.Close)
	return s
}

func remote() Remote {
	return Remote{Client: &http.Client{}, UserAgent: "TERRA test"}
}

func installed(t *testing.T, root string) []*Package {
	t.Helper()
	pkgs, errs := List(root)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	return pkgs
}

func TestADownloadComesFromTheFirstSourceThatHasTheFile(t *testing.T) {
	zip, e := publish(t)
	s := serve(t, map[string][]byte{"/mirror/pkg.zip": zip})
	e.Sources = []analysis.ModelSource{
		{Name: "GitHub", URL: s.URL + "/release/pkg.zip"},
		{Name: "Zenodo", URL: s.URL + "/mirror/pkg.zip"},
	}
	root := t.TempDir()
	var last analysis.ModelDownload
	p, err := remote().Download(context.Background(), root, e, func(source string, received, total int64) {
		last = analysis.ModelDownload{Source: source, Received: received, Total: total}
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Digest() != e.Digest {
		t.Fatalf("installed digest %s, catalogue %s", p.Digest(), e.Digest)
	}
	if last.Source != "Zenodo" || last.Received != e.Package.Size || last.Total != e.Package.Size {
		t.Fatalf("last progress %+v, want all of %d bytes from Zenodo", last, e.Package.Size)
	}
	if got := installed(t, root); len(got) != 1 {
		t.Fatalf("%d packages installed, want 1", len(got))
	}
	leftovers, _ := filepath.Glob(filepath.Join(root, ".download-*"))
	if len(leftovers) > 0 {
		t.Fatalf("the download left %v behind", leftovers)
	}
}

func TestAFileOtherThanTheOnePinnedIsNeverUnpacked(t *testing.T) {
	zip, e := publish(t)
	other := append([]byte(nil), zip...)
	other[len(other)/2] ^= 0xff
	s := serve(t, map[string][]byte{"/pkg.zip": other})
	e.Sources = []analysis.ModelSource{{Name: "GitHub", URL: s.URL + "/pkg.zip"}}
	root := t.TempDir()
	_, err := remote().Download(context.Background(), root, e, nil)
	if err == nil || !strings.Contains(err.Error(), "not the one the catalogue lists") {
		t.Fatalf("got %v, want the file refused", err)
	}
	if got := installed(t, root); len(got) != 0 {
		t.Fatalf("%d packages installed from a file the catalogue does not pin", len(got))
	}
}

func TestEverySourceThatFailedIsNamed(t *testing.T) {
	_, e := publish(t)
	s := serve(t, nil)
	e.Sources = []analysis.ModelSource{
		{Name: "GitHub", URL: s.URL + "/a.zip"},
		{Name: "Zenodo", URL: s.URL + "/b.zip"},
	}
	_, err := remote().Download(context.Background(), t.TempDir(), e, nil)
	if err == nil || !strings.Contains(err.Error(), "GitHub:") || !strings.Contains(err.Error(), "Zenodo:") ||
		!strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("got %v, want both sources named with their answer", err)
	}
}

func TestAPackageOtherThanTheEntryDescribesIsNotInstalled(t *testing.T) {
	zip, e := publish(t)
	s := serve(t, map[string][]byte{"/pkg.zip": zip})
	e.Sources = []analysis.ModelSource{{Name: "GitHub", URL: s.URL + "/pkg.zip"}}
	e.Manifest.Version = "2.0.0" // The zip holds 1.0.0.
	root := t.TempDir()
	_, err := remote().Download(context.Background(), root, e, nil)
	if err == nil || !strings.Contains(err.Error(), "the catalogue is wrong") {
		t.Fatalf("got %v, want the mismatch refused", err)
	}
	if got := installed(t, root); len(got) != 0 {
		t.Fatalf("%d packages installed that the entry does not describe", len(got))
	}
}

func TestACancelledDownloadStops(t *testing.T) {
	_, e := publish(t)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000000")
		_, _ = w.Write([]byte("partial"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer s.Close()
	e.Sources = []analysis.ModelSource{{Name: "GitHub", URL: s.URL + "/pkg.zip"}}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, err := remote().Download(ctx, t.TempDir(), e, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v, want the context's error", err)
	}
}

func catalogue(t *testing.T, format int, entries ...any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"format": format, "models": entries})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestACatalogueKeepsTheEntriesThisVersionCanRun(t *testing.T) {
	_, good := publish(t)
	good.Sources = []analysis.ModelSource{{Name: "GitHub", URL: "https://example.org/pkg.zip"}}
	newer := good
	newer.Manifest.Family = "diffusion"
	wrong := good
	wrong.Digest = strings.Repeat("0", 64)
	entries, unsupported, err := ParseCatalog(catalogue(t, 1, good, newer, wrong, "not an entry"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Manifest.ID != "test-rf" || unsupported != 3 {
		t.Fatalf("kept %d, left out %d; want 1 and 3", len(entries), unsupported)
	}
}

func TestACatalogueOfANewerFormatIsRefused(t *testing.T) {
	if _, _, err := ParseCatalog(catalogue(t, 2)); err == nil || !strings.Contains(err.Error(), "format 2") {
		t.Fatalf("got %v, want the format named", err)
	}
}

func TestACatalogueThatCannotBeReachedSaysWhy(t *testing.T) {
	s := serve(t, nil)
	_, err := remote().Catalog(context.Background(), s.URL+"/model/catalog.json")
	if err == nil || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("got %v, want the answer named", err)
	}
}
