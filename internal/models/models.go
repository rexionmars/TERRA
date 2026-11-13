/*
Package models installs, lists and removes the model packages a run can use.

THE APPLICATION SHIPS NO MODEL. A reader installs the ones they want, from the
published catalogue or from a package of their own, and each lands under the
data directory at models/<id>/<version>/, where it survives updates of the
application. A run names a model by id; Resolve finds its directory, and the
sidecar runs what it finds there.

PINNED BY DIGEST. A package's files are pickles, and loading one runs whatever
it says. Its manifest records the SHA-256 of every file; Import refuses a
package whose files do not hash to it, and the sidecar checks them again before
every run (sidecar/terra/models.py), so a file changed after installing is
never loaded.

WEIGHTS ONLY, IN A KNOWN FAMILY. A package brings no code. It names one of the
architectures the sidecar can run, and roles mirrors the files each needs, from
ROLES in terra/models.py: a package of an unknown family is refused at import,
where the reader can still be told why, rather than at the first run.
*/
package models

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"geosense-infer/internal/analysis"
)

const (
	manifestName = "model.json"
	format       = 1
	// maxPackage bounds what an import will unpack, so a crafted archive
	// cannot fill the disk before its manifest is read.
	maxPackage = 4 << 30
)

// roles are the files each family needs; terra/models.py ROLES is the
// authority, and the two change together.
var roles = map[string][]string{
	"feature_rf":           {"model", "scaler", "label_encoder", "feature_names"},
	"sequence_transformer": {"checkpoint"},
	"embedding_rf":         {"label_encoder"},
}

var (
	idPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// ErrNotInstalled is returned by Resolve when no version of the id is installed.
var ErrNotInstalled = errors.New("model not installed")

// Package is an installed or incoming model package: a directory and its manifest.
type Package struct {
	Dir      string
	Manifest analysis.ModelManifest
}

// Load reads the manifest in dir and checks its shape. It does not read the
// files; Verify does, and is kept apart so that listing stays cheap.
func Load(dir string) (*Package, error) {
	raw, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return nil, fmt.Errorf("no readable %s in %s: %w", manifestName, dir, err)
	}
	var m analysis.ModelManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("%s in %s is not valid JSON: %w", manifestName, dir, err)
	}
	if err := check(m); err != nil {
		return nil, err
	}
	return &Package{Dir: dir, Manifest: m}, nil
}

func check(m analysis.ModelManifest) error {
	if m.Format != format {
		return fmt.Errorf("model package format %d is not %d; a newer TERRA may be needed", m.Format, format)
	}
	if !idPattern.MatchString(m.ID) {
		return fmt.Errorf("model id %q is not a valid id", m.ID)
	}
	base, ok := roles[m.Family]
	if !ok {
		return fmt.Errorf("model %s is a %q, which this version of TERRA cannot run", m.ID, m.Family)
	}
	if m.Version == "" || strings.ContainsAny(m.Version, `/\`) || m.Version == "." || m.Version == ".." {
		return fmt.Errorf("model %s has no usable version", m.ID)
	}
	if len(m.Classes) == 0 {
		return fmt.Errorf("model %s lists no classes", m.ID)
	}
	for _, p := range m.PackagedBy {
		if strings.TrimSpace(p.Name) == "" {
			return fmt.Errorf("model %s names someone in packaged_by without a name", m.ID)
		}
	}
	// A copy: the variants' roles are appended, and the table is shared.
	need := append([]string(nil), base...)
	if m.Family == "embedding_rf" {
		if len(m.Variants) == 0 {
			return fmt.Errorf("model %s names no variant", m.ID)
		}
		for _, v := range m.Variants {
			if !idPattern.MatchString(v) {
				return fmt.Errorf("model %s lists an invalid variant %q", m.ID, v)
			}
			need = append(need, "model_"+v, "scaler_"+v)
		}
	}
	for role, f := range m.Files {
		// A bare name: a package cannot point outside its own directory.
		if f.Name == "" || filepath.Base(f.Name) != f.Name || f.Name == manifestName ||
			strings.ContainsAny(f.Name, `/\`) || strings.HasPrefix(f.Name, ".") {
			return fmt.Errorf("model %s: file %q has no plain name", m.ID, role)
		}
		if !shaPattern.MatchString(f.SHA256) {
			return fmt.Errorf("model %s: %s has no SHA-256", m.ID, f.Name)
		}
		if f.Size < 0 {
			return fmt.Errorf("model %s: %s has no size", m.ID, f.Name)
		}
	}
	var missing []string
	for _, r := range need {
		if _, ok := m.Files[r]; !ok {
			missing = append(missing, r)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("model %s lacks the %s its family needs", m.ID, strings.Join(missing, ", "))
	}
	return nil
}

func fileDigest(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	// Opened to read: a failed close loses nothing.
	defer func() { _ = f.Close() }()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// Verify refuses the package unless every file it names is present and hashes
// to the digest its manifest records.
func (p *Package) Verify() error {
	for role, f := range p.Manifest.Files {
		sum, size, err := fileDigest(filepath.Join(p.Dir, f.Name))
		if err != nil {
			return fmt.Errorf("model %s is missing %s (%s)", p.Manifest.ID, f.Name, role)
		}
		if size != f.Size || sum != f.SHA256 {
			return fmt.Errorf("model %s: %s does not match its manifest (%s)", p.Manifest.ID, f.Name, role)
		}
	}
	return nil
}

// Digest is the package's fingerprint: SHA-256 over each role and its file's
// digest, sorted by role. terra/models.py computes the same value, and a run
// records it.
func (p *Package) Digest() string {
	keys := make([]string, 0, len(p.Manifest.Files))
	for role := range p.Manifest.Files {
		keys = append(keys, role)
	}
	sort.Strings(keys)
	h := sha256.New()
	for _, role := range keys {
		// A hash.Hash never returns an error from Write.
		_, _ = fmt.Fprintf(h, "%s:%s\n", role, p.Manifest.Files[role].SHA256)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Info is the package as the frontend lists it, with its picture inlined.
func (p *Package) Info() analysis.ModelInfo {
	info := analysis.ModelInfo{Manifest: p.Manifest, Digest: p.Digest()}
	if f, ok := p.Manifest.Files["picture"]; ok {
		if raw, err := os.ReadFile(filepath.Join(p.Dir, f.Name)); err == nil {
			mime := "image/webp"
			switch strings.ToLower(filepath.Ext(f.Name)) {
			case ".png":
				mime = "image/png"
			case ".jpg", ".jpeg":
				mime = "image/jpeg"
			}
			info.PictureURI = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)
		}
	}
	return info
}

// List returns every installed package under root, newest version first within
// an id. A directory that does not load is skipped and reported in errs, so
// one damaged package does not hide the others.
func List(root string) (pkgs []*Package, errs []error) {
	ids, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, []error{err}
	}
	for _, id := range ids {
		if !id.IsDir() || strings.HasPrefix(id.Name(), ".") {
			continue
		}
		versions, err := os.ReadDir(filepath.Join(root, id.Name()))
		if err != nil {
			errs = append(errs, err)
			continue
		}
		var found []*Package
		for _, v := range versions {
			if !v.IsDir() {
				continue
			}
			p, err := Load(filepath.Join(root, id.Name(), v.Name()))
			if err != nil {
				errs = append(errs, err)
				continue
			}
			found = append(found, p)
		}
		sort.Slice(found, func(i, j int) bool {
			return compareVersions(found[i].Manifest.Version, found[j].Manifest.Version) > 0
		})
		pkgs = append(pkgs, found...)
	}
	return pkgs, errs
}

// Resolve finds the installed package for id: the given version, or the newest
// installed when version is empty.
func Resolve(root, id, version string) (*Package, error) {
	pkgs, _ := List(root)
	for _, p := range pkgs {
		if p.Manifest.ID == id && (version == "" || p.Manifest.Version == version) {
			return p, nil
		}
	}
	if version != "" {
		return nil, fmt.Errorf("%w: %s %s; install it from Models", ErrNotInstalled, id, version)
	}
	return nil, fmt.Errorf("%w: %s; install it from Models", ErrNotInstalled, id)
}

/*
compareVersions orders dotted versions part by part, numerically where both
parts are numbers and as text otherwise, so 1.10 is newer than 1.9.
*/
func compareVersions(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y string
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		nx, ex := strconv.Atoi(x)
		ny, ey := strconv.Atoi(y)
		switch {
		case ex == nil && ey == nil && nx != ny:
			if nx < ny {
				return -1
			}
			return 1
		case (ex != nil || ey != nil) && x != y:
			return strings.Compare(x, y)
		}
	}
	return 0
}

/*
Import installs the package at src, a .zip or a directory, under root.

It is unpacked into a hidden directory beside the installed ones, loaded and
verified there, and only then moved into models/<id>/<version>/, so a package
that fails a check never appears installed. Installing a version already
present with the same files is a no-op; with different files it is refused,
because a run that recorded that version would no longer say which files
made it.
*/
func Import(root, src string) (*Package, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	stage, err := os.MkdirTemp(root, ".incoming-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stage)

	info, err := os.Stat(src)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		err = copyDir(src, stage)
	} else {
		err = unzip(src, stage)
	}
	if err != nil {
		return nil, err
	}
	p, err := Load(stage)
	if err != nil {
		return nil, err
	}
	if err := p.Verify(); err != nil {
		return nil, err
	}

	dest := filepath.Join(root, p.Manifest.ID, p.Manifest.Version)
	if have, err := Load(dest); err == nil {
		if have.Digest() == p.Digest() {
			return have, nil
		}
		return nil, fmt.Errorf("model %s %s is already installed with other files; remove it first",
			p.Manifest.ID, p.Manifest.Version)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}
	// Only the files the manifest names, and the manifest itself: whatever
	// else came in the archive is left behind with the stage.
	if err := os.Mkdir(dest, 0o755); err != nil {
		return nil, err
	}
	names := []string{manifestName}
	for _, f := range p.Manifest.Files {
		names = append(names, f.Name)
	}
	for _, name := range names {
		if err := os.Rename(filepath.Join(stage, name), filepath.Join(dest, name)); err != nil {
			_ = os.RemoveAll(dest)
			return nil, err
		}
	}
	return Load(dest)
}

/*
unzip writes the archive's files into dir, flat.

An archive made by zipping a package's folder holds everything under one
top-level directory; that prefix is dropped, so both layouts install. Any
other path inside the archive is refused rather than followed, which is what
keeps an entry from writing outside dir.
*/
func unzip(src, dir string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return fmt.Errorf("%s is not a readable zip: %w", filepath.Base(src), err)
	}
	defer r.Close()

	var files []*zip.File
	for _, f := range r.File {
		if !f.FileInfo().IsDir() && !strings.HasPrefix(filepath.Base(f.Name), ".") &&
			!strings.HasPrefix(f.Name, "__MACOSX/") {
			files = append(files, f)
		}
	}
	prefix := commonDir(files)
	var total uint64
	for _, f := range files {
		name := strings.TrimPrefix(f.Name, prefix)
		if name == "" || strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
			return fmt.Errorf("%s holds a nested path, %q; a package is flat", filepath.Base(src), f.Name)
		}
		total += f.UncompressedSize64
		if total > maxPackage {
			return fmt.Errorf("%s unpacks to more than %d GB", filepath.Base(src), maxPackage>>30)
		}
		if err := writeEntry(f, filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

func commonDir(files []*zip.File) string {
	if len(files) == 0 {
		return ""
	}
	first := files[0].Name
	i := strings.Index(first, "/")
	if i < 0 {
		return ""
	}
	prefix := first[:i+1]
	for _, f := range files {
		if !strings.HasPrefix(f.Name, prefix) {
			return ""
		}
	}
	return prefix
}

func writeEntry(f *zip.File, path string) error {
	in, err := f.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	// Bounded by the size the entry declares, so a lying header cannot
	// stream past it.
	_, err = io.Copy(out, io.LimitReader(in, int64(f.UncompressedSize64)))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}

func copyDir(src, dir string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		in, err := os.Open(filepath.Join(src, e.Name()))
		if err != nil {
			return err
		}
		out, err := os.Create(filepath.Join(dir, e.Name()))
		if err != nil {
			_ = in.Close()
			return err
		}
		_, err = io.Copy(out, in)
		_ = in.Close() // Opened to read: a failed close loses nothing.
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// Remove uninstalls one version of a model, and its id's directory once empty.
func Remove(root, id, version string) error {
	if !idPattern.MatchString(id) || version == "" || strings.ContainsAny(version, `/\`) ||
		version == "." || version == ".." {
		return fmt.Errorf("no such model: %s %s", id, version)
	}
	dir := filepath.Join(root, id, version)
	if _, err := os.Stat(filepath.Join(dir, manifestName)); err != nil {
		return fmt.Errorf("%w: %s %s", ErrNotInstalled, id, version)
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(root, id)) // Fails, harmlessly, while another version remains.
	return nil
}
