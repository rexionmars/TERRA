package main

/*
The saved-board API.

Thin over backend/store: every method resolves the effective user and hands
through. The rules that matter -- a member must name a run the user owns, a
board is saved whole, a deleted run leaves its member marked rather than
dropped -- live in the store, where they are reachable by a test that needs no
running application.
*/

import (
	"context"
	"fmt"

	"geosense-infer/internal/store"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SaveStudio creates or replaces a named board arrangement.
func (a *App) SaveStudio(c store.Studio) (*store.Studio, error) {
	st := a.currentStore()
	if st == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	c.UserID = a.effectiveUserID()
	return st.SaveStudio(c)
}

// ListStudios returns one project's arrangements, most recent first, with a
// member count rather than the members themselves. An empty projectID returns
// every board the user has, which is what the storage view asks for.
func (a *App) ListStudios(projectID string) ([]store.Studio, error) {
	st := a.currentStore()
	if st == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return st.ListStudios(a.effectiveUserID(), projectID)
}

// GetStudio returns one arrangement with its members in board order.
func (a *App) GetStudio(studioID string) (*store.Studio, error) {
	st := a.currentStore()
	if st == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return st.GetStudio(a.effectiveUserID(), studioID)
}

// RenameStudio changes the name without touching the members.
func (a *App) RenameStudio(studioID, name string) error {
	st := a.currentStore()
	if st == nil {
		return fmt.Errorf("store unavailable")
	}
	return st.RenameStudio(a.effectiveUserID(), studioID, name)
}

// DeleteStudio removes an arrangement and its members. The runs it named
// are untouched: a studio holds no rasters of its own.
func (a *App) DeleteStudio(studioID string) error {
	st := a.currentStore()
	if st == nil {
		return fmt.Errorf("store unavailable")
	}
	return st.DeleteStudio(a.effectiveUserID(), studioID)
}

// SetBoardDirty records whether the board holds changes no saved studio does.
// The interface owns the board and so is the only side that knows; the shell
// needs the answer at close, when there is no time to ask the webview.
func (a *App) SetBoardDirty(dirty bool) {
	a.boardDirty.Store(dirty)
}

// beforeClose asks before a close would discard an unsaved board, and reports
// whether to prevent it. Wails routes both the window's close button and Quit
// through here, so Cmd-Q is asked about as well.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if !a.boardDirty.Load() {
		return false
	}
	answer, err := wruntime.MessageDialog(ctx, wruntime.MessageDialogOptions{
		Type:          wruntime.QuestionDialog,
		Title:         "Unsaved studio",
		Message:       "The board has changes no saved studio holds. Quit without saving them?",
		Buttons:       []string{"Quit", "Cancel"},
		DefaultButton: "Cancel",
		CancelButton:  "Cancel",
	})
	if err != nil {
		// Kept open: a dialog that failed has not been answered, and closing
		// would discard what it was meant to protect. Saving clears the flag,
		// so the window can still be closed.
		return true
	}
	// macOS returns the label of the button pressed. Windows and Linux ignore
	// the labels and show Yes and No; Yes answers the question as asked.
	return answer != "Quit" && answer != "Yes"
}
