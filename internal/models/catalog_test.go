package models

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/png"
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
	c, err := ParseCatalog(catalogue(t, 1, good, newer, wrong, "not an entry"))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Models) != 1 || c.Models[0].Manifest.ID != "test-rf" || c.Unsupported != 3 {
		t.Fatalf("kept %d, left out %d; want 1 and 3", len(c.Models), c.Unsupported)
	}
}

func TestACatalogueOfANewerFormatIsRefused(t *testing.T) {
	if _, err := ParseCatalog(catalogue(t, 2)); err == nil || !strings.Contains(err.Error(), "format 2") {
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

func TestACatalogueEntryOfAnotherTaskAndAnUnknownFamilyIsLeftOut(t *testing.T) {
	_, good := publish(t)
	good.Sources = []analysis.ModelSource{{Name: "GitHub", URL: "https://example.org/pkg.zip"}}
	curve := good
	curve.Manifest.ID, curve.Manifest.Family, curve.Manifest.Task = "gp-interval", "gaussian_process", "time_series"
	curve.Manifest.Classes = nil
	curve.Manifest.Files = map[string]analysis.ModelFile{
		"parameters": {Name: "parameters.json", SHA256: strings.Repeat("1", 64), Size: 120},
	}
	curve.Digest = (&Package{Manifest: curve.Manifest}).Digest()
	c, err := ParseCatalog(catalogue(t, 1, curve, good))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Models) != 1 || c.Models[0].Manifest.ID != "test-rf" || c.Unsupported != 1 {
		t.Fatalf("kept %d, left out %d; want test-rf kept and the other left out", len(c.Models), c.Unsupported)
	}
}

// listed is a published entry that reads, with a source.
func listed(t *testing.T) analysis.CatalogEntry {
	t.Helper()
	_, e := publish(t)
	e.Sources = []analysis.ModelSource{{Name: "GitHub", URL: "https://example.org/pkg.zip"}}
	return e
}

// upcoming is a model in preparation as the catalogue lists it, with every
// field it requires.
func upcoming(id string) map[string]any {
	return map[string]any{
		"id": id, "name": "Interval " + id, "task": "time_series",
		"summary": "A series with its interval.",
		"status":  "Its parameters are being fitted again and are not yet evaluated.",
	}
}

// withUpcoming is a catalogue of format 1 with both lists.
func withUpcoming(t *testing.T, models []any, coming ...map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"format": 1, "models": models, "upcoming": coming})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pngURI(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func upcomingIDs(c analysis.ModelCatalog) []string {
	var ids []string
	for _, u := range c.Upcoming {
		ids = append(ids, u.ID)
	}
	return ids
}

func TestACatalogueListsItsModelsInPreparationBesideItsPackages(t *testing.T) {
	pictured := upcoming("gp-interval")
	pictured["reads"] = []map[string]string{{"label": "Series", "value": "NDVI"}}
	pictured["limits"] = []string{"Not evaluated on series TERRA reads."}
	pictured["picture"] = map[string]string{"subject": "a curve", "author": "TERRA", "license": "CC BY 4.0", "source": "https://example.org"}
	pictured["picture_uri"] = pngURI(t)
	c, err := ParseCatalog(withUpcoming(t, []any{listed(t)}, pictured, upcoming("cloud-score")))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Models) != 1 || c.Models[0].Manifest.ID != "test-rf" || c.Unsupported != 0 {
		t.Fatalf("packages: kept %d, left out %d; want test-rf alone", len(c.Models), c.Unsupported)
	}
	if got := strings.Join(upcomingIDs(c), " "); got != "gp-interval cloud-score" {
		t.Fatalf("upcoming %q, want both in the catalogue's order", got)
	}
	u := c.Upcoming[0]
	if len(u.Reads) != 1 || len(u.Limits) != 1 || u.Picture == nil || u.PictureURI == "" {
		t.Fatalf("got %+v, want what it reads, its limits and its picture", u)
	}
}

func TestACatalogueWithoutModelsInPreparationReadsAsBefore(t *testing.T) {
	c, err := ParseCatalog(catalogue(t, 1, listed(t)))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Upcoming) != 0 || len(c.Models) != 1 || c.Unsupported != 0 {
		t.Fatalf("got %d upcoming, %d packages, %d left out; want 0, 1, 0", len(c.Upcoming), len(c.Models), c.Unsupported)
	}
}

func TestAModelInPreparationThatDoesNotReadIsLeftOutAndNotCounted(t *testing.T) {
	without := func(field string) map[string]any {
		u := upcoming("no-" + field)
		u[field] = ""
		return u
	}
	with := func(id, field string, value any) map[string]any {
		u := upcoming(id)
		u[field] = value
		return u
	}
	notPNG := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not an image"))
	bad := []map[string]any{
		without("name"), without("task"), without("summary"), without("status"),
		with("Bad_Id", "id", "Bad_Id"),
		with("unknown-task", "task", "flood_extent"),
		with("gif", "picture_uri", "data:image/gif;base64,R0lGODlhAQABAAAAACw="),
		with("address", "picture_uri", "https://example.org/picture.png"),
		with("not-base64", "picture_uri", "data:image/png;base64,***"),
		with("not-png", "picture_uri", notPNG),
		with("too-large", "picture_uri", "data:image/png;base64,"+strings.Repeat("A", maxPictureURI)),
	}
	c, err := ParseCatalog(withUpcoming(t, []any{listed(t)}, append(bad, upcoming("gp-interval"))...))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(upcomingIDs(c), " "); got != "gp-interval" {
		t.Fatalf("upcoming %q, want gp-interval alone", got)
	}
	if len(c.Models) != 1 || c.Unsupported != 0 {
		t.Fatalf("packages: kept %d, left out %d; want 1 and 0", len(c.Models), c.Unsupported)
	}
}

func TestAModelInPreparationWithAPublishedIdIsLeftOut(t *testing.T) {
	good := listed(t)
	// Published in a form this version cannot read: still published.
	newer := listed(t)
	newer.Manifest.ID, newer.Manifest.Family = "test-diffusion", "diffusion"
	c, err := ParseCatalog(withUpcoming(t, []any{good, newer},
		upcoming("test-rf"), upcoming("test-diffusion"), upcoming("gp-interval"), upcoming("gp-interval")))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(upcomingIDs(c), " "); got != "gp-interval" {
		t.Fatalf("upcoming %q, want gp-interval once", got)
	}
	if len(c.Models) != 1 || c.Models[0].Manifest.ID != "test-rf" || c.Unsupported != 1 {
		t.Fatalf("packages: kept %d, left out %d; want test-rf kept", len(c.Models), c.Unsupported)
	}
}
