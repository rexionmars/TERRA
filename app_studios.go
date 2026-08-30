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
	"fmt"

	"geosense-infer/internal/store"
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
