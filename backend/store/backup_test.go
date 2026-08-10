package store

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// readArchive indexes an archive by entry name.
func readArchive(t *testing.T, raw []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("reading the archive: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("opening %s: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("reading %s: %v", f.Name, err)
		}
		out[f.Name] = data
	}
	return out
}

/*
TestExportBackupOmitsCredentials is the assertion the whole design rests on.

The archive is meant to be storable and sendable, which is only true if the
credentials are genuinely gone. It checks the database inside the archive
rather than the code that wrote it: an UPDATE that ran against the wrong file,
or a VACUUM that never happened, both leave code that looks correct and an
archive that carries a hash.

The raw bytes are searched too, not just the query result. A value can survive
in a page the live table no longer references, where no query would ever show
it; on this schema the UPDATE happens to overwrite in place, but that is a
layout detail rather than a promise, and the byte search is what holds if the
layout changes.
*/
func TestExportBackupOmitsCredentials(t *testing.T) {
	s := openTestStore(t)

	const password = "correct-horse-battery-staple"
	user, _, err := s.Register("someone@example.com", password, "Someone")
	if err != nil {
		t.Fatal(err)
	}
	// A live session, which must not survive into the archive either.
	if _, _, err := s.Login("someone@example.com", password); err != nil {
		t.Fatal(err)
	}

	// The hash as actually stored, so the search looks for the real value
	// rather than something assumed about bcrypt's output.
	var storedHash string
	if err := s.db.QueryRow(
		`SELECT password_hash FROM users WHERE id = ?`, user.ID,
	).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash == "" {
		t.Fatal("no hash was stored, so this test would pass without proving anything")
	}

	raw, err := s.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	files := readArchive(t, raw)

	dbBytes, ok := files[backupDBName]
	if !ok {
		t.Fatalf("the archive has no database; entries: %v", names(files))
	}

	// Queried from the database inside the archive.
	dbPath := filepath.Join(t.TempDir(), "restored.db")
	if err := os.WriteFile(dbPath, dbBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var hash string
	if err := db.QueryRow(
		`SELECT password_hash FROM users WHERE id = ?`, user.ID,
	).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash != "" {
		t.Errorf("the archived database still holds a password hash: %q", hash)
	}

	var sessions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 0 {
		t.Errorf("the archived database holds %d session tokens, want 0", sessions)
	}

	// The bytes themselves, not just what a query returns.
	if bytes.Contains(dbBytes, []byte(storedHash)) {
		t.Error("the hash is absent from the users table but still present " +
			"somewhere in the file, where no query would show it")
	}

	// The account itself has to survive, or there is nothing to restore into.
	var email, name string
	if err := db.QueryRow(
		`SELECT email, display_name FROM users WHERE id = ?`, user.ID,
	).Scan(&email, &name); err != nil {
		t.Fatal(err)
	}
	if email != "someone@example.com" || name != "Someone" {
		t.Errorf("the account did not survive: email=%q name=%q", email, name)
	}
}

// TestExportBackupIncludesAssets checks that the files the database points at
// travel with it.
//
// Without them a restore produces rows that look intact and open onto missing
// images, which is a worse outcome than an export that refused to run.
func TestExportBackupIncludesAssets(t *testing.T) {
	s := openTestStore(t)

	// An asset of each kind the walker collects.
	for _, rel := range []string{
		filepath.Join("runs", "run-1", "overlay.png"),
		filepath.Join("projects", "proj-1", "composition.tif"),
		filepath.Join("avatars", "avatar.png"),
	} {
		full := filepath.Join(s.dataDir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("pretend image "+rel), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	raw, err := s.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	files := readArchive(t, raw)

	for _, want := range []string{
		"data/runs/run-1/overlay.png",
		"data/projects/proj-1/composition.tif",
		"data/avatars/avatar.png",
	} {
		if _, ok := files[want]; !ok {
			t.Errorf("the archive is missing %s; entries: %v", want, names(files))
		}
	}

	var m BackupManifest
	if err := json.Unmarshal(files["manifest.json"], &m); err != nil {
		t.Fatalf("the manifest does not parse: %v", err)
	}
	if m.Counts.Assets != 3 {
		t.Errorf("the manifest counts %d assets, want 3", m.Counts.Assets)
	}
	if m.AssetBytes <= 0 {
		t.Error("the manifest reports no asset bytes despite carrying assets")
	}
	if m.FormatVersion != backupFormatVersion {
		t.Errorf("format version is %d, want %d", m.FormatVersion, backupFormatVersion)
	}
	if len(m.Excluded) == 0 {
		t.Error("the manifest should state what was left out, so an archive " +
			"read later does not look like a complete copy")
	}
}

// TestExportBackupExcludesSessionToken checks that the on-disk session file
// does not travel with the archive.
//
// It sits in the data directory beside the assets, so a walker that took the
// directory wholesale would ship a live credential -- the exact thing emptying
// the sessions table is meant to prevent.
func TestExportBackupExcludesSessionToken(t *testing.T) {
	s := openTestStore(t)

	tokenPath := filepath.Join(s.dataDir, "session.token")
	if err := os.WriteFile(tokenPath, []byte("a-live-token"), 0o600); err != nil {
		t.Fatal(err)
	}

	raw, err := s.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	files := readArchive(t, raw)

	for name := range files {
		if strings.Contains(name, "session.token") {
			t.Errorf("the archive carries the session token at %s", name)
		}
	}
	if bytes.Contains(raw, []byte("a-live-token")) {
		t.Error("the session token appears in the archive bytes")
	}
}

// TestExportBackupSurvivesAMissingAssetDirectory checks that a fresh install,
// which has saved nothing yet, still exports.
func TestExportBackupSurvivesAMissingAssetDirectory(t *testing.T) {
	s := openTestStore(t)

	raw, err := s.ExportBackup("test")
	if err != nil {
		t.Fatalf("exporting with no assets failed: %v", err)
	}
	files := readArchive(t, raw)
	if _, ok := files[backupDBName]; !ok {
		t.Error("the archive has no database")
	}
	if _, ok := files["README.txt"]; !ok {
		t.Error("the archive has no README")
	}
}

func TestDefaultBackupFilename(t *testing.T) {
	when := time.Date(2026, 8, 9, 15, 4, 5, 0, time.UTC)
	got := DefaultBackupFilename(when)
	if got != "terra-backup-2026-08-09.zip" {
		t.Errorf("DefaultBackupFilename = %q", got)
	}
}

func names(files map[string][]byte) []string {
	out := make([]string, 0, len(files))
	for n := range files {
		out = append(out, n)
	}
	return out
}
