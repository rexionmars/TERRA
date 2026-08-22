package pyenv

import (
	"os"
	"testing"
)

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
