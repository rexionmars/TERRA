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

	"geosense-infer/backend/store"
)

// SaveWhiteboard creates or replaces a named board arrangement.
func (a *App) SaveWhiteboard(c store.Whiteboard) (*store.Whiteboard, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	c.UserID = a.effectiveUserID()
	return a.store.SaveWhiteboard(c)
}

// ListWhiteboards returns the user's arrangements, most recent first, with a
// member count rather than the members themselves.
func (a *App) ListWhiteboards() ([]store.Whiteboard, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return a.store.ListWhiteboards(a.effectiveUserID())
}

// GetWhiteboard returns one arrangement with its members in board order.
func (a *App) GetWhiteboard(whiteboardID string) (*store.Whiteboard, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return a.store.GetWhiteboard(a.effectiveUserID(), whiteboardID)
}

// RenameWhiteboard changes the name without touching the members.
func (a *App) RenameWhiteboard(whiteboardID, name string) error {
	if a.store == nil {
		return fmt.Errorf("store unavailable")
	}
	return a.store.RenameWhiteboard(a.effectiveUserID(), whiteboardID, name)
}

// DeleteWhiteboard removes an arrangement and its members. The runs it named
// are untouched: a whiteboard holds no rasters of its own.
func (a *App) DeleteWhiteboard(whiteboardID string) error {
	if a.store == nil {
		return fmt.Errorf("store unavailable")
	}
	return a.store.DeleteWhiteboard(a.effectiveUserID(), whiteboardID)
}
