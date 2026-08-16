package store

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestRestoreBackupRoundTrip is the promise the feature makes: what was
// exported comes back.
func TestRestoreBackupRoundTrip(t *testing.T) {
	source := openStoreIn(t, filepath.Join(t.TempDir(), "source"))

	user, _, err := source.Register("someone@example.com", "correct-horse", "Someone")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.CreateProject(Project{
		UserID: user.ID,
		Name:   "Field study",
	}); err != nil {
		t.Fatal(err)
	}
	assetRel := filepath.Join("runs", "run-1", "overlay.png")
	assetFull := filepath.Join(source.dataDir, assetRel)
	if err := os.MkdirAll(filepath.Dir(assetFull), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetFull, []byte("an overlay"), 0o600); err != nil {
		t.Fatal(err)
	}

	archive := filepath.Join(t.TempDir(), "backup.zip")
	raw, err := source.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	// A separate machine: a store whose data directory holds something else.
	target := openStoreIn(t, filepath.Join(t.TempDir(), "target"))
	if _, _, err := target.Register("other@example.com", "different-pw", "Other"); err != nil {
		t.Fatal(err)
	}

	preview, err := target.InspectBackup(archive)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Problem != "" {
		t.Fatalf("the archive was rejected: %s", preview.Problem)
	}
	if preview.Manifest.Counts.Projects != 1 {
		t.Errorf("preview reports %d projects, want 1", preview.Manifest.Counts.Projects)
	}

	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := target.RestoreBackup(archive)
	if err != nil {
		t.Fatal(err)
	}
	if result.PreviousDataPath == "" {
		t.Error("the replaced data was not moved aside, so the restore is not reversible")
	}
	if _, err := os.Stat(result.PreviousDataPath); err != nil {
		t.Errorf("the replaced data is not at %s: %v", result.PreviousDataPath, err)
	}

	// Reopened, as the application does after a restore.
	restored := openStoreIn(t, target.dataDir)

	var email string
	if err := restored.db.QueryRow(
		`SELECT email FROM users WHERE id = ?`, user.ID,
	).Scan(&email); err != nil {
		t.Fatalf("the exported account did not come back: %v", err)
	}
	if email != "someone@example.com" {
		t.Errorf("restored account email is %q", email)
	}

	// The account that was here before is gone: this replaces, it does not merge.
	var others int
	if err := restored.db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE email = 'other@example.com'`,
	).Scan(&others); err != nil {
		t.Fatal(err)
	}
	if others != 0 {
		t.Error("the displaced account survived; a restore is a replace, not a merge")
	}

	// The asset came back where the database expects it.
	if _, err := os.Stat(filepath.Join(restored.dataDir, assetRel)); err != nil {
		t.Errorf("the overlay did not come back: %v", err)
	}
	if result.AssetsRestored == 0 {
		t.Error("the result reports no assets restored")
	}
}

/*
TestRestoredAccountCannotBeSignedIntoWithoutAPassword is the security
assertion behind exporting no hashes.

A backup carries no credential, so a restored account has an empty hash. If
anything treated that as an empty password, the backup would become a way into
every account it contains -- and the file is meant to be storable and sendable
precisely because it is not.
*/
func TestRestoredAccountCannotBeSignedIntoWithoutAPassword(t *testing.T) {
	source := openStoreIn(t, filepath.Join(t.TempDir(), "source"))
	if _, _, err := source.Register("someone@example.com", "correct-horse", "Someone"); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "backup.zip")
	raw, err := source.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	target := openStoreIn(t, filepath.Join(t.TempDir(), "target"))
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(archive); err != nil {
		t.Fatal(err)
	}
	restored := openStoreIn(t, target.dataDir)

	// Neither the original password, nor an empty one, nor anything else.
	for _, attempt := range []string{"correct-horse", "", " ", "password"} {
		if _, _, err := restored.Login("someone@example.com", attempt); err == nil {
			t.Errorf("a restored account was signed into with %q", attempt)
		}
	}
}

/*
TestRestoreRejectsPathTraversal covers Zip Slip.

A ZIP entry name is data, and "../../escaped" is a valid one. Unpacking an
entry where it asks lets a hand-edited archive write anywhere the application
can -- a shell profile, an autostart entry. The user picking the file is not a
defence: the whole point of a backup is that it travels between machines and
people.
*/
func TestRestoreRejectsPathTraversal(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))

	// A real archive, so everything but the malicious entry is valid.
	valid, err := s.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(valid), int64(len(valid)))
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data := new(bytes.Buffer)
		if _, err := data.ReadFrom(rc); err != nil {
			t.Fatal(err)
		}
		rc.Close()
		if err := writeZipFile(zw, f.Name, data.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
	// The escape attempt.
	if err := writeZipFile(zw, "data/../../escaped.txt", []byte("owned")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	archive := filepath.Join(t.TempDir(), "evil.zip")
	if err := os.WriteFile(archive, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	// Somewhere the traversal would land if it were honoured.
	outside := filepath.Dir(filepath.Dir(s.dataDir))

	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreBackup(archive); err != nil {
		t.Fatalf("the archive should restore with the bad entry skipped: %v", err)
	}

	if _, err := os.Stat(filepath.Join(outside, "escaped.txt")); err == nil {
		t.Error("a ../ entry escaped the destination directory")
	}
	// Nor should it land inside under a resolved name.
	if _, err := os.Stat(filepath.Join(s.dataDir, "escaped.txt")); err == nil {
		t.Error("the traversal entry was written despite being rejected")
	}
}

// TestInspectBackupRejectsForeignArchives checks that a ZIP that is not a
// TERRA backup is refused before anything is replaced.
func TestInspectBackupRejectsForeignArchives(t *testing.T) {
	s := openTestStore(t)
	dir := t.TempDir()

	// A ZIP with no manifest and no database.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := writeZipFile(zw, "notes.txt", []byte("unrelated")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(dir, "foreign.zip")
	if err := os.WriteFile(foreign, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	preview, err := s.InspectBackup(foreign)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Problem == "" {
		t.Error("a ZIP with no manifest was accepted as a backup")
	}

	// Not a ZIP at all.
	notZip := filepath.Join(dir, "notes.zip")
	if err := os.WriteFile(notZip, []byte("just text"), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err = s.InspectBackup(notZip)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Problem == "" {
		t.Error("a file that is not a ZIP was accepted as a backup")
	}
}

// TestInspectBackupRejectsANewerFormat checks that an archive from a future
// build is refused rather than half-unpacked.
func TestInspectBackupRejectsANewerFormat(t *testing.T) {
	s := openTestStore(t)

	raw, err := s.ExportBackup("test")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data := new(bytes.Buffer)
		if _, err := data.ReadFrom(rc); err != nil {
			t.Fatal(err)
		}
		rc.Close()

		content := data.Bytes()
		if f.Name == "manifest.json" {
			var m BackupManifest
			if err := json.Unmarshal(content, &m); err != nil {
				t.Fatal(err)
			}
			m.FormatVersion = backupFormatVersion + 1
			content, err = json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
		}
		if err := writeZipFile(zw, f.Name, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	future := filepath.Join(t.TempDir(), "future.zip")
	if err := os.WriteFile(future, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	preview, err := s.InspectBackup(future)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Problem == "" {
		t.Fatal("an archive from a newer format was accepted")
	}
	if !strings.Contains(preview.Problem, "newer version") {
		t.Errorf("the refusal should say the archive is newer, got: %s", preview.Problem)
	}
}
