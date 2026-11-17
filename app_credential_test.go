package main

import (
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/credential"
	"geosense-infer/internal/pyenv"

	"github.com/zalando/go-keyring"
)

// A token an earlier version kept in the settings file moves to the
// credential store, and leaves the file once the store has it.
func TestATokenInTheSettingsFileMovesToTheCredentialStore(t *testing.T) {
	keyring.MockInit()
	t.Setenv(analysis.EarthdataTokenEnv, "")
	dir := t.TempDir()
	if err := pyenv.SaveAppConfig(dir, pyenv.AppConfig{EarthdataToken: "from-file"}); err != nil {
		t.Fatal(err)
	}

	migrateEarthdataToken(dir)

	cfg := pyenv.LoadAppConfig(dir)
	if cfg.EarthdataToken != "" {
		t.Fatalf("the file still holds %q", cfg.EarthdataToken)
	}
	if got := earthdataToken(cfg); got != "from-file" {
		t.Fatalf("the run would be handed %q", got)
	}
	if s := earthdataStatus(cfg); s.Store != credential.StoreName() {
		t.Fatalf("status says the token is in %q", s.Store)
	}
}

// Where the platform has no store, the token stays in the file and is read
// from there, and the status says so.
func TestWithNoCredentialStoreTheTokenStaysInTheFile(t *testing.T) {
	keyring.MockInitWithError(keyring.ErrUnsupportedPlatform)
	t.Cleanup(keyring.MockInit)
	t.Setenv(analysis.EarthdataTokenEnv, "")
	dir := t.TempDir()
	if err := pyenv.SaveAppConfig(dir, pyenv.AppConfig{EarthdataToken: "from-file"}); err != nil {
		t.Fatal(err)
	}

	migrateEarthdataToken(dir)

	cfg := pyenv.LoadAppConfig(dir)
	if cfg.EarthdataToken != "from-file" {
		t.Fatalf("the token left the file for a store that failed: %q", cfg.EarthdataToken)
	}
	if got := earthdataToken(cfg); got != "from-file" {
		t.Fatalf("the run would be handed %q", got)
	}
	if s := earthdataStatus(cfg); s.Store != "the settings file" {
		t.Fatalf("status says the token is in %q", s.Store)
	}
}
