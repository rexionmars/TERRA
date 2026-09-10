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

// TestOverlayCarriesItsArea covers the column that files a composition made
// with no run open. Without it an area worked only by composition could list
// only the composition on the map, so each new one replaced the last.
func TestOverlayCarriesItsArea(t *testing.T) {
	s := openStoreIn(t, filepath.Join(t.TempDir(), "data"))
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: "P"})
	if err != nil {
		t.Fatal(err)
	}

	for _, o := range []ProjectOverlay{
		{ProjectID: p.ID, AreaID: "area-a", Title: "ndvi"},
		{ProjectID: p.ID, AreaID: "area-a", Title: "evi"},
		// Written before the area was carried: must read back as empty, so
		// readers keep scoping it by extent rather than guessing an area.
		{ProjectID: p.ID, Title: "legacy"},
	} {
		if _, err := s.AddProjectOverlay(LocalUserID, o); err != nil {
			t.Fatal(err)
		}
	}

	rows, err := s.ListProjectOverlays(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, r := range rows {
		got[r.Title] = r.AreaID
	}
	for _, title := range []string{"ndvi", "evi"} {
		if got[title] != "area-a" {
			t.Errorf("%s: area did not survive the round trip: %q", title, got[title])
		}
	}
	if got["legacy"] != "" {
		t.Errorf("a composition saved without an area reports %q", got["legacy"])
	}
}
