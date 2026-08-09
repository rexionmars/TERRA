package backend

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestVersionAtLeast(t *testing.T) {
	floor := []int{3, 12}
	cases := []struct {
		got  []int
		want bool
	}{
		{[]int{3, 12}, true},
		{[]int{3, 13}, true},
		// The one a string comparison gets wrong: "3.9" > "3.12" lexically.
		{[]int{3, 9}, false},
		{[]int{2, 7}, false},
		{[]int{4, 0}, true},
		{[]int{3, 12, 7}, true},
		// Too short to decide, so it cannot be said to clear the floor.
		{[]int{3}, false},
	}
	for _, c := range cases {
		if got := versionAtLeast(c.got, floor); got != c.want {
			t.Errorf("versionAtLeast(%v, %v) = %v, want %v",
				c.got, floor, got, c.want)
		}
	}
}

/*
The floor here has to be the floor doctor.py enforces.

Two files decide the same thing for different reasons: this one refuses to
start a build, the doctor refuses to call the result usable. Lower here and a
build runs for minutes to reach a verification that was always going to reject
it; higher and it refuses an interpreter that would have worked. Neither shows
up in any other test, because each file is self-consistent.
*/
func TestMinPythonMatchesDoctor(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate the test file")
	}
	doctor := filepath.Join(filepath.Dir(filepath.Dir(thisFile)), "sidecar", "doctor.py")
	raw, err := os.ReadFile(doctor)
	if err != nil {
		t.Fatalf("reading %s: %v", doctor, err)
	}

	m := regexp.MustCompile(`(?m)^MIN_PYTHON\s*=\s*\((\d+),\s*(\d+)\)`).FindSubmatch(raw)
	if m == nil {
		t.Fatal("MIN_PYTHON not found in doctor.py; if it was renamed, this " +
			"guard has to follow it rather than be deleted")
	}
	major, _ := strconv.Atoi(string(m[1]))
	minor, _ := strconv.Atoi(string(m[2]))

	want := []int{major, minor}
	if len(minPython) != len(want) || minPython[0] != want[0] || minPython[1] != want[1] {
		t.Errorf("minPython is %v and doctor.py MIN_PYTHON is %v; they decide "+
			"the same thing and have drifted", minPython, want)
	}
}

// TestBuildRefusesOldPythonBeforeTouchingAnything checks that the version gate
// runs before the build removes a previous environment.
//
// The order is the point. Asked after the removal, a user on an unsuitable
// interpreter would lose a working environment to a build that then failed --
// turning a refusal into a regression.
func TestBuildRefusesOldPythonBeforeTouchingAnything(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell stub is POSIX")
	}
	dir := t.TempDir()

	py := filepath.Join(dir, "python")
	// Reports 3.9, which is under the floor.
	stub := "#!/bin/sh\necho 3.9\n"
	if err := os.WriteFile(py, []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}

	// An existing environment that must survive a refused build.
	envDir := filepath.Join(dir, "python-env")
	if err := os.MkdirAll(envDir, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(envDir, "keep-me")
	if err := os.WriteFile(marker, []byte("previous environment"), 0o600); err != nil {
		t.Fatal(err)
	}

	var b EnvBuilder
	var steps []EnvSetupStep
	_, err := b.Build(context.Background(), py, envDir, "numpy\n", dir,
		func(ev EnvSetupEvent) { steps = append(steps, ev.Step) })

	if err == nil {
		t.Fatal("expected a build on Python 3.9 to be refused")
	}
	if !strings.Contains(err.Error(), "3.12") {
		t.Errorf("the error should name the version required, got: %v", err)
	}
	if _, statErr := os.Stat(marker); statErr != nil {
		t.Error("the previous environment was removed by a build that was refused")
	}
	for _, s := range steps {
		if s == StepCreatingVenv {
			t.Error("the build started creating a venv before checking the version")
		}
	}
}
