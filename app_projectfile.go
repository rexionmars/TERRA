package main

/*
Project files: the bindings around store.SaveProjectFile and OpenProjectFile.

The store owns the format and the copying; what is here is what only the shell
can do -- the save and open dialogs, showing a file in the file manager, and
hearing from the system that a .terra file was opened from outside.
*/

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"geosense-infer/internal/store"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var projectFileFilters = []wruntime.FileFilter{
	{DisplayName: "TERRA project (*.terra)", Pattern: "*.terra"},
}

/*
SaveProjectFile writes a project to a .terra file and its data folder.

An empty path asks where, starting from the project's name; a cancelled dialog
returns nothing and no error, which is how the interface tells a cancel from a
save.
*/
func (a *App) SaveProjectFile(projectID, path string) (*store.ProjectFileSummary, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("store unavailable")
	}
	userID := a.effectiveUserID()
	if strings.TrimSpace(path) == "" {
		name := "Project"
		if p, err := st.GetProject(userID, projectID); err == nil && strings.TrimSpace(p.Name) != "" {
			name = p.Name
		}
		chosen, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
			Title:                "Save project file",
			DefaultFilename:      safeFileName(name) + store.ProjectFileExt,
			Filters:              projectFileFilters,
			CanCreateDirectories: true,
		})
		if err != nil || chosen == "" {
			return nil, err
		}
		path = chosen
	}
	return st.SaveProjectFile(userID, projectID, path, AppVersion)
}

// OpenProjectFile reads a .terra file into the user's projects. An empty path
// asks for one; a cancelled dialog returns nothing and no error.
func (a *App) OpenProjectFile(path string) (*store.ProjectFileSummary, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("store unavailable")
	}
	if strings.TrimSpace(path) == "" {
		chosen, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
			Title:   "Open project file",
			Filters: projectFileFilters,
		})
		if err != nil || chosen == "" {
			return nil, err
		}
		path = chosen
	}
	return st.OpenProjectFile(a.effectiveUserID(), path)
}

// RevealProjectFile shows a file in the system file manager: selected in its
// folder on macOS and Windows, and the folder itself elsewhere, where no
// command selects a file portably.
func (a *App) RevealProjectFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	/*
		Background, not the application's context: the file manager outlives
		the call that asked for it, and a context ended with the application
		would kill a window the reader is still looking at.
	*/
	ctx := context.Background()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.CommandContext(ctx, "open", "-R", path)
	case "windows":
		// Two arguments rather than "/select,"+path: os/exec quotes an argument
		// holding a space as a whole, and explorer does not parse a quoted
		// "/select,C:\a b" as the switch.
		cmd = exec.CommandContext(ctx, "explorer", "/select,", path)
	default:
		dir := path
		if !info.IsDir() {
			dir = filepath.Dir(path)
		}
		cmd = exec.CommandContext(ctx, "xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	// Not waited on by the binding: explorer exits 1 even when it succeeds and
	// xdg-open can stay attached to what it launched. Reaped so it does not
	// linger as a zombie.
	go func() { _ = cmd.Wait() }()
	return nil
}

/*
fileOpened is main.go's Mac.OnFileOpen: a .terra file opened from outside, by a
double-click in the Finder or a drop on the Dock icon.

The system can say so before the interface exists -- a double-click is often
what launches the application -- so the paths are held until the interface
takes them, and the event only says that there is something to take. Taking
empties the list, so a path announced and taken at mount is not opened twice.
*/
func (a *App) fileOpened(path string) {
	a.openedMu.Lock()
	a.opened = append(a.opened, path)
	a.openedMu.Unlock()
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "project:file-opened")
	}
}

// TakeOpenedFiles returns the files the system asked to open since the last
// call, oldest first, and forgets them.
func (a *App) TakeOpenedFiles() []string {
	a.openedMu.Lock()
	defer a.openedMu.Unlock()
	out := a.opened
	a.opened = nil
	if out == nil {
		return []string{}
	}
	return out
}

// safeFileName makes a project name usable as a file name on every system the
// application builds for.
func safeFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 32 {
			return '-'
		}
		return r
	}, strings.TrimSpace(name))
	if name == "" || name == "." || name == ".." {
		return "Project"
	}
	return name
}
