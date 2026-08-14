package backend

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"math"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// hasPyHelios reports whether the interpreter under test can import the
// optional 3D toolkit, so the refusal test can stand aside where there is
// nothing to refuse.
func hasPyHelios(t *testing.T, python string) bool {
	t.Helper()
	return exec.Command(python, "-c", "import pyhelios3d").Run() == nil
}

/*
The canopy field crosses the process boundary as a binary file and a JSON
document that describes it, and the two have to agree.

That is not a hypothetical pairing. The grid is written by numpy into the work
dir and read back by Go from a path, so the only thing tying the bytes to their
shape is the meta the same payload carries. A field whose dimensions were
reported for one grid and whose bytes came from another would upload to a
texture without error and render a canopy rotated into its own depth axis --
plausible looking, and wrong at every point. The size check in BuildCanopyField
is what refuses that, and this is what proves the check runs against the real
sidecar rather than against a hand-written fixture.

Runs the real binary, like TestDomainShiftStandardisesOverTheRealSidecar.
*/
func TestCanopyFieldOverTheRealSidecar(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	const spacing, lai, cell = 6.0, 2.0, 0.30
	field, err := r.BuildCanopyField(ctx, CanopyFieldRequest{
		Source: "ellipsoid", Spacing: spacing, LAI: lai, Cell: cell,
		CrownA: 1.8, CrownB: 1.2, CrownZ: 1.6,
	})
	if err != nil {
		t.Fatal(err)
	}

	if field.Field.Source != "ellipsoid" {
		t.Errorf("source = %q, want ellipsoid -- a surface reporting numbers from "+
			"the coarser crowns has to be able to say so", field.Field.Source)
	}

	// 6 m at 30 cm is 20 cells across; 1.6 + 1.2 = 2.8 m of canopy is 10 deep.
	if field.Field.NXY != 20 || field.Field.NZ != 10 {
		t.Errorf("grid is %dx%dx%d, want 20x20x10",
			field.Field.NXY, field.Field.NXY, field.Field.NZ)
	}

	grid, err := base64.StdEncoding.DecodeString(field.FieldBase64)
	if err != nil {
		t.Fatalf("field is not base64: %v", err)
	}
	cells := field.Field.NXY * field.Field.NXY * field.Field.NZ
	if len(grid) != cells*4 {
		t.Fatalf("field carries %d bytes for %d cells; the bytes and the shape "+
			"describing them disagree", len(grid), cells)
	}

	// Integrating the density back over the grid volume must return the leaf
	// area the request asked for. This is the invariant that survives the
	// binary hop: a truncated or byte-swapped transfer changes the sum.
	var total float64
	for i := 0; i < cells; i++ {
		v := math.Float32frombits(binary.LittleEndian.Uint32(grid[i*4:]))
		if v < 0 || math.IsNaN(float64(v)) {
			t.Fatalf("cell %d holds %v; a leaf area density is never negative or NaN", i, v)
		}
		total += float64(v)
	}
	gotArea := total * cell * cell * cell
	wantArea := lai * spacing * spacing
	if math.Abs(gotArea-wantArea) > 1e-6*wantArea {
		t.Errorf("integrating the field gives %.4f m2 of leaf, the request asked "+
			"for LAI %.1f over %.0f m2 = %.4f m2", gotArea, lai, spacing*spacing, wantArea)
	}

	// The crowns occupy part of the module, not all of it. Both bounds matter:
	// a field that came back empty would integrate to zero and be caught above,
	// but one that filled every cell would integrate correctly and still be a
	// uniform canopy rather than an orchard.
	if field.Field.Occupancy <= 0.02 || field.Field.Occupancy >= 0.9 {
		t.Errorf("occupancy %.3f -- the crowns either vanished or filled the module",
			field.Field.Occupancy)
	}

	if len(field.Reference.Suns) == 0 {
		t.Fatal("no reference suns; nothing could hold the shader to anything")
	}
	if field.Reference.Tolerance <= 0 {
		t.Error("the reference carries no tolerance, so a comparison against it " +
			"would have to invent one")
	}
	for _, sun := range field.Reference.Suns {
		if len(sun.Transmittance) != len(field.Reference.Points) {
			t.Errorf("sun cos z=%.2f carries %d transmittances for %d points",
				sun.CosZenith, len(sun.Transmittance), len(field.Reference.Points))
		}
		if len(sun.Direction) != 3 {
			t.Errorf("sun cos z=%.2f has a %d-component direction",
				sun.CosZenith, len(sun.Direction))
		}
		for i, tau := range sun.Transmittance {
			if tau < 0 || tau > 1 || math.IsNaN(tau) {
				t.Fatalf("sun cos z=%.2f point %d transmits %v", sun.CosZenith, i, tau)
			}
		}
	}

	// The orchard passes more light than a uniform canopy holding the same leaf
	// area, at every sun.
	//
	// This is a theorem rather than an observation, which is why it is worth
	// asserting: transmittance is exp(-x) in optical depth, exp is convex, so by
	// Jensen the mean over a canopy with gaps exceeds the value at the mean.
	// Concentrating leaf area into crowns can only raise mean transmittance.
	//
	// It is also the whole reason for voxelising anything. A model that
	// collapsed the field to its average -- which is what treating the orchard
	// as a slab of uniform LAI does -- would come out below this at every sun,
	// and the gap is not small: the ratios run from about 2 at an overhead sun
	// to over 13 at a low one.
	if len(field.AgainstUniform) != len(field.Reference.Suns) {
		t.Fatalf("%d comparisons against uniform for %d suns",
			len(field.AgainstUniform), len(field.Reference.Suns))
	}
	for _, cmp := range field.AgainstUniform {
		if !(cmp.Field > cmp.Uniform) {
			t.Errorf("cos z=%.2f: the field transmits %.4f and a uniform canopy of "+
				"the same leaf area transmits %.4f. Clumping cannot lower mean "+
				"transmittance, so one of the two is not what it claims to be",
				cmp.CosZenith, cmp.Field, cmp.Uniform)
		}
	}

	// The uniform null model IS monotonic in the sun angle, since its path
	// length is z_top/cos z and nothing else varies. The field is not, and that
	// is not a defect: an oblique ray through a clumped canopy can leave by the
	// gap between two crowns where a vertical one from the same point goes
	// straight through the crown above it. Asserting monotonicity of the field
	// would encode a uniform-medium intuition into a test of the thing that
	// exists to break it.
	prev := math.Inf(1)
	for _, cmp := range field.AgainstUniform {
		if cmp.Uniform > prev+1e-12 {
			t.Errorf("the uniform canopy transmits %.6f at cos z=%.2f, more than "+
				"at the higher sun before it (%.6f); its path is z_top/cos z and "+
				"can only lengthen", cmp.Uniform, cmp.CosZenith, prev)
		}
		prev = cmp.Uniform
	}
}

/*
A field the shader could not hold is refused with its dimensions named.

Reaching maxCanopyFieldCells means the cell size is wrong for the module, and
the arithmetic that says so is cheap. Left unchecked the failure is an
allocation in the webview, which reports nothing a user could act on.
*/
func TestCanopyFieldRefusesAGridTooLargeToCarry(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	// 40 m at 1 cm is 4000 cells across, so 4000 x 4000 x 400 cells.
	_, err = r.BuildCanopyField(ctx, CanopyFieldRequest{
		Source: "ellipsoid", Spacing: 40, LAI: 2, Cell: 0.01,
		CrownA: 3, CrownB: 2, CrownZ: 2,
	})
	if err == nil {
		t.Fatal("a 4000x4000x400 field was accepted")
	}
	t.Logf("refused, as it should be: %v", err)
}

/*
Asking for Helios without Helios states which package is missing.

The torch features in this repository do the opposite: they import inside a
function nothing wraps, so the user gets `sidecar failed: exit status 1` with a
traceback scrolling past in the progress line. That shape is what this action
was written to avoid, and an assertion is the only thing that stops it drifting
back -- the code that produces the good message and the code that produces the
bad one look equally reasonable.

Skipped where pyhelios3d is actually installed, since then there is nothing to
refuse.
*/
func TestCanopyFieldNamesTheMissingPackage(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))

	if hasPyHelios(t, py) {
		t.Skip("pyhelios3d is installed in this interpreter; nothing to refuse")
	}

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	_, err = r.BuildCanopyField(ctx, CanopyFieldRequest{Source: "helios"})
	if err == nil {
		t.Fatal("growing a plant succeeded without pyhelios3d")
	}
	msg := err.Error()
	for _, want := range []string{"pyhelios3d", "Settings"} {
		if !strings.Contains(msg, want) {
			t.Errorf("the refusal does not mention %q, so it does not say what to "+
				"do about it: %s", want, msg)
		}
	}
	if strings.Contains(msg, "exit status") || strings.Contains(msg, "Traceback") {
		t.Errorf("the refusal leaked the process failure instead of the reason: %s", msg)
	}
}
