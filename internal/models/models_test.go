package models

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
)

// writePackage writes a feature_rf package of small files into dir, with a
// manifest that describes them truly, and returns the manifest.
func writePackage(t *testing.T, dir, version string) analysis.ModelManifest {
	t.Helper()
	files := map[string]analysis.ModelFile{}
	for _, role := range []string{"model", "scaler", "label_encoder", "feature_names"} {
		data := []byte(role + "-" + version)
		name := role + ".bin"
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		files[role] = analysis.ModelFile{Name: name, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	}
	m := analysis.ModelManifest{
		Format: 1, ID: "test-rf", Version: version, Name: "Test RF",
		Family: "feature_rf", Classes: []int{3, 21}, Files: files,
	}
	writeManifest(t, dir, m)
	return m
}

func writeManifest(t *testing.T, dir string, m analysis.ModelManifest) {
	t.Helper()
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, manifestName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// zipDir packs dir's files into a zip, under prefix inside the archive.
func zipDir(t *testing.T, dir, prefix string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "pkg.zip")
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		data, _ := os.ReadFile(filepath.Join(dir, e.Name()))
		zw, err := w.Create(prefix + e.Name())
		if err != nil {
			t.Fatal(err)
		}
		_, _ = zw.Write(data)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return out
}

func TestAWholePackageLoadsAndVerifies(t *testing.T) {
	dir := t.TempDir()
	writePackage(t, dir, "1.0.0")
	p, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Verify(); err != nil {
		t.Fatal(err)
	}
}

func TestTheDigestIsTheOneTheSidecarComputes(t *testing.T) {
	// terra/models.py: SHA-256 over "role:sha256\n", sorted by role.
	p := &Package{Manifest: analysis.ModelManifest{Files: map[string]analysis.ModelFile{
		"b": {SHA256: strings.Repeat("2", 64)},
		"a": {SHA256: strings.Repeat("1", 64)},
	}}}
	sum := sha256.Sum256([]byte("a:" + strings.Repeat("1", 64) + "\nb:" + strings.Repeat("2", 64) + "\n"))
	if got, want := p.Digest(), hex.EncodeToString(sum[:]); got != want {
		t.Fatalf("digest %s, want %s", got, want)
	}
}

func TestAChangedFileIsRefused(t *testing.T) {
	dir := t.TempDir()
	writePackage(t, dir, "1.0.0")
	if err := os.WriteFile(filepath.Join(dir, "model.bin"), []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Verify(); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("got %v, want a mismatch", err)
	}
}

func TestAnUnknownFamilyIsRefusedAtLoad(t *testing.T) {
	dir := t.TempDir()
	m := writePackage(t, dir, "1.0.0")
	m.Family = "diffusion"
	writeManifest(t, dir, m)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "cannot run") {
		t.Fatalf("got %v, want a refusal", err)
	}
}

func TestAFileCannotPointOutsideItsPackage(t *testing.T) {
	dir := t.TempDir()
	m := writePackage(t, dir, "1.0.0")
	f := m.Files["model"]
	f.Name = "../elsewhere.bin"
	m.Files["model"] = f
	writeManifest(t, dir, m)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "plain name") {
		t.Fatalf("got %v, want a refusal", err)
	}
}

func TestImportFromAZipInstallsUnderIdAndVersion(t *testing.T) {
	src := t.TempDir()
	writePackage(t, src, "1.0.0")
	root := t.TempDir()
	for _, prefix := range []string{"", "test-rf/"} {
		p, err := Import(root, zipDir(t, src, prefix))
		if err != nil {
			t.Fatalf("prefix %q: %v", prefix, err)
		}
		if want := filepath.Join(root, "test-rf", "1.0.0"); p.Dir != want {
			t.Fatalf("installed at %s, want %s", p.Dir, want)
		}
	}
	// The second import above was the same files: a no-op, not a refusal.
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".incoming-") {
			t.Fatalf("staging directory left behind: %s", e.Name())
		}
	}
}

func TestImportRefusesTheSameVersionWithOtherFiles(t *testing.T) {
	root := t.TempDir()
	a := t.TempDir()
	writePackage(t, a, "1.0.0")
	if _, err := Import(root, a); err != nil {
		t.Fatal(err)
	}
	b := t.TempDir()
	m := writePackage(t, b, "1.0.0")
	data := []byte("retrained")
	sum := sha256.Sum256(data)
	_ = os.WriteFile(filepath.Join(b, "model.bin"), data, 0o644)
	m.Files["model"] = analysis.ModelFile{Name: "model.bin", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	writeManifest(t, b, m)
	if _, err := Import(root, b); err == nil || !strings.Contains(err.Error(), "already installed") {
		t.Fatalf("got %v, want a refusal", err)
	}
}

func TestImportRefusesATamperedPackageAndLeavesNothing(t *testing.T) {
	src := t.TempDir()
	writePackage(t, src, "1.0.0")
	_ = os.WriteFile(filepath.Join(src, "scaler.bin"), []byte("tampered"), 0o644)
	root := t.TempDir()
	if _, err := Import(root, src); err == nil {
		t.Fatal("a package whose files do not match its manifest was installed")
	}
	if _, err := os.Stat(filepath.Join(root, "test-rf")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a refused package left %v", err)
	}
}

func TestImportRefusesANestedPath(t *testing.T) {
	// Two entries under different directories: no single folder to drop, so
	// each would have to be followed into a path, which is refused.
	out := filepath.Join(t.TempDir(), "nested.zip")
	nf, _ := os.Create(out)
	w := zip.NewWriter(nf)
	zw, _ := w.Create("a/b/model.json")
	_, _ = zw.Write([]byte("{}"))
	zw, _ = w.Create("c/model.bin")
	_, _ = zw.Write([]byte("x"))
	_ = w.Close()
	nf.Close()
	if _, err := Import(t.TempDir(), out); err == nil || !strings.Contains(err.Error(), "nested path") {
		t.Fatalf("got %v, want a refusal", err)
	}
}

func TestResolveFindsTheNewestVersionUnlessOneIsNamed(t *testing.T) {
	root := t.TempDir()
	for _, v := range []string{"1.9.0", "1.10.0", "1.2.0"} {
		src := t.TempDir()
		writePackage(t, src, v)
		if _, err := Import(root, src); err != nil {
			t.Fatal(err)
		}
	}
	p, err := Resolve(root, "test-rf", "")
	if err != nil || p.Manifest.Version != "1.10.0" {
		t.Fatalf("got %v %v, want 1.10.0", p, err)
	}
	p, err = Resolve(root, "test-rf", "1.2.0")
	if err != nil || p.Manifest.Version != "1.2.0" {
		t.Fatalf("got %v %v, want 1.2.0", p, err)
	}
	if _, err := Resolve(root, "absent", ""); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("got %v, want ErrNotInstalled", err)
	}
}

func TestRemoveDropsOneVersionAndTheIdWhenEmpty(t *testing.T) {
	root := t.TempDir()
	src := t.TempDir()
	writePackage(t, src, "1.0.0")
	if _, err := Import(root, src); err != nil {
		t.Fatal(err)
	}
	if err := Remove(root, "test-rf", "1.0.0"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "test-rf")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the id's directory was left: %v", err)
	}
	if err := Remove(root, "test-rf", "../.."); err == nil {
		t.Fatal("a version that walks out of root was accepted")
	}
}
