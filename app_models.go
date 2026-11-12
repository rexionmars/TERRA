package main

import (
	"errors"
	"path/filepath"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/models"
)

// The model packages a run can use: installed by the reader, under the data
// directory. internal/models says why nothing is shipped with the application.

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
