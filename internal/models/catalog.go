package models

/*
The published catalogue: the packages a reader can install without having one
in hand.

It is a JSON file in the TERRA repository, model/catalog.json, written by
scripts/package_models.py from the same files it packs. Each entry carries the
package's manifest, so a model is described in full before it is downloaded,
and the SHA-256 and size of its zip, so what arrives is checked against what
was published before any of it is unpacked. The zip itself is published
elsewhere, on a GitHub release and on Zenodo, and the entry lists those sources
in the order they are tried.

The catalogue is what vouches for a download. A package from it is installed
without the warning an imported one gets, because its digests were fixed by
whoever published it, in the repository the application is built from.
*/

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"geosense-infer/internal/analysis"
)

const (
	catalogFormat = 1
	// maxCatalog bounds what is read of a catalogue: each entry inlines a
	// picture of a few tens of kilobytes, and a few hundred entries fit.
	maxCatalog = 16 << 20
	// progressEvery is how often a download reports, so the interface is told
	// often enough to move a bar and not so often that it is flooded.
	progressEvery = 100 * time.Millisecond
)

// The file's shape. Entries are read one at a time, so one the application
// cannot read leaves the others listed.
type catalogFile struct {
	Format int               `json:"format"`
	Models []json.RawMessage `json:"models"`
}

/*
ParseCatalog reads a catalogue, keeping the entries this version can install.

An entry that does not read -- a family the sidecar does not know, a newer
manifest format, a digest that disagrees with its own files -- is counted in
unsupported and left out, rather than offered and refused after the download.
A catalogue of a newer format is refused whole.
*/
func ParseCatalog(raw []byte) (entries []analysis.CatalogEntry, unsupported int, err error) {
	var f catalogFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, 0, fmt.Errorf("the catalogue is not valid JSON: %w", err)
	}
	if f.Format != catalogFormat {
		return nil, 0, fmt.Errorf("the catalogue is format %d, and this version of TERRA reads %d", f.Format, catalogFormat)
	}
	for _, r := range f.Models {
		var e analysis.CatalogEntry
		if json.Unmarshal(r, &e) != nil || checkEntry(e) != nil {
			unsupported++
			continue
		}
		entries = append(entries, e)
	}
	return entries, unsupported, nil
}

func checkEntry(e analysis.CatalogEntry) error {
	if err := check(e.Manifest); err != nil {
		return err
	}
	if d := (&Package{Manifest: e.Manifest}).Digest(); d != e.Digest {
		return fmt.Errorf("model %s: the catalogue's digest is not its files'", e.Manifest.ID)
	}
	z := e.Package
	if z.Name == "" || filepath.Base(z.Name) != z.Name || !strings.HasSuffix(z.Name, ".zip") {
		return fmt.Errorf("model %s: the package has no plain zip name", e.Manifest.ID)
	}
	if !shaPattern.MatchString(z.SHA256) || z.Size <= 0 || z.Size > maxPackage {
		return fmt.Errorf("model %s: the package has no SHA-256 or size", e.Manifest.ID)
	}
	if len(e.Sources) == 0 {
		return fmt.Errorf("model %s has no source", e.Manifest.ID)
	}
	for _, s := range e.Sources {
		// Plain HTTP is allowed: the zip is checked against the SHA-256 the
		// catalogue pins, so the transport is not what makes it trustworthy.
		u, err := url.Parse(s.URL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return fmt.Errorf("model %s: %q is not a download address", e.Manifest.ID, s.URL)
		}
	}
	return nil
}

// Remote reads the catalogue and downloads packages over HTTP.
type Remote struct {
	Client    *http.Client
	UserAgent string
}

func (r Remote) get(ctx context.Context, address string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", r.UserAgent)
	resp, err := r.Client.Do(req)
	if err != nil {
		return nil, plain(err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close() // Nothing was read from it; a failed close loses nothing.
		return nil, fmt.Errorf("%s answered HTTP %d", resp.Request.URL.Host, resp.StatusCode)
	}
	return resp, nil
}

// Catalog reads the catalogue at address.
func (r Remote) Catalog(ctx context.Context, address string) ([]byte, error) {
	resp, err := r.get(ctx, address)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalog+1))
	if err != nil {
		return nil, plain(err)
	}
	if len(raw) > maxCatalog {
		return nil, fmt.Errorf("the catalogue is larger than %d MB", maxCatalog>>20)
	}
	return raw, nil
}

// Progress is told how much of a package has arrived, and from which source.
type Progress func(source string, received, total int64)

/*
Download fetches the entry's zip from its sources in turn and installs it under
root.

A source whose file is not the one the catalogue pins, by size or by SHA-256,
is passed over like one that cannot be reached, and nothing is unpacked from
it. The package the zip holds must then be the one the entry describes, down
to its digest, or it is refused before it appears installed.
*/
func (r Remote) Download(ctx context.Context, root string, e analysis.CatalogEntry, progress Progress) (*Package, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(root, ".download-*.zip")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()

	var failed []string
	got := false
	for _, s := range e.Sources {
		err := r.fetch(ctx, tmp, s, e.Package, progress)
		if ctx.Err() != nil {
			_ = tmp.Close()
			return nil, ctx.Err()
		}
		if err == nil {
			got = true
			break
		}
		failed = append(failed, s.Name+": "+err.Error())
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	if !got {
		return nil, fmt.Errorf("%s %s could not be downloaded. %s",
			e.Manifest.ID, e.Manifest.Version, strings.Join(failed, "; "))
	}
	return install(root, tmp.Name(), func(p *Package) error {
		if p.Manifest.ID != e.Manifest.ID || p.Manifest.Version != e.Manifest.Version || p.Digest() != e.Digest {
			return fmt.Errorf("the package published as %s %s holds %s %s with other files; the catalogue is wrong, and nothing was installed",
				e.Manifest.ID, e.Manifest.Version, p.Manifest.ID, p.Manifest.Version)
		}
		return nil
	})
}

// fetch writes one source's file over f and checks it against want.
func (r Remote) fetch(ctx context.Context, f *os.File, s analysis.ModelSource, want analysis.ModelFile, progress Progress) error {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err := f.Truncate(0); err != nil {
		return err
	}
	resp, err := r.get(ctx, s.URL)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	h := sha256.New()
	tick := &ticker{source: s.Name, total: want.Size, report: progress}
	// One byte past the size the catalogue states is enough to know the file
	// is not the one it lists, without reading the rest of it.
	n, err := io.Copy(io.MultiWriter(f, h, tick), io.LimitReader(resp.Body, want.Size+1))
	if err != nil {
		return plain(err)
	}
	tick.flush()
	if n != want.Size || hex.EncodeToString(h.Sum(nil)) != want.SHA256 {
		return errors.New("the file there is not the one the catalogue lists")
	}
	return nil
}

// ticker counts the bytes written through it and reports them at most every
// progressEvery.
type ticker struct {
	source   string
	total    int64
	received int64
	last     time.Time
	report   Progress
}

func (t *ticker) Write(p []byte) (int, error) {
	t.received += int64(len(p))
	if t.report != nil && time.Since(t.last) >= progressEvery {
		t.last = time.Now()
		t.report(t.source, t.received, t.total)
	}
	return len(p), nil
}

func (t *ticker) flush() {
	if t.report != nil {
		t.report(t.source, t.received, t.total)
	}
}

// plain turns a transport error into a sentence the reader can act on; the
// address is left out, because the error is shown beside the source's name.
func plain(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return fmt.Errorf("%s could not be found; check the connection", dns.Name)
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		if ue.Timeout() {
			return errors.New("no answer in time")
		}
		return ue.Err
	}
	return err
}
