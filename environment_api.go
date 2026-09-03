package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/pyenv"

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
	Active *pyenv.EnvReport `json:"active"`
	// Everything else found on this machine, uninspected: inspecting each one
	// imports rasterio and torch and costs seconds apiece, so the screen lists
	// them and inspects on selection.
	Candidates []pyenv.PythonCandidate `json:"candidates"`
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
	// The local PostGIS the electrical-system products read, inspected the way
	// the interpreter above is. Nil when there is no runner to ask with.
	//
	// Inspected here rather than left to the products because the two failures
	// a user meets are different questions: whether psycopg imports is what the
	// doctor answers, and whether there is a prepared database behind it is
	// what only opening the connection can. A screen that reported the first as
	// readiness would send someone to draw an area and wait for a run to die.
	GridStore *analysis.GridStoreReport `json:"grid_store"`
}

/*
gridDSN is the connection the sidecar should be told to use, or empty to let it
resolve its own.

THE VARIABLE HAS TO BE ABLE TO WIN, and only Go can arrange that. store.connect
reads the request key BEFORE the environment:

	dsn = (req or {}).get('br_store_dsn') or os.environ.get('TERRA_BR_DSN')

so a Go side that always sends the configured value makes TERRA_BR_DSN dead --
inverting the discipline appconfig.go states for the interpreter, where the
variable still wins when it is set. Returning empty here is how the sidecar is
allowed to read the variable it inherits.
*/
func gridDSN(cfg pyenv.AppConfig) string {
	if os.Getenv("TERRA_BR_DSN") != "" {
		return ""
	}
	return cfg.GridDSN
}

// gridDSNSource names what decided the connection, for the same reason
// EnvOverride names TERRA_PYTHON: a saved choice being overruled has to say so
// rather than appear to apply.
func gridDSNSource(cfg pyenv.AppConfig) string {
	if os.Getenv("TERRA_BR_DSN") != "" {
		return "TERRA_BR_DSN"
	}
	if cfg.GridDSN != "" {
		return "chosen"
	}
	return "default"
}

func (a *App) sidecarDir() string {
	runner := a.currentRunner()
	if runner == nil {
		return ""
	}
	return filepath.Dir(runner.SidecarPath())
}

func (a *App) dataDir() string {
	st := a.currentStore()
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
	managed := pyenv.ManagedEnvDir(data)
	cfg := pyenv.LoadAppConfig(data)

	state := &EnvironmentState{
		ManagedDir:  managed,
		EnvOverride: envOverride(),
		Building:    a.envBuilder.Running(),
		ConfigPath:  pyenv.ConfigPath(data),
	}

	// Read once. Four separate reads could see two different runners if a build
	// finished between them, and report an interpreter's packages beside another
	// one's path.
	runner := a.currentRunner()
	sidecar := a.sidecarDir()
	if runner != nil && sidecar != "" {
		python := runner.PythonPath()
		active := pyenv.InspectPython(a.ctx, python, sidecar)
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
	state.Candidates = pyenv.DiscoverPythons(appDir, managed, "")
	if runner != nil {
		state.GridStore = a.inspectGridStore(runner, cfg)
	}
	return state, nil
}

// inspectGridStore asks the store what it holds and labels the answer with what
// decided the connection. Shared by the environment screen and by the bound
// method the run graph's store node refreshes with, so the two cannot report
// different things about one database.
func (a *App) inspectGridStore(runner *analysis.Runner, cfg pyenv.AppConfig) *analysis.GridStoreReport {
	report := runner.InspectGridStore(a.ctx, gridDSN(cfg))
	report.DSNSource = gridDSNSource(cfg)
	if report.DSN == "" {
		// What the sidecar will resolve to on its own, so the screen shows the
		// connection that will actually be made rather than a blank.
		if v := os.Getenv("TERRA_BR_DSN"); v != "" {
			report.DSN = analysis.RedactDSN(v)
		} else {
			report.DSN = "postgresql:///terra_br"
		}
	}
	return report
}

// InspectGridStore refreshes just the store, without re-inspecting Python.
//
// Separate from InspectEnvironment because the two cost very different things:
// inspecting an interpreter imports rasterio and torch and takes seconds, and
// the run graph's store node needs to be able to say "still there" without
// paying for that.
func (a *App) InspectGridStore() (*analysis.GridStoreReport, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	data := a.dataDir()
	if data == "" {
		return nil, fmt.Errorf("the local store is not open")
	}
	return a.inspectGridStore(runner, pyenv.LoadAppConfig(data)), nil
}

/*
GridPlants reads the plant register for the map, so an area is not drawn blind.

SEPARATE FROM THE RUN PATH, for the reason InspectGridStore is separate from
InspectEnvironment: the cost and the meaning are different. A run answers about
a polygon and is worth recording; this says where the plants are, takes about a
second, is asked again whenever the view moves, and keeps nothing.

`bbox` is west, south, east, north. Empty asks for the whole located register --
24,698 points and about 7 MB, which the map draws without help and which is
cheaper to hold than to re-fetch on every pan.
*/
func (a *App) GridPlants(bbox []float64, kinds []string) (*analysis.GridPlantsLayer, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	data := a.dataDir()
	if data == "" {
		return nil, fmt.Errorf("the local store is not open")
	}
	// gridDSN, not the raw field: it is the one place that resolves the
	// configured connection against TERRA_BR_DSN and the sidecar's own default,
	// and reading the field directly is how a second answer to "which database"
	// gets written.
	cfg := pyenv.LoadAppConfig(data)
	return runner.GridPlants(a.ctx, gridDSN(cfg), bbox, kinds)
}

/*
GridNetwork reads the transmission network for the map.

Sibling of GridPlants and separate for the same reason it is in the runner: the
plant register is about 7 MB and this is about 1, and a surface that wants the
network should not wait for the register to arrive.

`minKV` drops the lower circuits, which is what makes the layer legible at
national zoom: 1,062 of the 1,830 in service are 230 kV, and drawing all of them
over Brazil is a mesh rather than a map.
*/
func (a *App) GridNetwork(bbox []float64, minKV float64) (*analysis.GridNetworkLayer, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	data := a.dataDir()
	if data == "" {
		return nil, fmt.Errorf("the local store is not open")
	}
	cfg := pyenv.LoadAppConfig(data)
	return runner.GridNetwork(a.ctx, gridDSN(cfg), bbox, minKV)
}

/*
SetGridStore records which database the electrical-system products read.

REFUSES A CONNECTION IT CANNOT REACH, the way UseInterpreter refuses to record
an unusable interpreter. A DSN saved without being tried is a setting that looks
applied and fails at the first run, in a screen whose whole job is to say what
works before anything is drawn.

An empty string clears the choice, which is not the same as an unreachable one:
it asks the sidecar to resolve its own default, and that is always allowed.
*/
func (a *App) SetGridStore(dsn string) (*analysis.GridStoreReport, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	data := a.dataDir()
	if data == "" {
		return nil, fmt.Errorf("the local store is not open")
	}

	if dsn != "" {
		trial := runner.InspectGridStore(a.ctx, dsn)
		if !trial.Reachable {
			return nil, fmt.Errorf("that connection could not be used: %s", trial.Unreachable)
		}
	}

	cfg := pyenv.LoadAppConfig(data)
	cfg.GridDSN = dsn
	if err := pyenv.SaveAppConfig(data, cfg); err != nil {
		return nil, fmt.Errorf("could not save the connection: %w", err)
	}
	return a.inspectGridStore(runner, cfg), nil
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
func resolvedPaths(runner *analysis.Runner, dataDir string) []ResolvedPath {
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
			Label:  "Repository root",
			Path:   runner.RepoRoot(),
			Source: sourceVar("TERRA_ROOT"),
			// Not the MapBiomas rasters any more: the embedded areas that
			// read them are gone, and so is the lookup. What is left under
			// this root is the checked-out virtualenv and the model directory
			// the runner falls back to.
			Blocks: "the bundled interpreter and the fallback model directory",
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
func (a *App) InspectPython(path string) (*pyenv.EnvReport, error) {
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return nil, fmt.Errorf("the sidecar directory is not resolved")
	}
	return pyenv.InspectPython(a.ctx, path, sidecar), nil
}

// UseInterpreter records a choice and rebuilds the runner around it.
//
// Refuses an interpreter that is not usable. Recording one would replace a
// problem the user can see with a problem they cannot: the screen would close,
// the application would look configured, and the failure would move back to
// the middle of an analysis, which is where this whole feature came from.
func (a *App) UseInterpreter(path string) (*pyenv.EnvReport, error) {
	sidecar := a.sidecarDir()
	if sidecar == "" {
		return nil, fmt.Errorf("the sidecar directory is not resolved")
	}
	report := pyenv.InspectPython(a.ctx, path, sidecar)
	if report.Unreachable != "" {
		return report, fmt.Errorf("%s", report.Unreachable)
	}
	if !report.Usable {
		return report, fmt.Errorf("that interpreter cannot run the sidecar yet")
	}

	data := a.dataDir()
	cfg := pyenv.LoadAppConfig(data)
	cfg.PythonPath = path
	cfg.Managed = path == venvInterpreter(pyenv.ManagedEnvDir(data))
	if err := pyenv.SaveAppConfig(data, cfg); err != nil {
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

	managed := pyenv.ManagedEnvDir(data)
	ctx := a.ctx
	runCtx := buildContext(ctx)
	go func() {
		emit := func(ev pyenv.EnvSetupEvent) {
			if ctx != nil {
				wruntime.EventsEmit(ctx, "env:setup", ev)
			}
		}
		py, err := a.envBuilder.Build(
			runCtx, basePython, managed, requirementsTxt, sidecar, emit,
		)
		if err != nil {
			return // Build already emitted the failure.
		}
		cfg := pyenv.LoadAppConfig(data)
		cfg.PythonPath = py
		cfg.Managed = true
		if err := pyenv.SaveAppConfig(data, cfg); err != nil {
			emit(pyenv.EnvSetupEvent{Step: pyenv.StepFailed,
				Error: "the environment was built but the choice could not be saved: " + err.Error()})
			return
		}
		if err := a.rebuildRunner(py); err != nil {
			emit(pyenv.EnvSetupEvent{Step: pyenv.StepFailed,
				Error: "the environment was built but could not be adopted: " + err.Error()})
			return
		}
		emit(pyenv.EnvSetupEvent{Step: pyenv.StepDone, Line: "in use"})
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
	runCtx := buildContext(ctx)
	go func() {
		emit := func(ev pyenv.EnvSetupEvent) {
			if ctx != nil {
				wruntime.EventsEmit(ctx, "env:setup", ev)
			}
		}
		if install {
			_ = a.envBuilder.InstallOptional(runCtx, python, name, sidecar, emit)
			return
		}
		_ = a.envBuilder.RemoveOptional(runCtx, python, name, sidecar, emit)
	}()
	return nil
}

/*
buildContext is the context a pip run is bound to, derived from the
application's.

These three runs used context.Background() while a.ctx sat in scope beside
them, captured for event emission. The child pip process therefore outlived
the window: closing the application left it installing into the managed
environment directory with no surface reporting it and nothing able to stop
it, and a relaunch would find a half-populated environment that InspectPython
had no reason to distrust.

The two contexts stay separate rather than collapsing into one. emit needs the
Wails context specifically, because that is what EventsEmit resolves the event
bus from, and it must stay nil-checked -- a build can be requested before
startup has handed one over. A run has no such option: exec.CommandContext
panics on a nil context, so the fallback here is Background, which is the
behaviour these calls already had.
*/
func buildContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

// ListOptionalPackages reports what can be added, so the screen names the cost
// and what each one unlocks rather than listing bare package names.
func (a *App) ListOptionalPackages() []pyenv.OptionalPackage {
	return pyenv.OptionalPackages
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
	runner, err := analysis.NewRunner(appDir, python)
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

func venvInterpreter(dir string) string { return pyenv.VenvInterpreter(dir) }

// originOf names where an interpreter came from, in the user's terms.
//
// "abandoned" is the case worth naming. A saved choice whose file is gone --
// an environment deleted, a Homebrew upgrade moving a path -- falls through
// resolvePython to a heuristic, and reporting that as "detected" would tell
// the user their selection is still in force while quietly running something
// else. It says the selection was dropped, which is the only version of events
// that explains what they are looking at.
func originOf(path, managedDir string, cfg pyenv.AppConfig) string {
	switch {
	case os.Getenv("TERRA_PYTHON") != "":
		return "TERRA_PYTHON"
	case path == pyenv.VenvInterpreter(managedDir):
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
