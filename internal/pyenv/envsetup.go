package pyenv

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Building the environment the application manages.

The LITE path asked a user to install Python, create a virtual environment,
install a requirements file that is not in the download, and then export an
environment variable that a desktop launch never reads. That is a developer
workflow with an installer's name on it. This does the same work from a button.

The requirements text is passed in rather than read from disk. A packaged
application has no requirements.txt -- the packager copies sidecar/, areas/ and
model/ and nothing else -- so reading one would work in a checkout and fail in
every release. Embedded in the binary, the manifest is exactly the one the
build was made against, which is also the one whose pins the trained model
needs.
*/

// EnvSetupStep is where a run is, for a caller that shows progress.
type EnvSetupStep string

const (
	StepCreatingVenv EnvSetupStep = "creating_venv"
	StepUpgradingPip EnvSetupStep = "upgrading_pip"
	StepInstalling   EnvSetupStep = "installing"
	StepVerifying    EnvSetupStep = "verifying"
	StepDone         EnvSetupStep = "done"
	StepFailed       EnvSetupStep = "failed"
)

// EnvSetupEvent is one line of progress.
type EnvSetupEvent struct {
	Step EnvSetupStep `json:"step"`
	// A line from the tool being run, verbatim. Shown rather than summarised:
	// pip's own account of what it is resolving is the only honest answer to
	// "why is this taking so long", and a spinner is not.
	Line string `json:"line,omitempty"`
	// Set once, when the run ends badly.
	Error string `json:"error,omitempty"`
}

// EnvBuilder runs one environment build at a time.
type EnvBuilder struct {
	mu      sync.Mutex
	cancel  context.CancelFunc
	running bool
}

// Running reports whether a build is in flight, so a second request can be
// refused rather than racing the first into the same directory.
func (b *EnvBuilder) Running() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.running
}

// Cancel stops a build in progress. The half-built directory is left in place:
// removing it is the next build's job, and deleting a tree while pip may still
// hold files open is how a cancel turns into a corrupt environment.
func (b *EnvBuilder) Cancel() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cancel != nil {
		b.cancel()
	}
}

/*
Build creates a virtual environment at envDir using basePython and installs
requirements into it, reporting progress through emit.

Returns the interpreter inside the new environment, which the caller saves as
the configured one only after the verification step agrees it is usable --
recording an interpreter that cannot run anything would replace a diagnosable
problem with a silent one.
*/
func (b *EnvBuilder) Build(
	ctx context.Context,
	basePython, envDir, requirements, sidecarDir string,
	emit func(EnvSetupEvent),
) (string, error) {
	b.mu.Lock()
	if b.running {
		b.mu.Unlock()
		return "", fmt.Errorf("an environment build is already running")
	}
	ctx, cancel := context.WithCancel(ctx)
	b.cancel = cancel
	b.running = true
	b.mu.Unlock()

	defer func() {
		cancel()
		b.mu.Lock()
		b.running = false
		b.cancel = nil
		b.mu.Unlock()
	}()

	fail := func(err error) (string, error) {
		emit(EnvSetupEvent{Step: StepFailed, Error: err.Error()})
		return "", err
	}

	// Asked before anything is created or removed.
	//
	// The candidate list is deliberately uninspected -- running the doctor in
	// every interpreter costs seconds apiece -- so "Build environment" is
	// offered on interpreters too old to carry the wheels. Without this the
	// answer arrives at the verification step, after a venv was created, the
	// previous one deleted, and pip spent minutes failing to resolve. This
	// costs one process start and reports the same fact up front.
	if version, err := basePythonVersion(ctx, basePython); err != nil {
		return fail(fmt.Errorf("%s could not be run: %w", basePython, err))
	} else if !versionAtLeast(version, minPython) {
		return fail(fmt.Errorf(
			"%s is Python %s, and TERRA needs %s or newer",
			basePython, strings.Join(itoaAll(version), "."),
			strings.Join(itoaAll(minPython), ".")))
	}

	// A previous attempt may have left a partial tree. venv would reuse it and
	// inherit whatever was broken about it, so it goes first -- at a moment
	// when nothing is running inside it, unlike during a cancel.
	if _, err := os.Stat(envDir); err == nil {
		emit(EnvSetupEvent{Step: StepCreatingVenv, Line: "removing the previous environment"})
		if err := os.RemoveAll(envDir); err != nil {
			return fail(fmt.Errorf("could not remove %s: %w", envDir, err))
		}
	}
	if err := os.MkdirAll(filepath.Dir(envDir), 0o700); err != nil {
		return fail(err)
	}

	emit(EnvSetupEvent{Step: StepCreatingVenv, Line: "creating the environment"})
	if err := runStreaming(ctx, emit, StepCreatingVenv, basePython,
		"-m", "venv", envDir); err != nil {
		return fail(fmt.Errorf("could not create the environment: %w", err))
	}

	py := venvPython(envDir)
	if _, err := os.Stat(py); err != nil {
		return fail(fmt.Errorf("the environment has no interpreter at %s", py))
	}

	// Marked before the packages go in, so the bulk of it is never copied.
	// Not fatal: a backup that copies more than it needs to is not a reason to
	// refuse to build the environment. See excludeFromBackup.
	if err := excludeFromBackup(envDir); err != nil {
		emit(EnvSetupEvent{Step: StepCreatingVenv,
			Line: "could not mark the environment as excluded from backup: " + err.Error()})
	}

	emit(EnvSetupEvent{Step: StepUpgradingPip, Line: "updating pip"})
	// Not fatal. An old pip installs the requirements in almost every case, and
	// failing the whole build because the upgrade could not reach the network
	// would be refusing to try the thing the user asked for.
	if err := runStreaming(ctx, emit, StepUpgradingPip, py,
		"-m", "pip", "install", "--upgrade", "pip"); err != nil {
		emit(EnvSetupEvent{Step: StepUpgradingPip,
			Line: "pip could not be updated, continuing: " + err.Error()})
	}

	// Written next to the environment it describes, so what was installed can
	// be read later without guessing at the version of the app that built it.
	reqPath := filepath.Join(filepath.Dir(envDir), "requirements.installed.txt")
	if err := os.WriteFile(reqPath, []byte(requirements), 0o600); err != nil {
		return fail(err)
	}

	emit(EnvSetupEvent{Step: StepInstalling, Line: "installing dependencies"})
	if err := runStreaming(ctx, emit, StepInstalling, py,
		"-m", "pip", "install", "-r", reqPath); err != nil {
		return fail(fmt.Errorf("installing dependencies failed: %w", err))
	}

	// The build is not finished when pip exits zero. pip reports on packages;
	// what matters is whether the sidecar's imports work in this interpreter,
	// which is a different question and the one that has been going unasked.
	emit(EnvSetupEvent{Step: StepVerifying, Line: "checking the environment"})
	report := InspectPython(ctx, py, sidecarDir)
	if report.Unreachable != "" {
		return fail(fmt.Errorf("the new environment could not be inspected: %s",
			report.Unreachable))
	}
	if !report.Usable {
		var names []string
		for _, p := range report.MissingRequired() {
			if p.VersionProblem != "" {
				names = append(names, p.Distribution+" ("+p.VersionProblem+")")
			} else {
				names = append(names, p.Distribution)
			}
		}
		return fail(fmt.Errorf("the environment was built but is still missing: %s",
			strings.Join(names, ", ")))
	}

	emit(EnvSetupEvent{Step: StepDone, Line: "environment ready · python " + report.PythonVersion})
	return py, nil
}

/*
minPython is the floor a base interpreter has to clear to be worth building on.

It restates doctor.py's MIN_PYTHON, which is the authority: that file decides
whether a finished environment is usable, and this only decides whether it is
worth spending minutes finding out. Kept in step by the test below, which fails
if the two drift -- a floor here that is lower would let a build run to a
verification that was always going to reject it, and one that is higher would
refuse an interpreter the doctor would have accepted.
*/
var minPython = []int{3, 12}

// basePythonVersion asks an interpreter its version, as major/minor.
//
// Deliberately not the doctor: that imports rasterio and torch and costs
// seconds. This is one `print` and answers the only question asked before a
// build starts.
func basePythonVersion(ctx context.Context, python string) ([]int, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, python, "-c",
		"import sys; print('%d.%d' % sys.version_info[:2])")
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("%s", strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, err
	}

	var parts []int
	for _, chunk := range strings.Split(strings.TrimSpace(string(out)), ".") {
		n, err := strconv.Atoi(chunk)
		if err != nil {
			return nil, fmt.Errorf("unexpected version output: %q",
				strings.TrimSpace(string(out)))
		}
		parts = append(parts, n)
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("no version reported")
	}
	return parts, nil
}

// versionAtLeast compares version tuples component by component, so 3.13 beats
// 3.12 and 3.9 does not -- which a string comparison gets wrong.
func versionAtLeast(got, floor []int) bool {
	for i, want := range floor {
		if i >= len(got) {
			return false
		}
		if got[i] != want {
			return got[i] > want
		}
	}
	return true
}

func itoaAll(parts []int) []string {
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = strconv.Itoa(p)
	}
	return out
}

/*
OptionalPackage is a dependency the application can run without.

These are the ones deliberately outside requirements.txt: torch alone outweighs
everything else the application ships, so making every install pay for it to
serve the users who want the neural models would be the wrong default. They are
installed on request instead.
*/
type OptionalPackage struct {
	// What pip installs. May carry a version constraint.
	Spec string `json:"spec"`
	// The distribution name, for uninstalling and for matching the doctor's
	// report -- "torch>=2.1" installs, but "torch" is what is removed.
	Name string `json:"name"`
	// What it unlocks, in the user's terms.
	Enables string `json:"enables"`
	// Roughly what the download costs, since these are large enough that the
	// number changes whether someone starts it.
	Size string `json:"size"`
	// Companion distributions an extra pulls in, which pip does not remove with
	// the package that asked for them.
	//
	// `pip install psycopg[binary]` installs psycopg AND psycopg-binary, and
	// `pip uninstall psycopg` removes only the first. Without this a Remove
	// that reports success leaves most of the bytes on disk, which is the one
	// thing the button exists to reclaim.
	Also []string `json:"also,omitempty"`
}

// OptionalPackages are what Settings can add and remove.
//
// Kept here rather than read from requirements-prithvi.txt: that file exists
// for a manual pip install and pulls requirements.txt with it, which is not
// what adding one package to a working environment should do.
var OptionalPackages = []OptionalPackage{
	{
		Spec:    "torch>=2.1",
		Name:    "torch",
		Enables: "Temporal Transformer and Prithvi-EO 2.0",
		Size:    "about 2-3 GB",
	},
	{
		// [binary] and not bare psycopg: the pure-Python distribution builds
		// against a system libpq, which a desktop user has no reason to have
		// and no obvious way to get. The wheel carries its own.
		//
		// INSTALLING THIS DOES NOT MAKE THE PRODUCTS WORK, and the panel has to
		// keep the two apart: this is the driver, and the record also needs a
		// PostgreSQL with PostGIS and the ONS files loaded into it. The doctor
		// answers the first; only opening the connection answers the second,
		// which is what the grid store report beside this is for.
		Spec:    "psycopg[binary]>=3.2",
		Name:    "psycopg",
		Enables: "the Brazilian electrical-system products",
		Size:    "about 4 MB",
		Also:    []string{"psycopg-binary"},
	},
}

/*
InstallOptional adds one optional package to an existing environment.

Reuses the build lock: pip writing into the same environment twice at once is
how a half-installed package gets left behind, and the UI has one progress
channel to report through either way.

Refuses anything not on the list above. The name reaches this from the
frontend, and an install command that accepts an arbitrary string is a way to
run arbitrary pip.
*/
func (b *EnvBuilder) InstallOptional(
	ctx context.Context,
	python, name, sidecarDir string,
	emit func(EnvSetupEvent),
) error {
	pkg, ok := findOptional(name)
	if !ok {
		return fmt.Errorf("%q is not an optional package this application manages", name)
	}
	return b.runPip(ctx, python, sidecarDir, emit,
		fmt.Sprintf("installing %s (%s)", pkg.Name, pkg.Size),
		"-m", "pip", "install", pkg.Spec)
}

// RemoveOptional uninstalls one optional package.
//
// Offered because these are large: someone who tried the neural models and went
// back to the Random Forest should be able to reclaim the gigabytes without
// rebuilding the environment from scratch.
func (b *EnvBuilder) RemoveOptional(
	ctx context.Context,
	python, name, sidecarDir string,
	emit func(EnvSetupEvent),
) error {
	pkg, ok := findOptional(name)
	if !ok {
		return fmt.Errorf("%q is not an optional package this application manages", name)
	}
	// The companions go in the same command, so a removal is one pip run and
	// cannot half-succeed. pip ignores a name it does not find, which is what
	// makes this safe for an environment where only the pure-Python
	// distribution was ever installed.
	args := []string{"-m", "pip", "uninstall", "-y", pkg.Name}
	args = append(args, pkg.Also...)
	return b.runPip(ctx, python, sidecarDir, emit, "removing "+pkg.Name, args...)
}

func findOptional(name string) (OptionalPackage, bool) {
	for _, p := range OptionalPackages {
		if p.Name == name {
			return p, true
		}
	}
	return OptionalPackage{}, false
}

// runPip performs one pip operation under the build lock, reporting progress
// and re-inspecting the environment afterwards so the screen reflects reality
// rather than the assumption that pip did what it was asked.
func (b *EnvBuilder) runPip(
	ctx context.Context,
	python, sidecarDir string,
	emit func(EnvSetupEvent),
	what string,
	args ...string,
) error {
	b.mu.Lock()
	if b.running {
		b.mu.Unlock()
		return fmt.Errorf("an environment operation is already running")
	}
	ctx, cancel := context.WithCancel(ctx)
	b.cancel = cancel
	b.running = true
	b.mu.Unlock()

	defer func() {
		cancel()
		b.mu.Lock()
		b.running = false
		b.cancel = nil
		b.mu.Unlock()
	}()

	emit(EnvSetupEvent{Step: StepInstalling, Line: what})
	if err := runStreaming(ctx, emit, StepInstalling, python, args...); err != nil {
		emit(EnvSetupEvent{Step: StepFailed, Error: err.Error()})
		return err
	}

	// What the doctor says now, not what pip's exit status implies.
	emit(EnvSetupEvent{Step: StepVerifying, Line: "checking the environment"})
	report := InspectPython(ctx, python, sidecarDir)
	if report.Unreachable != "" {
		err := fmt.Errorf("the environment could not be inspected afterwards: %s",
			report.Unreachable)
		emit(EnvSetupEvent{Step: StepFailed, Error: err.Error()})
		return err
	}

	emit(EnvSetupEvent{Step: StepDone, Line: "done"})
	return nil
}

// runStreaming runs a command and reports every line it writes, on either
// stream, as it appears.
//
// Both streams are pumped because pip writes progress to stdout and warnings to
// stderr, and a user watching an install needs them interleaved in the order
// they happened to make sense of a failure.
func runStreaming(ctx context.Context, emit func(EnvSetupEvent), step EnvSetupStep,
	name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	// Unbuffered, or pip's output arrives in one block at the end and the
	// progress report is a blank pane followed by everything at once.
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PIP_DISABLE_PIP_VERSION_CHECK=1")
	if runtime.GOOS != "windows" {
		cmd.Env = append(cmd.Env, "PIP_NO_INPUT=1")
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var mu sync.Mutex
	var tail []string
	keepReason := func(line string) {
		mu.Lock()
		defer mu.Unlock()
		// The tail only: a pip failure ends with the reason, and the
		// hundred lines before it are resolution noise.
		tail = append(tail, line)
		if len(tail) > 8 {
			tail = tail[1:]
		}
	}

	var wg sync.WaitGroup
	pump := func(r io.Reader, keep bool) {
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimRight(sc.Text(), "\r")
			if line == "" {
				continue
			}
			emit(EnvSetupEvent{Step: step, Line: line})
			if keep {
				keepReason(line)
			}
		}
		// Scan stops on error as well as at EOF, and on this screen the two
		// looked identical: a line past the 1 MB cap ended the loop and pip's
		// log simply stopped, which reads as an install that went quiet rather
		// than one nobody is listening to any more. Said out loud, and kept for
		// the reason below in case the command fails too.
		if err := sc.Err(); err != nil {
			note := "output could not be read further: " + err.Error()
			emit(EnvSetupEvent{Step: step, Line: note})
			keepReason(note)
		}
		// Whatever ended the loop, the pipe still has to be emptied. A child
		// writing into a pipe nobody drains blocks in write, and the Wait below
		// would then be waiting on a process that is waiting on us.
		_, _ = io.Copy(io.Discard, r)
	}
	wg.Go(func() { pump(stdout, false) })
	wg.Go(func() { pump(stderr, true) })
	wg.Wait()

	// The exit status is the answer to whether pip did the work; the tail is
	// only the evidence. Returning the tail alone put whatever pip wrote last
	// -- a deprecation warning, a progress line -- in the place where the
	// failure belongs, and left a command that failed silently with no error
	// text at all.
	waitErr := cmd.Wait()
	if waitErr == nil {
		return nil
	}
	mu.Lock()
	reason := strings.Join(tail, " · ")
	mu.Unlock()
	if reason != "" {
		return fmt.Errorf("%w: %s", waitErr, reason)
	}
	return waitErr
}
