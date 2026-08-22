package store

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/*
Restoring an archive written by ExportBackup.

REPLACE, NOT MERGE. The archive is restored over the data directory rather than
folded into it. Merging two databases means deciding what happens when both
sides hold a run with the same id and different contents, and there is no
answer to that a user could predict -- the safe-looking option silently keeps
one and discards the other. Replacing is the operation this was built for:
moving to a new machine, or going back to a known state after something went
wrong.

Which makes the existing data the thing to protect. Anything already here is
moved aside before the archive is unpacked, not deleted, so a restore onto the
wrong machine is recoverable: the previous directory is still there under a
timestamped name, and the UI reports where it went.

PASSWORDS. The archive carries no hashes, by design. Every account restores
with an empty hash, which no password can match -- Login refuses it rather than
treating an empty hash as an empty password, which would turn a backup into a
way in. The account, its analyses and its projects are all there; the
credential has to be set again.
*/

// RestorePreview is what an archive says about itself, read without unpacking.
//
// A restore replaces everything, so the user is shown what they are about to
// get and what they are about to displace before it happens rather than after.
type RestorePreview struct {
	// Where the described archive is, so the restore acts on the file that was
	// described rather than on one the frontend chose separately.
	ArchivePath string         `json:"archive_path"`
	Manifest    BackupManifest `json:"manifest"`
	// What is here now, so the two can be compared.
	Current RestoreCurrent `json:"current"`
	// Set when the archive cannot be restored, saying why.
	Problem string `json:"problem,omitempty"`
}

// RestoreCurrent is what the restore would displace.
//
// Named for the same reason as BackupCounts: an anonymous struct reaches
// TypeScript as `any`, and the confirmation screen reads these fields to tell
// the user what they are about to replace -- the one place a wrong field name
// should not compile.
type RestoreCurrent struct {
	Runs     int `json:"runs"`
	Projects int `json:"projects"`
}

// errNotAnArchive is the refusal for a file that is not a readable ZIP, kept as
// a value because InspectBackup reports it to the user as a preview problem
// while RestoreBackup returns it as an error.
var errNotAnArchive = errors.New("this file is not a readable ZIP archive")

/*
openArchive opens a backup for reading without loading it into memory.

The archive holds every asset the user has ever produced, and one restore opens
it three times over -- described when the file is picked, described again
before committing, then unpacked -- so reading it whole meant that much
resident memory each time. OpenReader reads only the central directory and
streams each entry as it is asked for.

The caller closes the returned reader.

OpenReader folds opening the file and parsing it into one error, and the two
mean different things here: a file that cannot be read is a failure to report,
a file that is not a ZIP is a preview the user can act on. Only os.Open's
errors arrive as *fs.PathError, which is what separates them.
*/
func openArchive(path string) (*zip.ReadCloser, error) {
	zrc, err := zip.OpenReader(path)
	// An entry whose name is not local comes back as ErrInsecurePath alongside a
	// usable reader. That is not a reason to refuse the file: restoreTarget
	// checks every name against the staging directory and skips the ones that
	// try to escape, so refusing here would reject a whole backup over an entry
	// that was never going to be unpacked -- and would leave the reader open.
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		var pathErr *fs.PathError
		if errors.As(err, &pathErr) {
			return nil, fmt.Errorf("reading the archive: %w", err)
		}
		return nil, errNotAnArchive
	}
	return zrc, nil
}

// InspectBackup reads an archive's manifest and checks it can be restored.
//
// Separate from Restore so the UI can describe the operation before committing
// to it. Nothing is written by this.
func (s *Store) InspectBackup(archivePath string) (*RestorePreview, error) {
	preview := &RestorePreview{}

	zrc, err := openArchive(archivePath)
	if err != nil {
		if errors.Is(err, errNotAnArchive) {
			preview.Problem = err.Error()
			return preview, nil
		}
		return nil, err
	}
	defer zrc.Close()

	manifest, hasDB, err := readManifest(&zrc.Reader)
	if err != nil {
		preview.Problem = err.Error()
		return preview, nil
	}
	if !hasDB {
		preview.Problem = "this archive has no database in it, so it is not a TERRA backup"
		return preview, nil
	}
	// A newer archive may hold a layout this build does not know how to place.
	// Refusing is better than unpacking most of it and leaving the rest.
	if manifest.FormatVersion > backupFormatVersion {
		preview.Problem = fmt.Sprintf(
			"this backup was written by a newer version of TERRA (format %d, this build reads %d)",
			manifest.FormatVersion, backupFormatVersion)
		return preview, nil
	}
	preview.Manifest = manifest

	if s != nil && s.db != nil {
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM inference_runs`).Scan(&preview.Current.Runs)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM projects`).Scan(&preview.Current.Projects)
	}
	return preview, nil
}

// RestoreResult reports what a restore did, including where the replaced data
// went.
type RestoreResult struct {
	// Where the previous data directory was moved. The user needs this: it is
	// the only way back from a restore they did not mean.
	PreviousDataPath string `json:"previous_data_path"`
	RunsRestored     int    `json:"runs_restored"`
	ProjectsRestored int    `json:"projects_restored"`
	AssetsRestored   int    `json:"assets_restored"`
	// True when accounts came back without a usable password, which is every
	// archive this application writes.
	PasswordResetRequired bool `json:"password_reset_required"`
}

/*
RestoreBackup replaces the local data with an archive's contents.

The store must be closed by the caller first and reopened after: the database
file is replaced underneath it, and a connection held across that is a
connection to a file that no longer exists.

Unpacks into a staging directory and swaps it in at the end. A restore
interrupted halfway -- a full disk, a crash -- must not leave the data
directory holding half of one backup and half of the previous state, which is a
condition no user could diagnose and no code could clean up.
*/
func (s *Store) RestoreBackup(archivePath string) (*RestoreResult, error) {
	if s == nil {
		return nil, fmt.Errorf("the local store is not open")
	}
	dataDir := s.dataDir

	zrc, err := openArchive(archivePath)
	if err != nil {
		return nil, err
	}
	defer zrc.Close()

	manifest, hasDB, err := readManifest(&zrc.Reader)
	if err != nil {
		return nil, err
	}
	if !hasDB {
		return nil, fmt.Errorf("this archive has no database in it, so it is not a TERRA backup")
	}
	if manifest.FormatVersion > backupFormatVersion {
		return nil, fmt.Errorf(
			"this backup was written by a newer version of TERRA (format %d, this build reads %d)",
			manifest.FormatVersion, backupFormatVersion)
	}

	// Staged beside the data directory, not in the system temp: the swap at the
	// end has to be a rename, and a rename across filesystems fails.
	staging, err := os.MkdirTemp(filepath.Dir(dataDir), "terra-restoring-")
	if err != nil {
		return nil, fmt.Errorf("preparing the restore: %w", err)
	}
	defer os.RemoveAll(staging)

	result := &RestoreResult{PasswordResetRequired: true}

	for _, f := range zrc.File {
		if f.FileInfo().IsDir() {
			continue
		}
		dest, ok := restoreTarget(f.Name, staging)
		if !ok {
			continue // manifest.json, README.txt, anything unrecognised.
		}
		if err := extractFile(f, dest); err != nil {
			return nil, err
		}
		if strings.HasPrefix(f.Name, "data/") {
			result.AssetsRestored++
		}
	}

	// Closed as soon as the last entry is out, not only on the way back: the
	// swap below renames the data directory, and Windows refuses to rename a
	// directory that holds an open file -- which the archive would be if the
	// user picked one stored inside it. The deferred Close stays for the paths
	// that return before here.
	_ = zrc.Close()

	dbPath := filepath.Join(staging, dbFileName)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("the archive's database could not be unpacked: %w", err)
	}
	runs, projects, err := verifyRestoredDB(dbPath)
	if err != nil {
		return nil, err
	}
	result.RunsRestored = runs
	result.ProjectsRestored = projects

	// The swap. The previous directory is moved aside rather than removed, so a
	// restore onto the wrong machine is recoverable.
	stamp := time.Now().UTC().Format("20060102-150405")
	previous := dataDir + ".replaced-" + stamp
	if _, err := os.Stat(dataDir); err == nil {
		if err := os.Rename(dataDir, previous); err != nil {
			return nil, fmt.Errorf("moving the current data aside: %w", err)
		}
		result.PreviousDataPath = previous
	}
	if err := os.Rename(staging, dataDir); err != nil {
		placing := fmt.Errorf("putting the restored data in place: %w", err)
		// Put it back. Failing here with the old directory renamed away would
		// leave the application with no data at all.
		if result.PreviousDataPath != "" {
			if back := os.Rename(previous, dataDir); back != nil {
				// The guard did not hold: the data is sitting under the
				// timestamped name and nothing will look for it there. The path
				// goes in the message because the user is now the only thing
				// that can move it back, and the next start opens an empty
				// database without it.
				return nil, errors.Join(placing, fmt.Errorf(
					"and the previous data could not be moved back -- it is at %s: %w",
					previous, back))
			}
		}
		return nil, placing
	}
	return result, nil
}

// restoreTarget maps an archive entry to where it belongs, rejecting anything
// that tries to escape the destination.
//
// A ZIP entry name is attacker-controlled data even when the attacker is only a
// well-meaning user with a hand-edited archive: "../../.ssh/authorized_keys" is
// a valid entry name, and unpacking it where it asks is the Zip Slip
// vulnerability. Every path is checked to land inside the staging directory.
func restoreTarget(name, staging string) (string, bool) {
	switch {
	case name == backupDBName:
		return filepath.Join(staging, dbFileName), true
	case strings.HasPrefix(name, "data/"):
		rel := strings.TrimPrefix(name, "data/")
		if rel == "" {
			return "", false
		}
		dest := filepath.Join(staging, filepath.FromSlash(rel))
		// The containment check, after Join has resolved any "..".
		if !within(staging, dest) {
			return "", false
		}
		return dest, true
	default:
		return "", false
	}
}

// within reports whether path is inside root.
func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func extractFile(f *zip.File, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(dest), err)
	}
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("reading %s from the archive: %w", f.Name, err)
	}
	defer rc.Close()

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("writing %s: %w", dest, err)
	}

	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return fmt.Errorf("writing %s: %w", dest, err)
	}
	// Closed here rather than deferred, and checked. A write that fails late --
	// a disk that filled during the copy is the ordinary way -- is reported by
	// Close and by nothing else. Deferred and discarded, a truncated asset was
	// counted as restored and carried into the directory swap.
	if err := out.Close(); err != nil {
		return fmt.Errorf("writing %s: %w", dest, err)
	}
	return nil
}

/*
verifyRestoredDB opens the unpacked database and checks it is one of ours.

Done before the swap, never after. A file that is a valid ZIP holding a valid
SQLite database can still be some other application's; replacing the user's
data with it and discovering the problem on the next start would be a failure
with nothing left to fall back to except the moved-aside directory they do not
know about yet.
*/
func verifyRestoredDB(path string) (runs int, projects int, err error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return 0, 0, fmt.Errorf("opening the restored database: %w", err)
	}
	defer db.Close()

	if err := db.QueryRow(`SELECT COUNT(*) FROM inference_runs`).Scan(&runs); err != nil {
		return 0, 0, fmt.Errorf("this archive's database is not a TERRA database: %w", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM projects`).Scan(&projects); err != nil {
		return 0, 0, fmt.Errorf("this archive's database is not a TERRA database: %w", err)
	}
	// Left in whatever state the archive had. Every hash is empty, and Login
	// refuses an empty hash rather than matching an empty password against it.
	return runs, projects, nil
}

// readManifest pulls the manifest out of an archive and reports whether the
// database entry is present.
func readManifest(zr *zip.Reader) (BackupManifest, bool, error) {
	var m BackupManifest
	var hasDB bool
	var found bool

	for _, f := range zr.File {
		if f.Name == backupDBName {
			hasDB = true
			continue
		}
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return m, hasDB, fmt.Errorf("reading the archive's manifest: %w", err)
		}
		raw, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return m, hasDB, fmt.Errorf("reading the archive's manifest: %w", err)
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			return m, hasDB, fmt.Errorf("this archive's manifest is not readable")
		}
		found = true
	}
	if !found {
		return m, hasDB, fmt.Errorf("this archive has no manifest, so it is not a TERRA backup")
	}
	return m, hasDB, nil
}
