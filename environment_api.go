package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"geosense-infer/backend"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

/*
The environment surface the setup screen talks to.

Kept apart from app.go because it answers a different question from everything
else there: not "run this analysis" but "can anything be run at all". The
screen it serves is the one a user meets when the answer is no.
*/

/*
ResolvedPath is one location the application resolved at startup, reported so
the user can see where something is being read from.

Read-only, and deliberately so. These are properties of the installation -- a
packaged bundle knows where its own sidecar/ and model/ are -- not preferences,
and the environment variables that override them cannot usefully be set by the
application itself: a variable written into this process does not survive a
relaunch, and making it survive would mean editing the user's shell profile or
registry from a desktop app. They exist for a launch from a terminal, which is
where a developer can already set them.

What was missing was not a way to change these; it was any way to see them. They
appeared only in the boot log, which scrolls past behind a splash screen, so
"the model directory is not where you think" was a question nothing on screen
could answer.
*/
type ResolvedPath struct {
	// What this path is, in the user's terms.
	Label string `json:"label"`
	Path  string `json:"path"`
	// Set when an environment variable decided this path, naming it. The point
	// of showing these at all is the case where one is set and forgotten.
	Source string `json:"source,omitempty"`
	// Whether the path is actually there. A resolved path that does not exist
	// is the specific thing worth seeing: it resolves silently and fails later.
	Exists bool `json:"exists"`
	// What stops working when it is absent.
	Blocks string `json:"blocks,omitempty"`
}

// EnvironmentState is everything the setup screen needs in one call.
type EnvironmentState struct {
	// The interpreter in use right now, inspected.
	Active *backend.EnvReport `json:"active"`
	// Everything else found on this machine, uninspected: inspecting each one
	// imports rasterio and torch and costs seconds apiece, so the screen lists
	// them and inspects on selection.
	Candidates []backend.PythonCandidate `json:"candidates"`
	// Where a managed environment would be, or is.
	ManagedDir string `json:"managed_dir"`
	// True when the active interpreter is the one this application built, and
	// therefore the one it may rebuild without asking.
	ManagedActive bool `json:"managed_active"`
	// Set when TERRA_PYTHON is forcing the choice, so the screen can say why
	// the selection it offers will not take effect.
	EnvOverride string `json:"env_override"`
	Building    bool   `json:"building"`
	// Where the application is reading its parts from, for diagnosis.
	Paths []ResolvedPath `json:"paths"`
	// GEOSENSE_* variables still set in this environment. They no longer do
	// anything; reporting them is what keeps the rename from failing silently.
	RetiredVars []string `json:"retired_vars"`
	// The settings file itself, so the screen can point at what to delete when
	// a saved choice needs undoing outside the application.
	ConfigPath string `json:"config_path"`
}

func (a *App) sidecarDir() string {
	runner := a.currentRunner()
	if runner == nil {
		return ""
	}
	return filepath.Dir(runner.SidecarPath())
}

func (a *App) dataDir() string {
	a.mu.RLock()
	st := a.store
	a.mu.RUnlock()
	if st == nil {
		return ""
	}
	return st.DataDir()
}

// InspectEnvironment reports what the application can run, and what else is
// available to choose.
func (a *App) InspectEnvironment() (*EnvironmentState, error) {
	data := a.dataDir()
	if data == "" {
		return nil, fmt.Errorf("the local store is not open")
	}
	managed := backend.ManagedEnvDir(data)
	cfg := backend.LoadAppConfig(data)

	state := &EnvironmentState{
		ManagedDir:  managed,
		EnvOverride: envOverride(),
		Building:    a.envBuilder.Running(),
		ConfigPath:  backend.ConfigPath(data),
	}

	// Read once. Four separate reads could see two different runners if a build
	// finished between them, and report an interpreter's packages beside another
	// one's path.
	runner := a.currentRunner()
	sidecar := a.sidecarDir()
	if runner != nil && sidecar != "" {
		python := runner.PythonPath()
		active := backend.InspectPython(a.ctx, python, sidecar)
		active.Origin = originOf(python, managed, cfg)
		state.Active = active
		state.ManagedActive = python == venvInterpreter(managed)
	}
	state.Paths = resolvedPaths(runner, data)
	state.RetiredVars = retiredVars()

	appDir := ""
	if runner != nil {
		appDir = filepath.Dir(sidecar)
	}
	state.Candidates = backend.DiscoverPythons(appDir, managed, "")
	return state, nil
}

/*
resolvedPaths lists where the application is reading its parts from.

Each entry names the environment variable that decided it, when one did. That is
the case this exists for: a TERRA_MODEL_DIR exported months ago in a shell
profile keeps applying to every launch from that terminal, and until now nothing
on screen said so -- the classification simply came from a model directory the
user had forgotten about.

Exists is checked rather than assumed. resolveAppDir and the model fallback both
end in a path that may not be there, and neither reports it: the failure arrives
later, as "model directory not found", from the middle of a run.
*/
func resolvedPaths(runner *backend.Runner, dataDir string) []ResolvedPath {
	// Set by Go regardless of the runner, so they are reported even when the
	// runner failed to build -- which is exactly when someone is looking.
	paths := []ResolvedPath{{
		Label:  "Data directory",
		Path:   dataDir,
		Blocks: "saved runs, projects and the interpreter choice",
	}}

	if runner == nil {
		return withExistence(paths)
	}

	paths = append(paths,
		ResolvedPath{
			Label:  "Sidecar",
			Path:   runner.SidecarPath(),
			Source: sourceVar("TERRA_APP_DIR"),
			Blocks: "every analysis",
		},
		ResolvedPath{
			Label:  "Model",
			Path:   runner.ModelDir(),
			Source: sourceVar("TERRA_MODEL_DIR"),
			Blocks: "the Random Forest classification",
		},
		ResolvedPath{
			Label:  "Areas",
			Path:   runner.AreasDir(),
			Source: sourceVar("TERRA_APP_DIR"),
			Blocks: "the embedded study areas A, B and C",
		},
		ResolvedPath{
			Label:  "Repository root",
			Path:   runner.RepoRoot(),
			Source: sourceVar("TERRA_ROOT"),
			Blocks: "the local MapBiomas rasters for embedded areas",
		},
	)
	return withExistence(paths)
}

// sourceVar names an environment variable when it is set, so the screen can say
// which one is deciding a path rather than only where the path landed.
func sourceVar(name string) string {
	if os.Getenv(name) == "" {
		return ""
	}
	return name
}

/*
retiredVars lists GEOSENSE_* variables that are still set.

The GEOSENSE_ prefix was retired in favour of TERRA_ -- geosense is the
research repository this application grew out of, not the application. The old
names were dropped outright rather than kept as aliases, which is the clean
outcome and also the dangerous one: a GEOSENSE_PYTHON in a shell profile stops
having any effect, and an environment variable that silently stops working is
the worst way for a rename to arrive.

So the screen that reports which variable decides each path also reports the
ones that no longer decide anything. Nothing else can: by definition these are
values the application has stopped reading.
*/
func retiredVars() []string {
	var found []string
	for _, name := range []string{
		"GEOSENSE_PYTHON",
		"GEOSENSE_APP_DIR",
		"GEOSENSE_MODEL_DIR",
		"GEOSENSE_ROOT",
	} {
		if os.Getenv(name) != "" {
			found = append(found, name)
		}
	}
	return found
}

func withExistence(paths []ResolvedPath) []ResolvedPath {
	for i := range paths {
		if paths[i].Path == "" {
			continue
		}
		_, err := os.Stat(paths[i].Path)
		paths[i].Exists = err == nil
	}
	return paths
}

// InspectPython inspects one candidate, for the screen to call when the user
// selects it. Separate from the listing because this is the slow part: it
// imports every dependency in that interpreter.
func (a *App) InspectPython(path string) (*backend.EnvReport, error) {
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return nil, fmt.Errorf("the sidecar directory is not resolved")
	}
	return backend.InspectPython(a.ctx, path, sidecar), nil
}

// UseInterpreter records a choice and rebuilds the runner around it.
//
// Refuses an interpreter that is not usable. Recording one would replace a
// problem the user can see with a problem they cannot: the screen would close,
// the application would look configured, and the failure would move back to
// the middle of an analysis, which is where this whole feature came from.
func (a *App) UseInterpreter(path string) (*backend.EnvReport, error) {
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return nil, fmt.Errorf("the sidecar directory is not resolved")
	}
	report := backend.InspectPython(a.ctx, path, sidecar)
	if report.Unreachable != "" {
		return report, fmt.Errorf("%s", report.Unreachable)
	}
	if !report.Usable {
		return report, fmt.Errorf("that interpreter cannot run the sidecar yet")
	}

	data := a.dataDir()
	cfg := backend.LoadAppConfig(data)
	cfg.PythonPath = path
	cfg.Managed = path == venvInterpreter(backend.ManagedEnvDir(data))
	if err := backend.SaveAppConfig(data, cfg); err != nil {
		return report, err
	}
	return report, a.rebuildRunner(cfg.PythonPath)
}

// BuildManagedEnvironment creates the application's own environment from the
// given base interpreter and adopts it when it verifies.
//
// Runs in the background and reports through the "env:setup" event, because it
// takes minutes: a synchronous call would freeze the window for the whole
// install with nothing to show for it.
func (a *App) BuildManagedEnvironment(basePython string) error {
	data := a.dataDir()
	if data == "" {
		return fmt.Errorf("the local store is not open")
	}
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return fmt.Errorf("the sidecar directory is not resolved")
	}
	if a.envBuilder.Running() {
		return fmt.Errorf("an environment build is already running")
	}

	managed := backend.ManagedEnvDir(data)
	ctx := a.ctx
	go func() {
		emit := func(ev backend.EnvSetupEvent) {
			if ctx != nil {
				wruntime.EventsEmit(ctx, "env:setup", ev)
			}
		}
		py, err := a.envBuilder.Build(
			context.Background(), basePython, managed, requirementsTxt, sidecar, emit,
		)
		if err != nil {
			return // Build already emitted the failure.
		}
		cfg := backend.LoadAppConfig(data)
		cfg.PythonPath = py
		cfg.Managed = true
		if err := backend.SaveAppConfig(data, cfg); err != nil {
			emit(backend.EnvSetupEvent{Step: backend.StepFailed,
				Error: "the environment was built but the choice could not be saved: " + err.Error()})
			return
		}
		if err := a.rebuildRunner(py); err != nil {
			emit(backend.EnvSetupEvent{Step: backend.StepFailed,
				Error: "the environment was built but could not be adopted: " + err.Error()})
			return
		}
		emit(backend.EnvSetupEvent{Step: backend.StepDone, Line: "in use"})
	}()
	return nil
}

/*
ManageOptionalPackage installs or removes one optional dependency.

Runs in the background on the same "env:setup" channel as a build, because it
is the same operation from the user's side: pip working in their environment
with output worth watching. torch is a multi-gigabyte download, so a
synchronous call would freeze the window for the whole of it.

`install` false removes it. These are large enough that reclaiming the space
is a real request, and rebuilding the whole environment to drop one package
would be a poor answer to it.
*/
func (a *App) ManageOptionalPackage(name string, install bool) error {
	data := a.dataDir()
	if data == "" {
		return fmt.Errorf("the local store is not open")
	}
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return fmt.Errorf("the sidecar directory is not resolved")
	}
	runner := a.currentRunner()
	if runner == nil {
		return fmt.Errorf("no interpreter is resolved")
	}
	if a.envBuilder.Running() {
		return fmt.Errorf("an environment operation is already running")
	}
	python := runner.PythonPath()

	ctx := a.ctx
	go func() {
		emit := func(ev backend.EnvSetupEvent) {
			if ctx != nil {
				wruntime.EventsEmit(ctx, "env:setup", ev)
			}
		}
		if install {
			_ = a.envBuilder.InstallOptional(context.Background(), python, name, sidecar, emit)
			return
		}
		_ = a.envBuilder.RemoveOptional(context.Background(), python, name, sidecar, emit)
	}()
	return nil
}

// ListOptionalPackages reports what can be added, so the screen names the cost
// and what each one unlocks rather than listing bare package names.
func (a *App) ListOptionalPackages() []backend.OptionalPackage {
	return backend.OptionalPackages
}

// CancelEnvironmentBuild stops a build in progress.
func (a *App) CancelEnvironmentBuild() {
	a.envBuilder.Cancel()
}

// rebuildRunner points the application at a different interpreter without a
// restart, so a user who has just fixed their environment can work in it.
func (a *App) rebuildRunner(python string) error {
	appDir := ""
	if a.currentRunner() != nil {
		appDir = filepath.Dir(a.sidecarDir())
	}
	runner, err := backend.NewRunner(appDir, python)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.runner = runner
	a.mu.Unlock()
	return nil
}

// envOverride reports TERRA_PYTHON when it is set. The screen states it
// rather than hiding it: with the variable set, a selection made in the UI is
// saved and then overruled, and a control that silently does nothing is worse
// than one that explains why.
func envOverride() string { return os.Getenv("TERRA_PYTHON") }

func venvInterpreter(dir string) string { return backend.VenvInterpreter(dir) }

// originOf names where an interpreter came from, in the user's terms.
//
// "abandoned" is the case worth naming. A saved choice whose file is gone --
// an environment deleted, a Homebrew upgrade moving a path -- falls through
// resolvePython to a heuristic, and reporting that as "detected" would tell
// the user their selection is still in force while quietly running something
// else. It says the selection was dropped, which is the only version of events
// that explains what they are looking at.
func originOf(path, managedDir string, cfg backend.AppConfig) string {
	switch {
	case os.Getenv("TERRA_PYTHON") != "":
		return "TERRA_PYTHON"
	case path == backend.VenvInterpreter(managedDir):
		return "managed"
	case cfg.PythonPath != "" && path == cfg.PythonPath:
		return "chosen"
	case cfg.PythonPath != "":
		// A choice is recorded and is not what is running.
		return "abandoned"
	default:
		return "detected"
	}
}
