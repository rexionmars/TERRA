package pyenv

import (
	"encoding/json"
	"os"
	"path/filepath"
)

/*
AppConfig is the installation's own settings, kept beside its database.

NOT in the preferences table, deliberately. Which interpreter to run is a
property of THIS INSTALLATION, not of the person signed in: the application has
accounts and a local guest, and the Python that works does not change when
someone else logs in.

NOT an environment variable either, which is the point. TERRA_PYTHON only
reaches a process launched from a shell that exported it -- and a desktop
application opened from Finder or the Start menu inherits the session
environment, not a shell profile. So the one setting a LITE user most needs was
the one they could not set in the way they actually open the app. A file the
application reads at startup works however it was launched.

The variable still wins when it is set, because a developer switching
interpreters per run should not have to edit a file the UI also writes.
*/
type AppConfig struct {
	// Interpreter chosen in the UI. Empty means "resolve as before".
	PythonPath string `json:"python_path,omitempty"`
	// Set when the interpreter above is an environment this application
	// created, so it knows which one it may rebuild without asking.
	Managed bool `json:"managed,omitempty"`
	// Connection to the local PostGIS the grid analyses read, in libpq form.
	// Empty means the sidecar's own default, which is a peer-authenticated
	// `terra_br` on this machine.
	//
	// Here for the same reason PythonPath is: which database holds the
	// operational record is a property of THIS INSTALLATION, not of the person
	// signed in, and TERRA_BR_DSN does not reach an application opened from
	// Finder. The variable still wins when it is set.
	GridDSN string `json:"grid_dsn,omitempty"`
}

// ConfigPath is the settings file for this installation.
func ConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "config.json")
}

// LoadAppConfig reads the settings, returning an empty config when there are
// none. A malformed file is treated as absent rather than fatal: a setting the
// application wrote should never be able to stop it from opening, and the UI
// that wrote it is also the place to write it again.
func LoadAppConfig(dataDir string) AppConfig {
	var cfg AppConfig
	raw, err := os.ReadFile(ConfigPath(dataDir))
	if err != nil {
		return cfg
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return AppConfig{}
	}
	return cfg
}

// SaveAppConfig writes the settings atomically, so an interrupted write cannot
// leave a half-file that the next start reads as no configuration at all.
func SaveAppConfig(dataDir string, cfg AppConfig) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	final := ConfigPath(dataDir)
	tmp := final + ".partial"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

// ManagedEnvDir is where the application builds its own environment, beside the
// database rather than inside the app bundle: a bundle is replaced wholesale on
// update and is read-only once installed on macOS, so an environment kept there
// would be discarded by the next version and unwritable in the meantime.
func ManagedEnvDir(dataDir string) string {
	return filepath.Join(dataDir, "python-env")
}
