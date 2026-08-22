package pyenv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// EnvPackage is one module the sidecar imports, as doctor.py found it.
type EnvPackage struct {
	Module       string `json:"module"`
	Distribution string `json:"distribution"`
	// What stops working without it, in the user's terms.
	Blocks   string `json:"blocks"`
	Optional bool   `json:"optional"`
	Present  bool   `json:"present"`
	Version  string `json:"version"`
	// The window this one has to sit in, when it has one.
	Wanted string `json:"wanted"`
	// Present but outside the window. Separate from Present because the two
	// need different actions: one is an install, the other is a downgrade.
	VersionProblem string `json:"version_problem"`
	Why            string `json:"why"`
	Error          string `json:"error"`
}

// EnvReport is what one interpreter can and cannot do.
type EnvReport struct {
	Executable    string       `json:"executable"`
	PythonVersion string       `json:"python_version"`
	PythonOK      bool         `json:"python_ok"`
	MinPython     string       `json:"min_python"`
	Packages      []EnvPackage `json:"packages"`
	Usable        bool         `json:"usable"`

	// Filled by Go rather than by the doctor.

	// Where this interpreter came from, so the user can tell a managed
	// environment from one of their own.
	Origin string `json:"origin"`
	// Why the interpreter could not be asked at all -- it does not exist, it
	// is not executable, it timed out. Distinct from an unusable environment:
	// one is a broken path, the other is a working Python missing packages.
	Unreachable string `json:"unreachable"`
}

// MissingRequired lists what has to be installed before anything will run.
func (r *EnvReport) MissingRequired() []EnvPackage {
	var out []EnvPackage
	for _, p := range r.Packages {
		if !p.Optional && (!p.Present || p.VersionProblem != "") {
			out = append(out, p)
		}
	}
	return out
}

/*
InspectPython asks one interpreter what it can do.

Runs sidecar/doctor.py IN THAT INTERPRETER, because the only honest way to know
whether an import works there is to do it there. The previous check ran
`python -c "import sys; print(sys.version)"` and reported "sidecar ready" on
any Python that answered, which is how an environment with nothing installed
reached the point of failing mid-analysis.

A failure to run the doctor is reported as Unreachable rather than as an error,
so the caller can list a broken candidate beside the working ones instead of
losing the whole listing to one bad path.
*/
func InspectPython(ctx context.Context, pythonPath, sidecarDir string) *EnvReport {
	report := &EnvReport{Executable: pythonPath}

	doctor := filepath.Join(sidecarDir, "doctor.py")
	if _, err := os.Stat(doctor); err != nil {
		report.Unreachable = fmt.Sprintf("doctor.py not found at %s", doctor)
		return report
	}

	// Bounded: a candidate on a stalled network mount would otherwise hang the
	// listing, and the listing is what the setup screen waits on.
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonPath, doctor)
	// Importing rasterio and torch is slow enough that any inherited
	// PYTHONPATH pointing at another environment would confuse the answer.
	cmd.Env = append(os.Environ(), "PYTHONNOUSERSITE=1")
	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			msg = strings.TrimSpace(string(ee.Stderr))
		}
		if len(msg) > 400 {
			msg = msg[:400]
		}
		report.Unreachable = msg
		return report
	}

	if err := json.Unmarshal(out, report); err != nil {
		report.Unreachable = "doctor returned something that is not JSON: " + err.Error()
		return report
	}
	report.Executable = pythonPath
	return report
}

// PythonCandidate is an interpreter the user could choose.
type PythonCandidate struct {
	Path string `json:"path"`
	// Where it came from: bundled, managed, venv, path, launcher.
	Origin string `json:"origin"`
}

/*
DiscoverPythons lists interpreters worth offering, best first.

Ordered by how likely each is to be the right answer rather than
alphabetically: an interpreter the application manages beats one the user
happens to have, because it is the only one whose contents the application can
guarantee.

Every path is resolved and de-duplicated, so a symlink farm -- which is what
Homebrew, pyenv and the macOS stub interpreters all are -- does not present the
same interpreter four times under four names.
*/
func DiscoverPythons(appDir, managedDir, repoRoot string) []PythonCandidate {
	var out []PythonCandidate
	seen := map[string]bool{}

	add := func(path, origin string) {
		if path == "" {
			return
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return
		}
		// Resolve before de-duplicating: /usr/local/bin/python3 and
		// /opt/homebrew/Cellar/.../python3.12 are frequently one file.
		real, err := filepath.EvalSymlinks(path)
		if err != nil {
			real = path
		}
		if seen[real] {
			return
		}
		seen[real] = true
		out = append(out, PythonCandidate{Path: path, Origin: origin})
	}

	// The environment this application created, which is the one it can repair.
	if managedDir != "" {
		add(venvPython(managedDir), "managed")
	}
	// Shipped inside the FULL bundle.
	for _, p := range bundledPythons(appDir) {
		add(p, "bundled")
	}
	// A development checkout.
	if repoRoot != "" {
		add(venvPython(filepath.Join(repoRoot, ".venv")), "venv")
	}
	// Whatever the user already has. 3.12 first: it is what the wheels and the
	// pickled forests were built against, so a newer one is a worse answer
	// even though it looks like a better one.
	for _, name := range []string{"python3.12", "python3.13", "python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			add(p, "path")
		}
	}
	for _, p := range wellKnownPythons() {
		add(p, "path")
	}
	return out
}

// venvPython is the interpreter inside a virtual environment, per platform.
func venvPython(venvDir string) string {
	if venvDir == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(venvDir, "Scripts", "python.exe")
	}
	return filepath.Join(venvDir, "bin", "python")
}

func bundledPythons(appDir string) []string {
	if appDir == "" {
		return nil
	}
	return []string{
		filepath.Join(appDir, "python", "bin", "python3"),
		filepath.Join(appDir, "python", "bin", "python"),
		filepath.Join(appDir, "python", "python.exe"),
		filepath.Join(appDir, "python", "python"),
	}
}

// wellKnownPythons covers installs that are commonly NOT on the PATH of a GUI
// application. A desktop app launched from Finder or the Start menu inherits
// the session environment, not a shell profile, so Homebrew and pyenv are
// routinely invisible to it while being obvious in a terminal.
func wellKnownPythons() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			"/opt/homebrew/bin/python3.12",
			"/opt/homebrew/bin/python3",
			"/usr/local/bin/python3.12",
			"/usr/local/bin/python3",
			"/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
			"/usr/bin/python3",
		}
	case "linux":
		return []string{
			"/usr/bin/python3.12",
			"/usr/bin/python3",
			"/usr/local/bin/python3.12",
			"/usr/local/bin/python3",
		}
	}
	return nil
}

// VenvInterpreter is the interpreter inside a virtual environment, exported so
// the application can recognise its own managed environment by path.
func VenvInterpreter(venvDir string) string { return venvPython(venvDir) }
