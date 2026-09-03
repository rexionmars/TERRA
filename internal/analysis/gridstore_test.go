package analysis

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

/*
The store probe against whatever this machine actually has.

BOTH OUTCOMES ARE THE PRODUCT. A reachable store must report what it holds; an
unreachable one must report WHY, as a string, without returning an error. The
second is the case the environment screen exists for, and it is the one a
returned error would turn into a toast that disappears.

Not skipped when there is no database: the unreachable path is exercised
instead, which is the half that has no other test.
*/
func TestInspectGridStoreReportsEitherContentsOrAReason(t *testing.T) {
	py := findPythonWithPsycopg(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", root+"/..")

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	got := r.InspectGridStore(ctx, "")
	if got == nil {
		t.Fatal("InspectGridStore returned nil, which no caller checks for")
	}

	if !got.Reachable {
		// The half that must never be silent. A user reading this needs a
		// sentence, not an empty panel.
		if got.Unreachable == "" {
			t.Fatal("store is unreachable and said nothing about why")
		}
		if got.Coverage != nil {
			t.Fatal("unreachable store still returned coverage")
		}
		t.Logf("store unreachable, as reported: %s", got.Unreachable)
		return
	}

	if got.Coverage == nil {
		t.Fatal("store is reachable but returned no coverage")
	}
	if len(got.Coverage.Datasets) == 0 {
		t.Fatal("store is reachable and holds no dataset; the schema exists but nothing was loaded")
	}
	for _, d := range got.Coverage.Datasets {
		if d.Dataset == "" || d.Periods <= 0 || d.Rows <= 0 {
			t.Fatalf("dataset row is not usable: %+v", d)
		}
		if d.From == "" || d.To == "" {
			t.Fatalf("dataset %q reports no span, so no run can say what window it read", d.Dataset)
		}
	}
	// Geometry is what the AOI join needs, and it is a strict subset of the
	// register: reporting more located plants than registered ones would mean
	// the two counts came from different questions.
	if got.Coverage.Plants.WithGeometry > got.Coverage.Plants.Registered {
		t.Fatalf("located plants (%d) exceed registered (%d)",
			got.Coverage.Plants.WithGeometry, got.Coverage.Plants.Registered)
	}
	t.Logf("store holds %d datasets, %d plants (%d located), %d substations",
		len(got.Coverage.Datasets), got.Coverage.Plants.Registered,
		got.Coverage.Plants.WithGeometry, got.Coverage.Network.Substations)
}

// A DSN nothing is listening on has to come back as a sentence rather than as
// an error, because that is the shape the settings screen renders.
func TestInspectGridStoreTurnsARefusedConnectionIntoAReason(t *testing.T) {
	py := findPythonWithPsycopg(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", root+"/..")
	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	got := r.InspectGridStore(ctx, "postgresql://127.0.0.1:1/terra_nothing_here")
	if got.Reachable {
		t.Fatal("a database on port 1 reported itself reachable")
	}
	if got.Unreachable == "" {
		t.Fatal("a refused connection produced no reason")
	}
	t.Logf("refusal reported as: %s", got.Unreachable)
}

/*
findPythonWithPsycopg locates an interpreter that can actually reach a store.

findPython accepts anything that imports numpy, which on this machine resolves a
bare virtualenv carrying neither pvlib nor psycopg. Probing the store with it
reports "psycopg is not installed" -- true of that interpreter, and nothing at
all about whether the database is there. The reachable half of this file needs
an interpreter that can get past the driver, so it looks for one and skips when
there is none rather than asserting against a message that was never about the
store.
*/
func findPythonWithPsycopg(t *testing.T) string {
	t.Helper()
	py := findPython(t)
	candidates := []string{py}
	if root, err := filepath.Abs(repoRoot(t)); err == nil {
		candidates = append(candidates, filepath.Join(root, ".venv", "bin", "python"))
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if err := exec.Command(c, "-c", "import psycopg").Run(); err == nil {
			return c
		}
	}
	t.Skip("no interpreter here imports psycopg; the store cannot be reached from any of them")
	return ""
}
