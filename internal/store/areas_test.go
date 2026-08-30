package store

/*
What an area owns, and what happens when it goes.

The cascade is the part worth testing. Foreign keys here are declared and never
enforced, so nothing in the database stops a run from outliving the ground it
was measured on -- only the statements in DeleteArea do, and a statement that is
quietly wrong leaves rows pointing at nothing with no error anywhere.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func seedProject(t *testing.T, s *Store, name string) *Project {
	t.Helper()
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

const someGround = `{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[0,0]]]}`

// An area belongs to a project, and takes its user from it rather than from the
// caller: the invariant every other query in this package then relies on.
func TestCreateAreaTakesItsUserFromTheProject(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Tocantins")

	a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: someGround})
	if err != nil {
		t.Fatal(err)
	}
	if a.UserID != p.UserID {
		t.Errorf("area user is %q, project user is %q", a.UserID, p.UserID)
	}
	if a.Name != "drawn" {
		t.Errorf("first unnamed area is %q, want %q", a.Name, "drawn")
	}

	// A project that is not this caller's is reported as absent rather than as
	// forbidden, so the answer cannot be used to discover which ids exist.
	other, _, err := s.Register("someone@example.com", "hunter22", "Someone")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateArea(other.ID, Area{
		ProjectID: p.ID, PolygonGeoJSON: someGround,
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("creating an area in another user's project returned %v, want ErrNotFound", err)
	}
}

// The provisional names run within a project and start over in the next one:
// two fields called "drawn" in two projects is not a collision.
func TestDrawnNamesAreNumberedPerProject(t *testing.T) {
	s := openTestStore(t)
	first := seedProject(t, s, "First")
	second := seedProject(t, s, "Second")

	for _, want := range []string{"drawn", "drawn 2", "drawn 3"} {
		a, err := s.CreateArea(LocalUserID, Area{
			ProjectID: first.ID, PolygonGeoJSON: someGround,
		})
		if err != nil {
			t.Fatal(err)
		}
		if a.Name != want {
			t.Errorf("area named %q, want %q", a.Name, want)
		}
	}
	a, err := s.CreateArea(LocalUserID, Area{
		ProjectID: second.ID, PolygonGeoJSON: someGround,
	})
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "drawn" {
		t.Errorf("the first area of a second project is %q, want %q", a.Name, "drawn")
	}
}

// Deleting a ground takes the measurements of it: their rows, their rasters on
// disk, and the board members that named them.
func TestDeleteAreaTakesItsRuns(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Doomed ground")
	a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: someGround})
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.SaveRun(InferenceRun{
		ID: "run-on-area", UserID: LocalUserID, CreatedAt: nowISO(),
		ModelKind: "spectral", Status: "ok",
		PolygonGeoJSON: someGround, ProjectID: p.ID, AreaID: a.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	// A raster where the run's assets live, and a board naming it.
	assets := s.RunsDir(run.ID)
	if err := os.MkdirAll(assets, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "prediction.png"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveStudio(Studio{
		UserID: LocalUserID, Name: "A board",
		Members: []StudioMember{{RunID: run.ID}},
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteArea(LocalUserID, a.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := s.GetRun(LocalUserID, run.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("the run outlived the ground it measured: %v", err)
	}
	if _, err := os.Stat(assets); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the run's rasters outlived it: %v", err)
	}
	var members int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM studio_members WHERE run_id = ?`, run.ID,
	).Scan(&members); err != nil {
		t.Fatal(err)
	}
	if members != 0 {
		t.Errorf("%d board member(s) still name a run that is gone", members)
	}
}

// Deleting a run leaves no reference to it behind. The board's Missing
// reporting is for a gap this code does not create; a row it does create and
// then abandons is different.
func TestDeleteRunClearsWhatPointedAtIt(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "A project")
	run, err := s.SaveRun(InferenceRun{
		ID: "run-referenced", UserID: LocalUserID, CreatedAt: nowISO(),
		ModelKind: "spectral", Status: "ok", PolygonGeoJSON: someGround, ProjectID: p.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddProjectOverlay(LocalUserID, ProjectOverlay{
		ProjectID: p.ID, RunID: run.ID, Title: "Composition",
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteRun(LocalUserID, run.ID); err != nil {
		t.Fatal(err)
	}

	overlays, err := s.ListProjectOverlays(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(overlays) != 1 {
		t.Fatalf("the composition was deleted with the run (%d left)", len(overlays))
	}
	if overlays[0].RunID != "" {
		t.Errorf("the composition still names run %q, which is gone", overlays[0].RunID)
	}
}

// The omission the hub depends on: a run read through its project names the
// ground it is of, the way it does when read any other way.
func TestListRunsByProjectCarriesTheArea(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "A project")
	a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: someGround})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveRun(InferenceRun{
		ID: "run-with-area", UserID: LocalUserID, CreatedAt: nowISO(),
		ModelKind: "spectral", Status: "ok",
		PolygonGeoJSON: someGround, ProjectID: p.ID, AreaID: a.ID,
	}); err != nil {
		t.Fatal(err)
	}

	runs, err := s.ListRunsByProject(LocalUserID, p.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("listed %d runs, want 1", len(runs))
	}
	if runs[0].AreaID != a.ID {
		t.Errorf("run read through its project names area %q, want %q", runs[0].AreaID, a.ID)
	}

	byArea, err := s.ListRunsByArea(LocalUserID, a.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(byArea) != 1 || byArea[0].ID != "run-with-area" {
		t.Errorf("listing by area returned %d run(s)", len(byArea))
	}
}
