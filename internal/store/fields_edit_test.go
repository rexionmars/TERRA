package store

/*
Fields corrected by hand: replaced in one transaction by what the edit made,
with the runs over the old ground, and stamped as edited.
*/

import (
	"errors"
	"os"
	"testing"
)

func seedFields(t *testing.T, s *Store, p *Project, root *Area, names ...string) []Area {
	t.Helper()
	seedRunOn(t, s, p, root.ID, "delineation")
	made, err := s.AdoptFields(LocalUserID, root.ID, "delineation", fieldsNamed(names...), false)
	if err != nil {
		t.Fatal(err)
	}
	return made
}

func TestReplacingFieldsTakesTheirRunsAndKeepsTheirNames(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)
	fields := seedFields(t, s, p, root, "field 3", "field 7", "field 9")
	seedRunOn(t, s, p, fields[0].ID, "run-3")
	seedRunOn(t, s, p, fields[2].ID, "run-9")

	made, err := s.ReplaceFields(LocalUserID, []string{fields[0].ID, fields[1].ID}, []Area{{
		Name: "field 3", PolygonGeoJSON: someGround, SourceRunID: "delineation",
	}})
	if err != nil {
		t.Fatal(err)
	}
	got := made[0]
	// The name of a field removed is free for what replaces it.
	if got.Name != "field 3" || got.ParentID != root.ID || got.ProjectID != p.ID {
		t.Errorf("made %q in %q of %q", got.Name, got.ParentID, got.ProjectID)
	}
	if got.EditedAt == "" || got.SourceRunID != "delineation" {
		t.Errorf("edited at %q, source %q", got.EditedAt, got.SourceRunID)
	}
	if _, err := s.GetArea(LocalUserID, fields[1].ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("a joined field is still there: %v", err)
	}
	if _, err := os.Stat(s.RunsDir("run-3")); !os.IsNotExist(err) {
		t.Error("the run over a field replaced kept its directory")
	}
	if _, err := os.Stat(s.RunsDir("run-9")); err != nil {
		t.Error("the run over a field left alone lost its directory")
	}
	all, err := s.ListAreas(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Errorf("project holds %d areas, want the area and 2 fields", len(all))
	}
}

func TestOnlyFieldsOfOneAreaAreReplaced(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	a, b := seedRoot(t, s, p), seedRoot(t, s, p)
	fa := seedFields(t, s, p, a, "field 1")
	made, err := s.AdoptFields(LocalUserID, b.ID, "delineation", fieldsNamed("field 1"), false)
	if err != nil {
		t.Fatal(err)
	}
	one := []Area{{Name: "x", PolygonGeoJSON: someGround}}
	if _, err := s.ReplaceFields(LocalUserID, []string{fa[0].ID, made[0].ID}, one); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("fields of two areas: %v", err)
	}
	if _, err := s.ReplaceFields(LocalUserID, []string{a.ID}, one); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("an area that is not a field: %v", err)
	}
	if _, err := s.ReplaceFields("someone else", []string{fa[0].ID}, one); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's field: %v", err)
	}
	if _, err := s.GetArea(LocalUserID, fa[0].ID); err != nil {
		t.Errorf("a refused edit removed the field: %v", err)
	}
}

func TestReshapingGroundTakesItsRunsAndLeavesItsFields(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)
	fields := seedFields(t, s, p, root, "field 1")
	seedRunOn(t, s, p, fields[0].ID, "run-on-field")

	moved := `{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}`
	got, err := s.ReshapeArea(LocalUserID, root.ID, moved)
	if err != nil {
		t.Fatal(err)
	}
	if got.PolygonGeoJSON != moved || got.EditedAt == "" || got.Name != root.Name {
		t.Errorf("reshaped to %q, edited at %q, named %q", got.PolygonGeoJSON, got.EditedAt, got.Name)
	}
	if _, err := os.Stat(s.RunsDir("delineation")); !os.IsNotExist(err) {
		t.Error("the delineation over the old outline kept its directory")
	}
	if _, err := os.Stat(s.RunsDir("run-on-field")); err != nil {
		t.Error("a field's run went with its area's outline")
	}
	f, err := s.GetArea(LocalUserID, fields[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if f.EditedAt != "" {
		t.Errorf("the field was stamped as edited with its area: %q", f.EditedAt)
	}
	if _, err := s.ReshapeArea("someone else", root.ID, moved); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's area: %v", err)
	}
}
