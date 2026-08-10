package store

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/*
Exporting the local database, so a machine is not the only copy.

Everything this application produces lives in one directory and nowhere else:
there is no server, no sync and no account that holds anything. A reinstalled
laptop takes every saved run and project with it. This writes that directory to
a single archive the user chooses the location of.

WHAT IS LEFT OUT, AND WHY. Password hashes and session tokens are removed. A
backup is a file people mail to themselves, drop in a shared folder and attach
to a support thread, and any of those turns a credential into something that
has left the machine. The cost is that restoring cannot sign anyone back in --
it recreates the account from the email and display name and asks for a new
password. The data returns; the credential is reset. That trade is deliberate,
and the UI states it rather than letting a user discover it at restore time.

WHY THE IMAGES ARE IN HERE. Overlays, GeoTIFFs and avatars are files on disk
that the database refers to by relative path. A backup of the database alone
would restore a list of runs whose every image is missing -- rows that look
intact and open onto nothing. The archive is larger for it, which is the
honest cost of an export that actually restores.
*/

// BackupManifest describes an archive, so the side that reads it can tell what
// it is holding before it unpacks anything.
type BackupManifest struct {
	// Bumped when the layout changes in a way a reader has to know about.
	FormatVersion int    `json:"format_version"`
	CreatedAt     string `json:"created_at"`
	// The application version that wrote it, for diagnosing an archive that
	// will not restore.
	AppVersion string `json:"app_version"`
	// Stated rather than implied. Someone opening this archive in a year should
	// not have to infer from an empty column that the credentials were dropped
	// on purpose.
	Excluded   []string     `json:"excluded"`
	Counts     BackupCounts `json:"counts"`
	AssetBytes int64        `json:"asset_bytes"`
}

// BackupCounts is what an archive holds.
//
// A named type rather than an anonymous struct because this crosses into
// TypeScript: the Wails binding generator cannot name an anonymous struct, so
// it emits `any` and every field read on the other side loses its checking. It
// says so while generating, in a line that scrolls past in a successful build.
type BackupCounts struct {
	Users    int `json:"users"`
	Runs     int `json:"runs"`
	Projects int `json:"projects"`
	Overlays int `json:"overlays"`
	Assets   int `json:"assets"`
}

const backupFormatVersion = 1

// backupDBName is the database inside the archive. Named for what it is rather
// than after the live file, so unzipping into a data directory by hand cannot
// silently overwrite the database in use.
const backupDBName = "database/terra.db"

// assetDirs are the directories holding files the database points at.
//
// session.token is deliberately absent: it is a live credential, and the tables
// that would honour it are emptied anyway.
var assetDirs = []string{"runs", "projects", "avatars"}

/*
ExportBackup writes the user's data to a ZIP archive and returns it.

Returned as bytes rather than written directly because the caller runs the save
dialog: asking where to put a file the application has already written puts the
two in the wrong order, and a cancelled dialog would leave the file behind.
*/
func (s *Store) ExportBackup(appVersion string) ([]byte, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("the local store is not open")
	}

	snapshot, err := s.snapshotDatabase()
	if err != nil {
		return nil, err
	}
	defer os.Remove(snapshot)

	manifest := BackupManifest{
		FormatVersion: backupFormatVersion,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		AppVersion:    appVersion,
		Excluded: []string{
			"password hashes",
			"session tokens",
		},
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	dbBytes, err := os.ReadFile(snapshot)
	if err != nil {
		return nil, fmt.Errorf("reading the database snapshot: %w", err)
	}
	if err := writeZipFile(zw, backupDBName, dbBytes); err != nil {
		return nil, err
	}

	assets, bytesWritten, err := s.addAssets(zw)
	if err != nil {
		return nil, err
	}
	manifest.Counts.Assets = assets
	manifest.AssetBytes = bytesWritten

	if err := s.countInto(&manifest); err != nil {
		return nil, err
	}

	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeZipFile(zw, "manifest.json", append(raw, '\n')); err != nil {
		return nil, err
	}
	if err := writeZipFile(zw, "README.txt", []byte(backupReadme(manifest))); err != nil {
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("finishing the archive: %w", err)
	}
	return buf.Bytes(), nil
}

/*
snapshotDatabase writes a consistent copy of the database to a temporary file.

VACUUM INTO rather than copying the file. The database is open and being
written to while this runs, and a byte copy of a live SQLite file can land
mid-transaction -- producing an archive that restores into a corrupt database,
which is worse than one that fails to restore at all. VACUUM INTO takes a read
transaction and writes a coherent database, and it does so without closing the
one the application is using.

The credentials are removed from the copy, never from the original.
*/
func (s *Store) snapshotDatabase() (string, error) {
	tmp, err := os.MkdirTemp("", "terra-backup-")
	if err != nil {
		return "", err
	}
	path := filepath.Join(tmp, "snapshot.db")

	if _, err := s.db.Exec(`VACUUM INTO ?`, path); err != nil {
		os.RemoveAll(tmp)
		return "", fmt.Errorf("copying the database: %w", err)
	}

	if err := stripCredentials(path); err != nil {
		os.RemoveAll(tmp)
		return "", err
	}
	return path, nil
}

/*
stripCredentials empties the password hashes and session tokens in a snapshot.

The hash column is set to empty rather than dropped. Dropping it would give the
archive a schema the application cannot open, so restoring would have to
rebuild the table; emptied, the row is readable by exactly the code that reads
it today, and a restore knows to ask for a new password because the hash is
blank. bcrypt never produces an empty string, so the value cannot be mistaken
for a real one.

VACUUM at the end rebuilds the file from its live pages. Measured on this
schema, the UPDATE already overwrites the hash in place and the bytes do not
survive without it -- but that is a property of how these rows happen to be
laid out, not a guarantee SQLite makes. A row that had to move would leave its
old page intact, and the whole value of this archive is that the credential is
gone from it. The VACUUM makes that true by construction rather than by
measurement.
*/
func stripCredentials(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("opening the snapshot: %w", err)
	}
	defer db.Close()

	if _, err := db.Exec(`UPDATE users SET password_hash = ''`); err != nil {
		return fmt.Errorf("removing password hashes: %w", err)
	}
	if _, err := db.Exec(`DELETE FROM sessions`); err != nil {
		return fmt.Errorf("removing sessions: %w", err)
	}
	// Without this the deleted bytes stay in the file's free pages.
	if _, err := db.Exec(`VACUUM`); err != nil {
		return fmt.Errorf("compacting the snapshot: %w", err)
	}
	return nil
}

// addAssets copies the files the database refers to, returning how many and how
// large.
//
// Walks the directories rather than resolving each row's relative path: a file
// orphaned by a failed delete still belongs to the user, and a row pointing at
// a file that is already missing must not fail the export of everything else.
func (s *Store) addAssets(zw *zip.Writer) (int, int64, error) {
	var count int
	var total int64

	for _, dir := range assetDirs {
		root := filepath.Join(s.dataDir, dir)
		if _, err := os.Stat(root); err != nil {
			continue // Nothing of this kind has been saved yet.
		}
		err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// A single unreadable file must not cost the whole backup.
				return nil
			}
			if info.IsDir() || !info.Mode().IsRegular() {
				return nil
			}
			rel, err := filepath.Rel(s.dataDir, path)
			if err != nil {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			// Forward slashes: the ZIP format specifies them, and an archive
			// written on Windows with backslashes unpacks as one long filename
			// everywhere else.
			name := "data/" + filepath.ToSlash(rel)
			if err := writeZipFile(zw, name, data); err != nil {
				return err
			}
			count++
			total += int64(len(data))
			return nil
		})
		if err != nil {
			return count, total, err
		}
	}
	return count, total, nil
}

// countInto fills the manifest's row counts, so the archive states what it
// holds without anyone having to open the database to find out.
func (s *Store) countInto(m *BackupManifest) error {
	counts := []struct {
		query string
		into  *int
	}{
		{`SELECT COUNT(*) FROM users`, &m.Counts.Users},
		{`SELECT COUNT(*) FROM inference_runs`, &m.Counts.Runs},
		{`SELECT COUNT(*) FROM projects`, &m.Counts.Projects},
		{`SELECT COUNT(*) FROM project_overlays`, &m.Counts.Overlays},
	}
	for _, c := range counts {
		if err := s.db.QueryRow(c.query).Scan(c.into); err != nil {
			return fmt.Errorf("counting rows: %w", err)
		}
	}
	return nil
}

// writeZipFile adds one file, compressed.
func writeZipFile(zw *zip.Writer, name string, data []byte) error {
	header := &zip.FileHeader{
		Name:   name,
		Method: zip.Deflate,
	}
	header.SetMode(0o600)
	w, err := zw.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("adding %s: %w", name, err)
	}
	if _, err := io.Copy(w, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("writing %s: %w", name, err)
	}
	return nil
}

// DefaultBackupFilename names an archive by the day it was written, so several
// backups sort in the order they were made and none silently replaces another.
func DefaultBackupFilename(now time.Time) string {
	return fmt.Sprintf("terra-backup-%s.zip", now.Format("2006-01-02"))
}

// backupReadme explains the archive to whoever opens it, which may be the user
// on a machine that no longer has TERRA installed.
func backupReadme(m BackupManifest) string {
	var b strings.Builder
	b.WriteString("TERRA backup\n\n")
	fmt.Fprintf(&b, "Written %s by TERRA %s.\n\n", m.CreatedAt, m.AppVersion)
	b.WriteString("Contents:\n")
	fmt.Fprintf(&b, "  %s\n", backupDBName)
	b.WriteString("      The database: accounts, analyses, projects and preferences.\n")
	b.WriteString("      Readable with any SQLite client.\n")
	b.WriteString("  data/\n")
	b.WriteString("      The images and rasters the database refers to, under the\n")
	b.WriteString("      same relative paths it stores.\n")
	b.WriteString("  manifest.json\n")
	b.WriteString("      What this archive holds, and what was left out of it.\n\n")
	b.WriteString("Not included: password hashes and session tokens.\n")
	b.WriteString("Restoring this backup returns your analyses and projects and asks\n")
	b.WriteString("you to set a new password. This is deliberate, so that a backup\n")
	b.WriteString("can be stored or sent without carrying a credential with it.\n\n")
	fmt.Fprintf(&b, "Analyses: %d\nProjects: %d\nOverlays: %d\nFiles: %d\n",
		m.Counts.Runs, m.Counts.Projects, m.Counts.Overlays, m.Counts.Assets)
	return b.String()
}
