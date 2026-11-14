package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/models"
)

// The model packages a run can use: installed by the reader, under the data
// directory, from the published catalogue or from a package of their own.
// internal/models says why nothing is shipped with the application, and
// internal/models/catalog.go how a download is checked.

/*
catalogURL is the published catalogue: catalog.json in the models repository,
which also holds each package as a release asset. A model is published there
without a commit to this repository or a new TERRA. TERRA_MODEL_CATALOG names
another address, for a mirror or a test.
*/
const catalogURL = "https://raw.githubusercontent.com/rexionmars/TERRA-models/master/catalog.json"

// catalogWait bounds the wait for the published catalogue. Past it the
// screen shows the copy this build carries rather than nothing.
const catalogWait = 15 * time.Second

// builtinCatalog is the catalogue as it stood when this build was made, shown
// when the published one cannot be read.
//
//go:embed model/catalog.json
var builtinCatalog []byte

/*
modelState is what the Models screen has read and started: the catalogue last
read, so that an install names an entry of it rather than handing over an
address, and the downloads under way, by model id, so that one can be
cancelled. Bound methods run on their own goroutines, hence the lock.
*/
type modelState struct {
	mu        sync.Mutex
	catalog   []analysis.CatalogEntry
	downloads map[string]context.CancelFunc
}

func (a *App) remote() models.Remote {
	return models.Remote{
		// No overall timeout: a package is tens of megabytes on a slow line.
		// A download ends when it is cancelled or its connection fails.
		Client:    &http.Client{},
		UserAgent: "TERRA/" + a.GetAppVersion() + " (+https://github.com/rexionmars/TERRA)",
	}
}

func (a *App) parentContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

// modelsDir is where installed packages live, beside the store, so they
// survive updates of the application. Empty before the store is open.
func (a *App) modelsDir() string {
	d := a.dataDir()
	if d == "" {
		return ""
	}
	return filepath.Join(d, "models")
}

// ListModels returns the installed packages, newest version first within an id.
// A damaged package is left out rather than failing the list.
func (a *App) ListModels() ([]analysis.ModelInfo, error) {
	root := a.modelsDir()
	if root == "" {
		return nil, errors.New("the local store is not open")
	}
	pkgs, _ := models.List(root)
	out := make([]analysis.ModelInfo, 0, len(pkgs))
	for _, p := range pkgs {
		out = append(out, p.Info())
	}
	return out, nil
}

// PickModelPackage asks for a package's zip and returns its path, empty when
// the reader cancels.
func (a *App) PickModelPackage() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose a model package",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Model package (*.zip)", Pattern: "*.zip"},
		},
	})
}

/*
ImportModel installs the package at path, a zip or a directory.

The files are checked against the digests in its manifest before it appears
installed, and again by the sidecar before every run. That pins a package to
what it was when it was installed; it says nothing of who made it. A package
from outside the published catalogue runs with the reader's trust, which the
Models screen states before it is chosen.
*/
func (a *App) ImportModel(path string) (*analysis.ModelInfo, error) {
	root := a.modelsDir()
	if root == "" {
		return nil, errors.New("the local store is not open")
	}
	p, err := models.Import(root, path)
	if err != nil {
		return nil, err
	}
	info := p.Info()
	return &info, nil
}

// RemoveModel uninstalls one version of a model. Saved runs keep what they
// recorded about it; only running it again needs it installed.
func (a *App) RemoveModel(id, version string) error {
	root := a.modelsDir()
	if root == "" {
		return errors.New("the local store is not open")
	}
	return models.Remove(root, id, version)
}

/*
ModelCatalog reads the published catalogue: the models a reader can download,
and the models in preparation, which the screen describes and cannot install.

When it cannot be read -- no connection, or a catalogue too new for this
version -- the copy this build carries is returned instead, with the reason, so
the screen still says what exists. Nothing can be downloaded without a
connection either way.
*/
func (a *App) ModelCatalog() (analysis.ModelCatalog, error) {
	address := catalogURL
	if s := os.Getenv("TERRA_MODEL_CATALOG"); s != "" {
		address = s
	}
	ctx, cancel := context.WithTimeout(a.parentContext(), catalogWait)
	defer cancel()

	var out analysis.ModelCatalog
	raw, err := a.remote().Catalog(ctx, address)
	if err == nil {
		out, err = models.ParseCatalog(raw)
		out.Origin = "online"
	}
	if err != nil {
		var berr error
		out, berr = models.ParseCatalog(builtinCatalog)
		if berr != nil {
			return analysis.ModelCatalog{}, fmt.Errorf("the catalogue this build carries cannot be read: %w", berr)
		}
		out.Origin, out.Problem = "built-in", err.Error()
	}
	// Only the packages: a model in preparation has nothing to download, so an
	// install that names one is refused as a model the catalogue does not list.
	a.models.mu.Lock()
	a.models.catalog = out.Models
	a.models.mu.Unlock()
	return out, nil
}

/*
InstallCatalogModel downloads one version of a model from the catalogue last
read and installs it, reporting progress through the "models:download" event.

The zip is checked against the SHA-256 the catalogue pins before anything is
unpacked, and the package in it against the entry's digest before it appears
installed. It returns when the package is installed, or with the reason it was
not; CancelModelDownload ends it early.
*/
func (a *App) InstallCatalogModel(id, version string) (*analysis.ModelInfo, error) {
	root := a.modelsDir()
	if root == "" {
		return nil, errors.New("the local store is not open")
	}
	s := &a.models
	s.mu.Lock()
	var entry *analysis.CatalogEntry
	for i := range s.catalog {
		if s.catalog[i].Manifest.ID == id && s.catalog[i].Manifest.Version == version {
			e := s.catalog[i]
			entry = &e
		}
	}
	if entry == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("%s %s is not in the catalogue that was read", id, version)
	}
	if _, busy := s.downloads[id]; busy {
		s.mu.Unlock()
		return nil, fmt.Errorf("%s is already being downloaded", id)
	}
	if s.downloads == nil {
		s.downloads = map[string]context.CancelFunc{}
	}
	ctx, cancel := context.WithCancel(a.parentContext())
	s.downloads[id] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.downloads, id)
		s.mu.Unlock()
		cancel()
	}()

	report := func(source string, received, total int64) {
		if a.ctx != nil {
			wruntime.EventsEmit(a.ctx, "models:download", analysis.ModelDownload{
				ID: id, Version: version, Source: source, Received: received, Total: total,
			})
		}
	}
	p, err := a.remote().Download(ctx, root, *entry, report)
	if errors.Is(err, context.Canceled) {
		return nil, errors.New("the download was cancelled")
	}
	if err != nil {
		return nil, err
	}
	info := p.Info()
	return &info, nil
}

// CancelModelDownload stops the download of id, if one is under way. Nothing
// of it is left installed.
func (a *App) CancelModelDownload(id string) {
	a.models.mu.Lock()
	defer a.models.mu.Unlock()
	if cancel, ok := a.models.downloads[id]; ok {
		cancel()
	}
}
