package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/research"
	"geosense-infer/internal/store"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// What leaves the application as a file: an export the user asked for, a
// backup of everything, and the restore that reads one back.

// ExportClassification copies the classification GeoTIFF to a user-chosen path.
func (a *App) ExportClassification(rasterPath string) (string, error) {
	return a.ExportOverlayFile(rasterPath, "terra_classification.tif")
}

// ExportResearchPack writes a ZIP of tabular CSVs (+ AOI / optional GeoTIFF)
// for use in an external training or study workspace.
func (a *App) ExportResearchPack(meta analysis.ResearchExportMeta, result *analysis.PredictResult) (string, error) {
	if result == nil {
		return "", errors.New("no analysis result to export")
	}
	dataDir := ""
	if st := a.currentStore(); st != nil {
		dataDir = st.DataDir()
	}
	zipBytes, err := research.BuildResearchPackZIP(meta, result, dataDir)
	if err != nil {
		return "", err
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export research pack",
		DefaultFilename: research.DefaultResearchPackFilename(meta.AoiLabel),
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".zip") {
		dest += ".zip"
	}
	if err := os.WriteFile(dest, zipBytes, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}

/*
ExportBackup writes the local database and its files to a ZIP the user places.

Everything this application saves lives in one directory on one machine: there
is no server and no account holding a second copy, so a reinstalled laptop
takes every analysis and project with it. This is the only way out.

Password hashes and session tokens are left out of the archive. A backup is a
file people mail to themselves and attach to support threads, and any of those
turns a stored credential into one that has left the machine. Restoring returns
the analyses and projects and asks for a new password; the archive says so in
its README, and so does the button that makes it.

Returns the path written, or an empty string when the user cancels the dialog.
*/

func (a *App) ExportBackup() (string, error) {
	st := a.currentStore()
	if st == nil {
		return "", errors.New("the local store is not open")
	}

	// Built before the dialog opens. A large history takes a moment to archive,
	// and doing it after would leave the user looking at a chosen filename with
	// nothing happening, unable to tell a slow write from a stuck one.
	zipBytes, err := st.ExportBackup(a.GetAppVersion())
	if err != nil {
		return "", err
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export backup",
		DefaultFilename: store.DefaultBackupFilename(time.Now()),
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".zip") {
		dest += ".zip"
	}
	if err := os.WriteFile(dest, zipBytes, 0o600); err != nil {
		return "", err
	}
	return dest, nil
}

// ChooseBackupArchive opens a file dialog and describes the archive picked,
// without changing anything.
//
// Separate from RestoreBackup so the user is told what they are about to get
// and what it will displace before it happens. A restore replaces everything;
// an operation of that weight should not be one click from a file dialog.
func (a *App) ChooseBackupArchive() (*store.RestorePreview, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}

	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose a TERRA backup",
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // Cancelled.
	}

	preview, err := st.InspectBackup(path)
	if err != nil {
		return nil, err
	}
	preview.ArchivePath = path
	return preview, nil
}

/*
RestoreBackup replaces the local data with the archive at the given path.

The path comes from ChooseBackupArchive rather than from the frontend picking a
file itself, so the thing restored is the thing that was described.

The store is closed, replaced and reopened here. The database file is swapped
underneath the connection, and a connection held across that points at a file
that no longer exists -- so every later query would fail in a way that looks
like corruption rather than like a restore.
*/

func (a *App) RestoreBackup(archivePath string) (*store.RestoreResult, error) {
	if strings.TrimSpace(archivePath) == "" {
		return nil, errors.New("no backup was chosen")
	}

	st := a.currentStore()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}

	// Checked again here, not only in the preview: the file may have been
	// replaced between describing it and restoring it, and this is the last
	// point at which refusing costs nothing.
	preview, err := st.InspectBackup(archivePath)
	if err != nil {
		return nil, err
	}
	if preview.Problem != "" {
		return nil, errors.New(preview.Problem)
	}

	// Dropped from the field before it is closed. Close leaves the pointer
	// valid and its database shut, so between here and the reopen below --
	// extraction, verification, a directory rename -- every concurrent binding
	// call reached the driver and came back "sql: database is closed" instead
	// of being told the store was unavailable.
	a.mu.Lock()
	a.store = nil
	a.mu.Unlock()

	// Closed before the swap. RestoreBackup renames the directory this
	// connection's file lives in.
	if err := st.Close(); err != nil {
		return nil, fmt.Errorf("closing the local store: %w", err)
	}

	result, restoreErr := st.RestoreBackup(archivePath)

	// Reopened whether or not the restore worked. A failed restore leaves the
	// previous data in place, and leaving the application with a closed store
	// would turn a recoverable failure into one that needs a relaunch.
	reopened, openErr := store.Open()
	if openErr != nil {
		if restoreErr != nil {
			return nil, restoreErr
		}
		return nil, fmt.Errorf("the data was restored but could not be reopened: %w", openErr)
	}
	a.mu.Lock()
	a.store = reopened
	// The session belonged to the replaced database. Restored accounts carry no
	// password hash, so there is nothing to be signed in as.
	a.currentUser = nil
	a.sessionToken = ""
	a.mu.Unlock()

	if restoreErr != nil {
		return nil, restoreErr
	}
	return result, nil
}

// InspectStorage reports what the local data is made of.
//
// Measured by walking the directory rather than inferred from the database:
// the database records what was saved, not what is on disk, and this screen is
// only worth having if it is believed when it says where the space went.
func (a *App) InspectStorage() (*store.StorageReport, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}
	return st.InspectStorage()
}

// PurgeOrphanedRunAssets removes run files with no analysis pointing at them.
//
// The only deletion offered without naming what is being deleted, because
// these are the only files nothing can reach. Anything else is removed by
// removing the analysis it belongs to, which the user does deliberately.
func (a *App) PurgeOrphanedRunAssets() (*store.PurgeResult, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}
	removed, freed, err := st.PurgeOrphanedRunAssets()
	if err != nil {
		return nil, err
	}
	return &store.PurgeResult{Removed: removed, FreedBytes: freed}, nil
}

// ExportOverlayFile saves an overlay asset via SaveFileDialog.
// src may be a filesystem path or a data:image/png;base64,... URI.
func (a *App) ExportOverlayFile(src string, defaultFilename string) (string, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return "", errors.New("no overlay to export")
	}
	if strings.TrimSpace(defaultFilename) == "" {
		defaultFilename = "terra_overlay.png"
	}

	ext := strings.ToLower(filepath.Ext(defaultFilename))
	filters := []wruntime.FileFilter{
		{DisplayName: "PNG", Pattern: "*.png"},
		{DisplayName: "GeoTIFF", Pattern: "*.tif;*.tiff"},
	}
	switch ext {
	case ".tif", ".tiff":
		filters = []wruntime.FileFilter{
			{DisplayName: "GeoTIFF", Pattern: "*.tif;*.tiff"},
		}
	case ".png":
		filters = []wruntime.FileFilter{
			{DisplayName: "PNG", Pattern: "*.png"},
		}
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export overlay",
		DefaultFilename: defaultFilename,
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}

	if strings.HasPrefix(src, "data:") {
		raw, err := decodeDataURI(src)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(dest, raw, 0o644); err != nil {
			return "", err
		}
		return dest, nil
	}

	if _, err := os.Stat(src); err != nil {
		return "", fmt.Errorf("overlay file not found (re-apply or re-run to regenerate): %s", src)
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	// Closed here rather than deferred and dropped. A write can fail for the
	// first time at Close -- a full disk or an exceeded quota is reported when
	// the last buffered bytes are flushed -- and discarding that error handed
	// back the path of a truncated file as an export that had worked.
	if err := out.Close(); err != nil {
		return "", err
	}
	return dest, nil
}

func decodeDataURI(uri string) ([]byte, error) {
	const marker = "base64,"
	i := strings.Index(uri, marker)
	if i < 0 {
		return nil, errors.New("unsupported data URI")
	}
	return base64.StdEncoding.DecodeString(uri[i+len(marker):])
}
