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
	// Set when GEOSENSE_PYTHON is forcing the choice, so the screen can say why
	// the selection it offers will not take effect.
	EnvOverride string `json:"env_override"`
	Building    bool   `json:"building"`
}

func (a *App) sidecarDir() string {
	if a.runner == nil {
		return ""
	}
	return filepath.Dir(a.runner.SidecarPath())
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
	}

	sidecar := a.sidecarDir()
	if a.runner != nil && sidecar != "" {
		active := backend.InspectPython(a.ctx, a.runner.PythonPath(), sidecar)
		active.Origin = originOf(a.runner.PythonPath(), managed, cfg)
		state.Active = active
		state.ManagedActive = a.runner.PythonPath() == venvInterpreter(managed)
	}

	appDir := ""
	if a.runner != nil {
		appDir = filepath.Dir(sidecar)
	}
	state.Candidates = backend.DiscoverPythons(appDir, managed, "")
	return state, nil
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

// CancelEnvironmentBuild stops a build in progress.
func (a *App) CancelEnvironmentBuild() {
	a.envBuilder.Cancel()
}

// rebuildRunner points the application at a different interpreter without a
// restart, so a user who has just fixed their environment can work in it.
func (a *App) rebuildRunner(python string) error {
	appDir := ""
	if a.runner != nil {
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

// envOverride reports GEOSENSE_PYTHON when it is set. The screen states it
// rather than hiding it: with the variable set, a selection made in the UI is
// saved and then overruled, and a control that silently does nothing is worse
// than one that explains why.
func envOverride() string { return os.Getenv("GEOSENSE_PYTHON") }

func venvInterpreter(dir string) string { return backend.VenvInterpreter(dir) }

// originOf names where an interpreter came from, in the user's terms.
func originOf(path, managedDir string, cfg backend.AppConfig) string {
	switch {
	case os.Getenv("GEOSENSE_PYTHON") != "":
		return "GEOSENSE_PYTHON"
	case path == backend.VenvInterpreter(managedDir):
		return "managed"
	case cfg.PythonPath != "" && path == cfg.PythonPath:
		return "chosen"
	default:
		return "detected"
	}
}
