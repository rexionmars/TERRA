package backend

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestInspectPythonReadsTheDoctor checks the one thing the old probe did not:
// that the answer describes the ENVIRONMENT and not just the interpreter.
//
// A fake doctor is used rather than the real one so the test does not depend on
// what happens to be installed on the machine running it -- which is the exact
// failure this whole feature exists to remove.
func TestInspectPythonReadsTheDoctor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell stub is POSIX")
	}
	dir := t.TempDir()

	// A doctor that reports a missing required package.
	doctor := filepath.Join(dir, "doctor.py")
	if err := os.WriteFile(doctor, []byte("ignored by the stub interpreter\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	py := filepath.Join(dir, "python")
	stub := `#!/bin/sh
cat <<'JSON'
{"executable":"/stub","python_version":"3.12.7","python_ok":true,
 "min_python":"3.12","usable":false,
 "packages":[
  {"module":"numpy","distribution":"numpy","blocks":"every product",
   "optional":false,"present":true,"version":"2.3.5"},
  {"module":"pvlib","distribution":"pvlib","blocks":"the photovoltaic model",
   "optional":false,"present":false},
  {"module":"pyarrow","distribution":"pyarrow","blocks":"the POWER cache",
   "optional":true,"present":false}]}
JSON
`
	if err := os.WriteFile(py, []byte(stub), 0o700); err != nil {
		t.Fatal(err)
	}

	rep := InspectPython(context.Background(), py, dir)
	if rep.Unreachable != "" {
		t.Fatalf("unreachable: %s", rep.Unreachable)
	}
	if rep.Usable {
		t.Fatal("reported usable while a required package is missing")
	}
	if rep.PythonVersion != "3.12.7" {
		t.Fatalf("python_version=%q", rep.PythonVersion)
	}
	// The optional gap must not be counted as blocking: pyarrow missing costs
	// the cache, it does not stop a run.
	missing := rep.MissingRequired()
	if len(missing) != 1 || missing[0].Distribution != "pvlib" {
		t.Fatalf("MissingRequired=%v, want only pvlib", missing)
	}
	if rep.Executable != py {
		t.Fatalf("Executable=%q, want the path we asked about", rep.Executable)
	}
}

// TestInspectPythonSurvivesABadInterpreter keeps one broken candidate from
// costing the whole listing.
//
// The setup screen lists every interpreter it found; a path that no longer
// exists, or one that is not executable, has to appear as unreachable rather
// than aborting the enumeration around it.
func TestInspectPythonSurvivesABadInterpreter(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doctor.py"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	rep := InspectPython(context.Background(), filepath.Join(dir, "no-such-python"), dir)
	if rep.Unreachable == "" {
		t.Fatal("a missing interpreter reported no problem")
	}
	if rep.Usable {
		t.Fatal("a missing interpreter reported usable")
	}
}

// TestInspectPythonReportsAMissingDoctor separates two failures that look alike
// from the outside: an interpreter that cannot be run, and an application whose
// own sidecar is not where it should be.
func TestInspectPythonReportsAMissingDoctor(t *testing.T) {
	rep := InspectPython(context.Background(), "python3", t.TempDir())
	if rep.Unreachable == "" {
		t.Fatal("a missing doctor.py reported no problem")
	}
}

// TestDiscoverPythonsDeduplicatesSymlinks guards the rule that makes the list
// readable. Homebrew, pyenv and the macOS stubs are all symlink farms, so the
// same interpreter is reachable under several names; listed once per name the
// user is asked to choose between four spellings of one file.
func TestDiscoverPythonsDeduplicatesSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	root := t.TempDir()

	// A managed venv holding the real binary...
	managed := filepath.Join(root, "managed")
	if err := os.MkdirAll(filepath.Join(managed, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(managed, "bin", "python")
	if err := os.WriteFile(real, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}

	// ...and a repo venv that is only a link to it.
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(repo, ".venv", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, filepath.Join(repo, ".venv", "bin", "python")); err != nil {
		t.Fatal(err)
	}

	got := DiscoverPythons("", managed, repo)
	count := 0
	for _, c := range got {
		if c.Origin == "managed" || c.Origin == "venv" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("one file listed %d times: %+v", count, got)
	}
	if len(got) > 0 && got[0].Origin != "managed" {
		t.Fatalf("first candidate is %q; the managed environment is the one the "+
			"application can repair and must be offered first", got[0].Origin)
	}
}
