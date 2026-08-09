package backend

import (
	"os"
	"path/filepath"
	"testing"
)

// TestConfiguredPythonBeatsTheHeuristics is the whole point of the file.
//
// The chain below the saved choice is a series of guesses, and its last step
// always answers: any machine has some `python3` on PATH. So a user who picked
// an interpreter has to win over every guess, or their choice would silently
// lose to one and they would have no way to tell.
func TestConfiguredPythonBeatsTheHeuristics(t *testing.T) {
	t.Setenv("GEOSENSE_PYTHON", "")
	root := t.TempDir()

	// A bundled interpreter, which outranks everything except a saved choice.
	bundled := filepath.Join(root, "app", "python", "bin")
	if err := os.MkdirAll(bundled, 0o755); err != nil {
		t.Fatal(err)
	}
	bundledPy := filepath.Join(bundled, "python3")
	if err := os.WriteFile(bundledPy, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}

	chosen := filepath.Join(root, "chosen-python")
	if err := os.WriteFile(chosen, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}

	appDir := filepath.Join(root, "app")
	if got := resolvePython(appDir, root, chosen); got != chosen {
		t.Fatalf("resolvePython=%q, want the saved choice %q", got, chosen)
	}
	// And with nothing saved, the bundled one is used.
	if got := resolvePython(appDir, root, ""); got != bundledPy {
		t.Fatalf("resolvePython=%q, want the bundled %q", got, bundledPy)
	}
}

// TestConfiguredPythonIsIgnoredWhenItIsGone keeps a stale setting from bricking
// the application. An interpreter can be uninstalled, or a venv deleted, long
// after it was chosen; falling back to the heuristics gets the user to a
// working screen where they can choose again.
func TestConfiguredPythonIsIgnoredWhenItIsGone(t *testing.T) {
	t.Setenv("GEOSENSE_PYTHON", "")
	root := t.TempDir()
	got := resolvePython(root, root, filepath.Join(root, "deleted-python"))
	if got == filepath.Join(root, "deleted-python") {
		t.Fatal("a path that no longer exists was returned as the interpreter")
	}
}

// TestEnvironmentVariableStillWins protects the developer override. Someone
// switching interpreters per run should not have to edit a file the UI also
// writes, and should not find their export quietly ignored.
func TestEnvironmentVariableStillWins(t *testing.T) {
	t.Setenv("GEOSENSE_PYTHON", "/from/env/python")
	root := t.TempDir()
	if got := resolvePython(root, root, "/from/config/python"); got != "/from/env/python" {
		t.Fatalf("resolvePython=%q, want the environment variable", got)
	}
}

// TestAppConfigRoundTripsAndSurvivesGarbage covers the two states a settings
// file is ever in.
//
// A malformed file must read as absent rather than fatal: a setting the
// application wrote should never be able to stop it from opening, because the
// screen that would let the user fix it is inside the application.
func TestAppConfigRoundTripsAndSurvivesGarbage(t *testing.T) {
	dir := t.TempDir()

	if got := LoadAppConfig(dir); got.PythonPath != "" {
		t.Fatalf("a directory with no config returned %+v", got)
	}

	want := AppConfig{PythonPath: "/some/python", Managed: true}
	if err := SaveAppConfig(dir, want); err != nil {
		t.Fatal(err)
	}
	if got := LoadAppConfig(dir); got != want {
		t.Fatalf("round trip gave %+v, want %+v", got, want)
	}

	if err := os.WriteFile(ConfigPath(dir), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := LoadAppConfig(dir); got.PythonPath != "" {
		t.Fatalf("garbage parsed as %+v; it must read as no configuration", got)
	}

	// Nothing partial is left behind for the next start to read.
	if _, err := os.Stat(ConfigPath(dir) + ".partial"); !os.IsNotExist(err) {
		t.Fatal("a .partial file survived the write")
	}
}
