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

// SaveComparison creates or replaces a named board arrangement.
func (a *App) SaveComparison(c store.Comparison) (*store.Comparison, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	c.UserID = a.effectiveUserID()
	return a.store.SaveComparison(c)
}

// ListComparisons returns the user's arrangements, most recent first, with a
// member count rather than the members themselves.
func (a *App) ListComparisons() ([]store.Comparison, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return a.store.ListComparisons(a.effectiveUserID())
}

// GetComparison returns one arrangement with its members in board order.
func (a *App) GetComparison(comparisonID string) (*store.Comparison, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return a.store.GetComparison(a.effectiveUserID(), comparisonID)
}

// RenameComparison changes the name without touching the members.
func (a *App) RenameComparison(comparisonID, name string) error {
	if a.store == nil {
		return fmt.Errorf("store unavailable")
	}
	return a.store.RenameComparison(a.effectiveUserID(), comparisonID, name)
}

// DeleteComparison removes an arrangement and its members. The runs it named
// are untouched: a comparison holds no rasters of its own.
func (a *App) DeleteComparison(comparisonID string) error {
	if a.store == nil {
		return fmt.Errorf("store unavailable")
	}
	return a.store.DeleteComparison(a.effectiveUserID(), comparisonID)
}
