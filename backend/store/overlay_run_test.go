package store

import (
	"path/filepath"
	"testing"
)

// TestOverlayCarriesItsRun covers the association added so a composition made
// under one run does not surface while a different run is open.
func TestOverlayCarriesItsRun(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: "P"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.AddProjectOverlay(LocalUserID, ProjectOverlay{
		ProjectID: p.ID, RunID: "run-a", Title: "with run",
	}); err != nil {
		t.Fatal(err)
	}
	// A composition made with no run open: browsing scenes needs none.
	if _, err := s.AddProjectOverlay(LocalUserID, ProjectOverlay{
		ProjectID: p.ID, Title: "no run",
	}); err != nil {
		t.Fatal(err)
	}

	rows, err := s.ListProjectOverlays(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, r := range rows {
		got[r.Title] = r.RunID
	}
	if got["with run"] != "run-a" {
		t.Errorf("run id did not survive the round trip: %q", got["with run"])
	}
	// Empty, not the string "NULL" or a scan error: readers branch on it.
	if got["no run"] != "" {
		t.Errorf("a composition made without a run reports %q", got["no run"])
	}
}
