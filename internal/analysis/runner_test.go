package analysis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// repoRoot walks up from this file to the directory holding go.mod.
//
// It counted two levels of filepath.Dir before, which was right while these
// tests lived in backend/ and silently wrong the moment they moved one deeper:
// the runner then resolved its appDir to internal/, looked for
// internal/sidecar/infer.py, and reported the sidecar as missing. Anchoring on
// go.mod costs a few Stat calls and does not care where the test file sits.
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	dir := filepath.Dir(file)
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("no go.mod above %s", filepath.Dir(file))
		}
		dir = parent
	}
}

// The paths a runner resolves from its environment.
//
// It also asserted the three embedded areas -- that ListAreas found A, B and C,
// that each carried a closed polygon and sane bounds, and that loadArea refused
// an id that was not one of them. Those areas are gone: a run is over the
// polygon it was given, and offering a second way to name a ground was one of
// the duplications this change removes. What is left here is what the runner
// still resolves.
func TestNewRunnerResolvesItsPaths(t *testing.T) {
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_MODEL_DIR", "")
	t.Setenv("TERRA_PYTHON", "python3")
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if r.ModelDir() != filepath.Join(root, "model") {
		t.Fatalf("ModelDir=%s want %s", r.ModelDir(), filepath.Join(root, "model"))
	}
	if r.PythonPath() != "python3" {
		t.Fatalf("PythonPath=%s want python3", r.PythonPath())
	}
}

func TestPngToDataURI(t *testing.T) {
	// 1x1 transparent PNG
	raw, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "pixel.png")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	uri, err := pngToDataURI(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("unexpected URI prefix: %s", uri[:min(40, len(uri))])
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(uri, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != len(raw) {
		t.Fatalf("decoded len=%d want %d", len(decoded), len(raw))
	}
}

func TestNewRunnerPrefersBundledPython(t *testing.T) {
	root := t.TempDir()
	// Minimal sidecar tree
	sid := filepath.Join(root, "sidecar")
	if err := os.MkdirAll(sid, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sid, "infer.py"), []byte("# test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "python", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	bundled := filepath.Join(bin, "python3")
	if err := os.WriteFile(bundled, []byte("#!/bin/sh\necho fake\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", "")
	t.Setenv("TERRA_MODEL_DIR", filepath.Join(root, "model"))
	_ = os.MkdirAll(filepath.Join(root, "model"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "model", "rf_classifier.joblib"), []byte("x"), 0o644)

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if r.PythonPath() != bundled {
		t.Fatalf("PythonPath=%s want bundled %s", r.PythonPath(), bundled)
	}
}

func TestResolveAppDirResourcesLayout(t *testing.T) {
	// Simulate macOS Resources layout without needing a real executable.
	root := t.TempDir()
	res := filepath.Join(root, "Contents", "Resources")
	if err := os.MkdirAll(filepath.Join(res, "sidecar"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(res, "sidecar", "infer.py"), []byte("#\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TERRA_APP_DIR", res)
	t.Setenv("TERRA_PYTHON", "python3")
	r, err := NewRunner("/nonexistent", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(r.sidecar, filepath.Join("Resources", "sidecar", "infer.py")) {
		t.Fatalf("sidecar=%s", r.sidecar)
	}
}
