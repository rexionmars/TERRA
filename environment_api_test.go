package main

import (
	"os"
	"path/filepath"
	"testing"

	"geosense-infer/internal/analysis"
)

// byLabel indexes the reported paths, since the screen identifies them by label
// rather than by position.
func byLabel(paths []ResolvedPath) map[string]ResolvedPath {
	out := map[string]ResolvedPath{}
	for _, p := range paths {
		out[p.Label] = p
	}
	return out
}

// TestResolvedPathsReportsMissingPaths covers the case the section exists for:
// a path that resolved to somewhere that is not there.
//
// Every one of these resolves to something whether or not it exists -- the
// model directory falls back to a legacy training path absent from every
// release -- so without this flag a missing directory looks exactly like a
// present one until an analysis dies on it.
func TestResolvedPathsReportsMissingPaths(t *testing.T) {
	dataDir := t.TempDir()

	// An app directory with a sidecar, so NewRunner resolves against it, but no
	// model/ inside it -- which sends modelDir to the legacy fallback path.
	appDir := t.TempDir()
	if err := writeStubSidecar(t, appDir); err != nil {
		t.Fatal(err)
	}

	runner, err := analysis.NewRunner(appDir, "")
	if err != nil {
		t.Fatal(err)
	}

	paths := byLabel(resolvedPaths(runner, dataDir))

	sidecar, ok := paths["Sidecar"]
	if !ok {
		t.Fatal("the sidecar path was not reported")
	}
	if !sidecar.Exists {
		t.Errorf("the sidecar exists at %s but was reported missing", sidecar.Path)
	}

	model, ok := paths["Model"]
	if !ok {
		t.Fatal("the model path was not reported")
	}
	if model.Exists {
		t.Errorf("no model directory was created, yet %s was reported as present",
			model.Path)
	}
	if model.Blocks == "" {
		t.Error("a missing model directory should say what it stops working")
	}

	data, ok := paths["Data directory"]
	if !ok {
		t.Fatal("the data directory was not reported")
	}
	if data.Path != dataDir || !data.Exists {
		t.Errorf("data directory reported as %q (exists=%v), want %q present",
			data.Path, data.Exists, dataDir)
	}
}

// TestResolvedPathsNamesTheDecidingVariable checks that a path chosen by an
// environment variable says which one.
//
// This is the whole reason the section shows a source at all: a
// TERRA_MODEL_DIR exported once in a shell profile keeps selecting a model
// directory on every launch from that terminal, and it is the last thing anyone
// suspects when a classification looks wrong.
func TestResolvedPathsNamesTheDecidingVariable(t *testing.T) {
	appDir := t.TempDir()
	if err := writeStubSidecar(t, appDir); err != nil {
		t.Fatal(err)
	}
	elsewhere := t.TempDir()
	t.Setenv("TERRA_MODEL_DIR", elsewhere)

	runner, err := analysis.NewRunner(appDir, "")
	if err != nil {
		t.Fatal(err)
	}
	paths := byLabel(resolvedPaths(runner, t.TempDir()))

	model := paths["Model"]
	if model.Path != elsewhere {
		t.Errorf("model path is %q, want the value of TERRA_MODEL_DIR %q",
			model.Path, elsewhere)
	}
	if model.Source != "TERRA_MODEL_DIR" {
		t.Errorf("model source is %q, want it to name TERRA_MODEL_DIR",
			model.Source)
	}

	// Unset variables must not be named, or every row would claim to be
	// overridden and the label would stop meaning anything.
	if got := paths["Repository root"].Source; got != "" {
		t.Errorf("TERRA_ROOT is unset, but the repository root claims %q", got)
	}
}

// TestResolvedPathsWithoutRunner checks the listing survives a runner that
// failed to build -- which is when someone is most likely to be reading it.
func TestResolvedPathsWithoutRunner(t *testing.T) {
	dataDir := t.TempDir()
	paths := resolvedPaths(nil, dataDir)
	if len(paths) == 0 {
		t.Fatal("no paths reported without a runner; the data directory is " +
			"known regardless and is the one place a user can look")
	}
	if paths[0].Path != dataDir {
		t.Errorf("first path is %q, want the data directory %q",
			paths[0].Path, dataDir)
	}
}

func writeStubSidecar(t *testing.T, appDir string) error {
	t.Helper()
	dir := filepath.Join(appDir, "sidecar")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "infer.py"), []byte("# stub\n"), 0o600)
}
