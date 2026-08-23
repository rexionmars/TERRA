package pyenv

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
The optional-package path, driven against a stand-in for the interpreter.

The seam is that InstallOptional, RemoveOptional and runPip all take the
interpreter as a parameter and hand it to runStreaming unchanged. A shell
script in the same position prints chosen lines on both streams, exits with a
chosen status, and records the argv it was given -- which is every question
these tests ask, with no pip and no network. The doctor call that follows a pip
run lands in the same script, told apart by its first argument.
*/

// requireShellStub skips on the one platform where a /bin/sh script is not an
// executable program.
func requireShellStub(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the interpreter stand-in is a POSIX shell script")
	}
}

/*
writePythonStub installs an executable stand-in for an interpreter and returns
its path.

subs are replacement pairs applied to the script, so a test can name the
temporary files it wants the stub to write without fighting printf's own
formatting verbs.
*/
func writePythonStub(t *testing.T, dir, script string, subs ...string) string {
	t.Helper()
	if len(subs)%2 != 0 {
		t.Fatalf("writePythonStub: %d substitution arguments, want pairs", len(subs))
	}
	body := "#!/bin/sh\n" + strings.NewReplacer(subs...).Replace(script)
	path := filepath.Join(dir, "python-stub")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("writing the interpreter stand-in at %s: %v", path, err)
	}
	return path
}

// sidecarWithDoctor makes a directory InspectPython will accept. The file is
// empty because the stub answers for it; InspectPython only stats it.
func sidecarWithDoctor(t *testing.T, dir string) string {
	t.Helper()
	sidecar := filepath.Join(dir, "sidecar")
	if err := os.MkdirAll(sidecar, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sidecar, "doctor.py"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	return sidecar
}

/*
recordedEvents collects what a run reported.

Guarded, because runStreaming pumps stdout and stderr in two goroutines and
calls emit from both of them. An unsynchronised collector here would fail
under -race for a reason belonging to the test rather than to the code, and
would hide any real finding behind it.
*/
type recordedEvents struct {
	mu     sync.Mutex
	steps  []EnvSetupStep
	lines  []string
	errors []string
}

func (r *recordedEvents) emit(ev EnvSetupEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps = append(r.steps, ev.Step)
	if ev.Line != "" {
		r.lines = append(r.lines, ev.Line)
	}
	if ev.Error != "" {
		r.errors = append(r.errors, ev.Error)
	}
}

func (r *recordedEvents) hasStep(want EnvSetupStep) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.steps {
		if s == want {
			return true
		}
	}
	return false
}

func (r *recordedEvents) hasLine(want string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, l := range r.lines {
		if strings.Contains(l, want) {
			return true
		}
	}
	return false
}

func (r *recordedEvents) joined() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.lines, "\n")
}

func (r *recordedEvents) errorCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.errors)
}

// assertNotRunning checks the builder released the flag, which decides whether
// the next operation is allowed to start at all.
func assertNotRunning(t *testing.T, b *EnvBuilder) {
	t.Helper()
	if b.Running() {
		t.Error("the builder still reports a run in flight after it returned")
	}
}

func readTrimmed(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return strings.TrimSpace(string(raw))
}

// waitForFile blocks until the stub says it reached a chosen point, so the
// concurrency tests act on a run that has demonstrably started rather than on
// a guess about scheduling.
func waitForFile(t *testing.T, path string, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("%s did not appear within %s; the stand-in never started", path, within)
}

/*
The name of the package reaches these from the frontend, so anything not on
the list has to be refused before it can be pasted into a pip command line.
The refusal also has to happen without taking the run flag, or one bad name
would leave the builder claiming a run that never started.
*/
func TestOptionalPackageOperationsRefuseAnUnlistedName(t *testing.T) {
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	// A path with a shell metacharacter, since the argument reaches exec: if
	// the guard is ever removed this is what would be handed to pip.
	name := "torch; rm -rf /"

	for _, c := range []struct {
		label string
		run   func(*EnvBuilder, func(EnvSetupEvent)) error
	}{
		{"install", func(b *EnvBuilder, emit func(EnvSetupEvent)) error {
			return b.InstallOptional(context.Background(), "/nonexistent/python", name, sidecar, emit)
		}},
		{"remove", func(b *EnvBuilder, emit func(EnvSetupEvent)) error {
			return b.RemoveOptional(context.Background(), "/nonexistent/python", name, sidecar, emit)
		}},
	} {
		t.Run(c.label, func(t *testing.T) {
			var b EnvBuilder
			var ev recordedEvents
			err := c.run(&b, ev.emit)
			if err == nil {
				t.Fatalf("%q was accepted as an optional package", name)
			}
			if !strings.Contains(err.Error(), "not an optional package") {
				t.Errorf("the refusal should say the name is not managed, got: %v", err)
			}
			if got := ev.joined(); got != "" {
				t.Errorf("a refused name reported progress: %q", got)
			}
			assertNotRunning(t, &b)
		})
	}
}

// findOptional is what that refusal rests on, and it matches on Name rather
// than on Spec: "torch>=2.1" is what pip installs, "torch" is what the caller
// asks for and what pip uninstalls.
func TestFindOptionalMatchesTheDistributionName(t *testing.T) {
	pkg, ok := findOptional("torch")
	if !ok {
		t.Fatal("torch is listed in OptionalPackages but findOptional missed it")
	}
	if pkg.Spec != "torch>=2.1" {
		t.Errorf("spec = %q, want the constrained form pip installs", pkg.Spec)
	}
	if _, ok := findOptional("torch>=2.1"); ok {
		t.Error("the spec matched as a name; the frontend sends names, and " +
			"accepting a spec would let a version constraint through the guard")
	}
	if _, ok := findOptional(""); ok {
		t.Error("the empty name matched a package")
	}
}

/*
The whole successful path: both output streams reach the caller as they are
produced, the spec pip is given is the constrained one, and the doctor runs
afterwards rather than the exit status being taken as proof.
*/
func TestInstallOptionalStreamsBothPipeStreamsAndThenInspects(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	argvLog := filepath.Join(dir, "pip-argv")
	doctorLog := filepath.Join(dir, "doctor-ran")

	python := writePythonStub(t, dir, `
if [ "$1" = "-m" ]; then
  printf '%s\n' "$*" > {{argv}}
  echo "unbuffered=$PYTHONUNBUFFERED"
  echo "Collecting torch"
  echo "WARNING: a wheel was built from source" >&2
  echo "Successfully installed torch-2.4.0"
  exit 0
fi
printf '%s\n' "$*" > {{doctor}}
echo '{"python_version":"3.12.4","usable":true}'
`, "{{argv}}", argvLog, "{{doctor}}", doctorLog)

	var b EnvBuilder
	var ev recordedEvents
	if err := b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit); err != nil {
		t.Fatalf("the install reported a failure it was not given: %v", err)
	}

	if got := readTrimmed(t, argvLog); got != "-m pip install torch>=2.1" {
		t.Errorf("pip was asked to run %q, want the listed spec", got)
	}
	if got := readTrimmed(t, doctorLog); !strings.HasSuffix(got, "doctor.py") {
		t.Errorf("the doctor was run as %q, want sidecar/doctor.py", got)
	}

	// The size belongs in the first line, because it is the number that
	// decides whether someone leaves the window open.
	if !ev.hasLine("about 2-3 GB") {
		t.Errorf("the opening line did not name the download size:\n%s", ev.joined())
	}
	for _, want := range []string{
		"Collecting torch",                       // stdout
		"WARNING: a wheel was built from source", // stderr
		"Successfully installed torch-2.4.0",     // stdout again, after stderr
	} {
		if !ev.hasLine(want) {
			t.Errorf("%q never reached the caller:\n%s", want, ev.joined())
		}
	}
	// Without this the child buffers and the progress pane stays blank until
	// the install is over, which is the failure the environment exists to
	// prevent rather than an optimisation.
	if !ev.hasLine("unbuffered=1") {
		t.Errorf("PYTHONUNBUFFERED did not reach the child:\n%s", ev.joined())
	}

	for _, step := range []EnvSetupStep{StepInstalling, StepVerifying, StepDone} {
		if !ev.hasStep(step) {
			t.Errorf("step %q was never reported", step)
		}
	}
	if ev.hasStep(StepFailed) {
		t.Error("a successful install reported StepFailed")
	}
	if ev.errorCount() != 0 {
		t.Error("a successful install carried an error field")
	}
	assertNotRunning(t, &b)
}

// The version constraint installs but must not be passed to the uninstall:
// pip rejects a requirement specifier there, so a run that reclaimed the disk
// space would instead fail on its own argument.
func TestRemoveOptionalUninstallsTheBareName(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	argvLog := filepath.Join(dir, "pip-argv")

	python := writePythonStub(t, dir, `
if [ "$1" = "-m" ]; then
  printf '%s\n' "$*" > {{argv}}
  echo "Successfully uninstalled torch-2.4.0"
  exit 0
fi
echo '{"python_version":"3.12.4","usable":true}'
`, "{{argv}}", argvLog)

	var b EnvBuilder
	var ev recordedEvents
	if err := b.RemoveOptional(context.Background(), python, "torch", sidecar, ev.emit); err != nil {
		t.Fatalf("the removal reported a failure it was not given: %v", err)
	}

	got := readTrimmed(t, argvLog)
	if got != "-m pip uninstall -y torch" {
		t.Errorf("pip was asked to run %q, want the bare name and -y", got)
	}
	// -y matters on its own: pip's confirmation prompt on a pipe nobody is
	// typing into is a run that never ends.
	if !strings.Contains(got, " -y ") {
		t.Error("the uninstall would wait for a confirmation nobody can give")
	}
	if !ev.hasStep(StepDone) {
		t.Errorf("the removal never reported completion:\n%s", ev.joined())
	}
	assertNotRunning(t, &b)
}

/*
A failing pip has to be reported by its exit status, with the tail of stderr as
evidence rather than in place of it, and must not be followed by a verification
that would describe the environment as though the work had been done.
*/
func TestRunPipFailureCarriesTheStatusAndTheLastStderrLines(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	doctorLog := filepath.Join(dir, "doctor-ran")

	// Twelve lines against a tail of eight: 01 through 04 are dropped.
	python := writePythonStub(t, dir, `
if [ "$1" = "-m" ]; then
  i=1
  while [ $i -le 12 ]; do
    printf 'stderr-%02d\n' $i >&2
    i=$((i+1))
  done
  exit 3
fi
printf '%s\n' "$*" > {{doctor}}
echo '{"python_version":"3.12.4","usable":true}'
`, "{{doctor}}", doctorLog)

	var b EnvBuilder
	var ev recordedEvents
	err := b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit)
	if err == nil {
		t.Fatal("pip exited 3 and the install reported success")
	}

	if !strings.Contains(err.Error(), "exit status 3") {
		t.Errorf("the error dropped the exit status, which is the answer to "+
			"whether pip did the work; got: %v", err)
	}
	if !strings.Contains(err.Error(), "stderr-12") {
		t.Errorf("the last line pip wrote is missing from the error: %v", err)
	}
	if !strings.Contains(err.Error(), "stderr-05") {
		t.Errorf("the error kept fewer than the eight lines of tail: %v", err)
	}
	if strings.Contains(err.Error(), "stderr-04") {
		t.Errorf("the error carried more than the tail, so a long resolution "+
			"log would bury the reason: %v", err)
	}

	// Every line still reaches the screen; only the error text is trimmed.
	if !ev.hasLine("stderr-01") {
		t.Errorf("the earlier output never reached the caller:\n%s", ev.joined())
	}
	if !ev.hasStep(StepFailed) || ev.errorCount() == 0 {
		t.Error("the failure was not reported on the progress channel")
	}
	if _, statErr := os.Stat(doctorLog); statErr == nil {
		t.Error("the environment was inspected after pip failed, which would " +
			"describe it as though the install had happened")
	}
	assertNotRunning(t, &b)
}

// pip exiting zero is not the end of the operation: if the interpreter cannot
// be inspected afterwards, the screen would otherwise show a state nobody
// verified.
func TestRunPipFailsWhenTheEnvironmentCannotBeInspectedAfterwards(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	// No doctor.py, so InspectPython reports Unreachable rather than an
	// unusable environment. The two are different answers and this is the one
	// runPip has to surface.
	sidecar := filepath.Join(dir, "sidecar")
	if err := os.MkdirAll(sidecar, 0o700); err != nil {
		t.Fatal(err)
	}

	python := writePythonStub(t, dir, `
echo "Successfully installed torch-2.4.0"
exit 0
`)

	var b EnvBuilder
	var ev recordedEvents
	err := b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit)
	if err == nil {
		t.Fatal("an uninspectable environment was reported as a finished install")
	}
	if !strings.Contains(err.Error(), "could not be inspected") {
		t.Errorf("the error should name the inspection, got: %v", err)
	}
	if !ev.hasStep(StepVerifying) {
		t.Error("the verification step was never announced")
	}
	if ev.hasStep(StepDone) {
		t.Error("the run reported completion after failing to inspect")
	}
	if !ev.hasStep(StepFailed) {
		t.Error("the failure was not reported on the progress channel")
	}
	assertNotRunning(t, &b)
}

// blockingStub is an interpreter stand-in that announces it started, then
// waits for a file before exiting, so a test can hold the run flag for as long
// as it needs to and let go deterministically.
const blockingStub = `
if [ "$1" = "-m" ]; then
  echo run >> {{count}}
  echo started > {{started}}
  echo "Collecting torch"
  i=0
  while [ ! -f {{release}} ] && [ $i -lt 600 ]; do
    sleep 0.05 2>/dev/null || sleep 1
    i=$((i+1))
  done
  exit 0
fi
echo '{"python_version":"3.12.4","usable":true}'
`

/*
Two operations must not run pip into one environment at once.

runPip takes the same flag Build takes, so an install, a removal and a build
exclude each other. Nothing else in this package drives that flag from more
than one goroutine, which means -race has never had the chance to see it: this
test is what makes a clean race run evidence about this protocol rather than
about a path no test walks concurrently.
*/
func TestConcurrentOptionalOperationsAdmitExactlyOne(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	countPath := filepath.Join(dir, "pip-runs")
	startedPath := filepath.Join(dir, "started")
	releasePath := filepath.Join(dir, "release")

	python := writePythonStub(t, dir, blockingStub,
		"{{count}}", countPath, "{{started}}", startedPath, "{{release}}", releasePath)

	// The holder is released whatever the test does, so a failed assertion
	// ends the run instead of waiting out the stub's own limit.
	t.Cleanup(func() { _ = os.WriteFile(releasePath, []byte("go"), 0o600) })

	var b EnvBuilder
	var holder recordedEvents
	var holderErr error
	var holderDone sync.WaitGroup
	holderDone.Add(1)
	go func() {
		defer holderDone.Done()
		holderErr = b.InstallOptional(context.Background(), python, "torch", sidecar, holder.emit)
	}()

	// Past this point the flag is held: runPip sets it under the mutex before
	// the process starts, so the marker cannot exist while it is false.
	waitForFile(t, startedPath, 20*time.Second)
	if !b.Running() {
		t.Error("a pip operation is in flight and Running() says otherwise")
	}

	const contenders = 4
	errs := make([]error, contenders)
	var tried sync.WaitGroup
	for i := range contenders {
		tried.Add(1)
		go func() {
			defer tried.Done()
			var ev recordedEvents
			// Alternated so the removal path is contended too; both reach the
			// same guard.
			if i%2 == 0 {
				errs[i] = b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit)
				return
			}
			errs[i] = b.RemoveOptional(context.Background(), python, "torch", sidecar, ev.emit)
		}()
	}
	tried.Wait()

	for i, err := range errs {
		if err == nil {
			t.Fatalf("contender %d ran pip into an environment already being written", i)
		}
		if !strings.Contains(err.Error(), "already running") {
			t.Errorf("contender %d was refused for the wrong reason: %v", i, err)
		}
	}

	if err := os.WriteFile(releasePath, []byte("go"), 0o600); err != nil {
		t.Fatal(err)
	}
	holderDone.Wait()

	if holderErr != nil {
		t.Errorf("the operation that held the flag failed: %v", holderErr)
	}
	if runs := strings.Count(readTrimmed(t, countPath), "run"); runs != 1 {
		t.Errorf("pip started %d times against one environment, want 1", runs)
	}
	assertNotRunning(t, &b)
}

// The same flag is what a build takes, so a pip operation in flight has to
// refuse a build as well -- otherwise venv would be recreating the directory
// pip is writing into.
func TestBuildIsRefusedWhileAPipOperationHoldsTheFlag(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	countPath := filepath.Join(dir, "pip-runs")
	startedPath := filepath.Join(dir, "started")
	releasePath := filepath.Join(dir, "release")

	python := writePythonStub(t, dir, blockingStub,
		"{{count}}", countPath, "{{started}}", startedPath, "{{release}}", releasePath)
	t.Cleanup(func() { _ = os.WriteFile(releasePath, []byte("go"), 0o600) })

	var b EnvBuilder
	var holder recordedEvents
	var holderDone sync.WaitGroup
	holderDone.Add(1)
	go func() {
		defer holderDone.Done()
		_ = b.InstallOptional(context.Background(), python, "torch", sidecar, holder.emit)
	}()
	waitForFile(t, startedPath, 20*time.Second)

	envDir := filepath.Join(dir, "python-env")
	var buildEv recordedEvents
	buildDone := make(chan error, 1)
	go func() {
		_, err := b.Build(context.Background(), python, envDir, "numpy\n", sidecar, buildEv.emit)
		buildDone <- err
	}()

	select {
	case err := <-buildDone:
		if err == nil {
			t.Fatal("a build started while pip was writing into the environment")
		}
		if !strings.Contains(err.Error(), "already running") {
			t.Errorf("the build was refused for the wrong reason: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the build neither started nor was refused")
	}
	if _, err := os.Stat(envDir); err == nil {
		t.Error("the refused build created the environment directory anyway")
	}

	if err := os.WriteFile(releasePath, []byte("go"), 0o600); err != nil {
		t.Fatal(err)
	}
	holderDone.Wait()
	assertNotRunning(t, &b)
}

// Cancel reaches whichever operation holds the flag, so the button that stops
// a build stops a multi-gigabyte download too.
func TestCancelStopsAPipOperationInFlight(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	countPath := filepath.Join(dir, "pip-runs")
	startedPath := filepath.Join(dir, "started")
	// Never written: the run ends by being cancelled, not by being released.
	releasePath := filepath.Join(dir, "release")

	python := writePythonStub(t, dir, blockingStub,
		"{{count}}", countPath, "{{started}}", startedPath, "{{release}}", releasePath)

	var b EnvBuilder
	var ev recordedEvents
	done := make(chan error, 1)
	go func() {
		done <- b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit)
	}()

	waitForFile(t, startedPath, 20*time.Second)
	b.Cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("a cancelled pip operation reported success")
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the operation outlived its cancellation")
	}

	if !ev.hasStep(StepFailed) {
		t.Errorf("the cancellation was never reported on the progress channel:\n%s",
			ev.joined())
	}
	if ev.hasStep(StepDone) {
		t.Error("a cancelled operation reported completion")
	}
	// The flag has to come back, or the cancel would leave the application
	// refusing every operation until it is restarted.
	assertNotRunning(t, &b)

	// A second cancel with nothing in flight is what the button does when the
	// run has already ended, and must not panic on the nil func.
	b.Cancel()
}

/*
A line longer than the scanner's cap ends the read, and the run has to say so.

Silence here was indistinguishable from an install that had gone quiet: the
loop stopped, pip's log stopped with it, and the process carried on writing
into a pipe. The note is the only thing that tells the two apart, and the
drain afterwards is what keeps the child from blocking on a full pipe while
Wait blocks on the child.
*/
func TestRunStreamingSaysSoWhenOutputCannotBeReadFurther(t *testing.T) {
	requireShellStub(t)
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)

	// One line of 1.5 MB against a 1 MB cap, then more output behind it, so
	// the drain has something left to consume.
	python := writePythonStub(t, dir, `
if [ "$1" = "-m" ]; then
  { head -c 1572864 /dev/zero | tr '\0' x; echo; } >&2
  echo "Successfully installed torch-2.4.0" >&2
  exit 0
fi
echo '{"python_version":"3.12.4","usable":true}'
`)

	var b EnvBuilder
	var ev recordedEvents
	if err := b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit); err != nil {
		t.Fatalf("the run failed although pip exited zero: %v", err)
	}
	if !ev.hasLine("output could not be read further") {
		t.Errorf("the read stopped without saying so, which reads as an "+
			"install nobody is listening to:\n%s", ev.joined())
	}
	if !ev.hasStep(StepDone) {
		t.Error("the run never completed; the child may have blocked writing " +
			"into a pipe nobody drained")
	}
	assertNotRunning(t, &b)
}

// An interpreter that cannot be started at all fails before any output
// exists, so the error has to come from exec rather than from the tail of a
// log that was never written.
func TestInstallOptionalReportsAnInterpreterThatCannotBeStarted(t *testing.T) {
	dir := t.TempDir()
	sidecar := sidecarWithDoctor(t, dir)
	python := filepath.Join(dir, "absent-python")

	var b EnvBuilder
	var ev recordedEvents
	err := b.InstallOptional(context.Background(), python, "torch", sidecar, ev.emit)
	if err == nil {
		t.Fatal("an install ran with an interpreter that does not exist")
	}
	if !strings.Contains(err.Error(), python) {
		t.Errorf("the error does not name the interpreter that could not be "+
			"started: %v", err)
	}
	if !ev.hasStep(StepFailed) || ev.errorCount() == 0 {
		t.Error("the failure was not reported on the progress channel")
	}
	if ev.hasStep(StepVerifying) {
		t.Error("the environment was inspected after pip never ran")
	}
	assertNotRunning(t, &b)
}
