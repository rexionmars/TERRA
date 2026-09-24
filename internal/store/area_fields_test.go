package store

/*
Fields inside an area: one level, named among their siblings, replaced as a set
by a later delineation, and gone with the area they were found in.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func seedRoot(t *testing.T, s *Store, p *Project) *Area {
	t.Helper()
	a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: someGround})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func fieldsNamed(names ...string) []Area {
	out := make([]Area, len(names))
	for i, n := range names {
		out[i] = Area{Name: n, PolygonGeoJSON: someGround}
	}
	return out
}

func seedRunOn(t *testing.T, s *Store, p *Project, areaID, id string) {
	t.Helper()
	if _, err := s.SaveRun(InferenceRun{
		ID: id, UserID: LocalUserID, CreatedAt: nowISO(), ModelKind: "spectral",
		Status: "ok", PolygonGeoJSON: someGround, ProjectID: p.ID, AreaID: areaID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(s.RunsDir(id), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.RunsDir(id), "overlay.png"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestAFieldIsAnAreaWithAParentAndHoldsNoFields(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)

	field, err := s.CreateArea(LocalUserID, Area{
		ProjectID: p.ID, ParentID: root.ID, Name: "field", PolygonGeoJSON: someGround,
	})
	if err != nil {
		t.Fatal(err)
	}
	if field.ParentID != root.ID {
		t.Errorf("field parent is %q, want %q", field.ParentID, root.ID)
	}
	got, err := s.GetArea(LocalUserID, field.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentID != root.ID {
		t.Errorf("parent did not survive the round trip: %q", got.ParentID)
	}

	if _, err := s.CreateArea(LocalUserID, Area{
		ProjectID: p.ID, ParentID: field.ID, PolygonGeoJSON: someGround,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("a field inside a field returned %v, want ErrInvalidInput", err)
	}

	other := seedProject(t, s, "Elsewhere")
	if _, err := s.CreateArea(LocalUserID, Area{
		ProjectID: other.ID, ParentID: root.ID, PolygonGeoJSON: someGround,
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("a parent in another project returned %v, want ErrNotFound", err)
	}
}

// "field 1" is the first field of each area, not a name one area takes from the
// others; and roots are numbered among roots, whatever their fields are called.
func TestNamesAreNumberedAmongSiblings(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	first := seedRoot(t, s, p)
	second := seedRoot(t, s, p)
	if second.Name != "drawn 2" {
		t.Fatalf("second root is %q, want %q", second.Name, "drawn 2")
	}

	for _, root := range []*Area{first, second} {
		got, err := s.AdoptFields(LocalUserID, root.ID, "run-"+root.ID, fieldsNamed("field 1", "field 2"), false)
		if err != nil {
			t.Fatal(err)
		}
		if got[0].Name != "field 1" || got[1].Name != "field 2" {
			t.Errorf("fields of %s named %q, %q", root.Name, got[0].Name, got[1].Name)
		}
	}
	third := seedRoot(t, s, p)
	if third.Name != "drawn 3" {
		t.Errorf("a root after fields is %q, want %q", third.Name, "drawn 3")
	}
}

func TestAdoptingAgainReplacesOnlyWhatADelineationMade(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)

	// One field drawn by hand, which no delineation may touch.
	drawn, err := s.CreateArea(LocalUserID, Area{
		ProjectID: p.ID, ParentID: root.ID, Name: "field 1", PolygonGeoJSON: someGround,
	})
	if err != nil {
		t.Fatal(err)
	}

	first, err := s.AdoptFields(LocalUserID, root.ID, "run-a", fieldsNamed("field 1", "field 2"), false)
	if err != nil {
		t.Fatal(err)
	}
	// The hand-drawn field holds "field 1", so the adopted one is numbered.
	if first[0].Name != "field 1 2" || first[0].SourceRunID != "run-a" {
		t.Errorf("adopted field is %q from %q", first[0].Name, first[0].SourceRunID)
	}
	seedRunOn(t, s, p, first[1].ID, "run-on-adopted")

	if _, err := s.AdoptFields(LocalUserID, root.ID, "run-b", fieldsNamed("field 1"), false); !errors.Is(err, ErrFieldsExist) {
		t.Fatalf("adopting over adopted fields without replace returned %v, want ErrFieldsExist", err)
	}

	second, err := s.AdoptFields(LocalUserID, root.ID, "run-b", fieldsNamed("field 1", "field 2", "field 3"), true)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 3 {
		t.Fatalf("adopted %d fields, want 3", len(second))
	}

	areas, err := s.ListAreas(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	children := map[string]Area{}
	for _, a := range areas {
		if a.ParentID == root.ID {
			children[a.ID] = a
		}
	}
	if _, ok := children[drawn.ID]; !ok {
		t.Error("the field drawn by hand was removed by a delineation")
	}
	for _, a := range first {
		if _, ok := children[a.ID]; ok {
			t.Errorf("field %s from the replaced delineation is still listed", a.Name)
		}
	}
	if len(children) != 4 {
		t.Errorf("area holds %d fields, want 4 (1 drawn + 3 adopted)", len(children))
	}
	if _, err := s.GetRun(LocalUserID, "run-on-adopted"); !errors.Is(err, ErrNotFound) {
		t.Errorf("a run of a replaced field survived: %v", err)
	}
	if _, err := os.Stat(s.RunsDir("run-on-adopted")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the rasters of a replaced field's run survived: %v", err)
	}
}

func TestFieldsAreAdoptedOnlyIntoARootOfThisUser(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)
	got, err := s.AdoptFields(LocalUserID, root.ID, "run-a", fieldsNamed("field 1"), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdoptFields(LocalUserID, got[0].ID, "run-b", fieldsNamed("field 1"), false); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("adopting into a field returned %v, want ErrInvalidInput", err)
	}
	other, _, err := s.Register("someone@example.com", "hunter22", "Someone")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdoptFields(other.ID, root.ID, "run-c", fieldsNamed("field 1"), false); !errors.Is(err, ErrNotFound) {
		t.Errorf("adopting into another user's area returned %v, want ErrNotFound", err)
	}
	if _, err := s.AdoptFields(LocalUserID, root.ID, "run-d", nil, false); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("adopting no fields returned %v, want ErrInvalidInput", err)
	}
}

func TestDeletingAnAreaTakesItsFieldsAndTheirRuns(t *testing.T) {
	s := openTestStore(t)
	p := seedProject(t, s, "Paraná")
	root := seedRoot(t, s, p)
	kept := seedRoot(t, s, p)
	fields, err := s.AdoptFields(LocalUserID, root.ID, "run-a", fieldsNamed("field 1", "field 2"), false)
	if err != nil {
		t.Fatal(err)
	}
	seedRunOn(t, s, p, root.ID, "run-on-root")
	seedRunOn(t, s, p, fields[0].ID, "run-on-field")

	if err := s.DeleteArea(LocalUserID, root.ID); err != nil {
		t.Fatal(err)
	}
	areas, err := s.ListAreas(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(areas) != 1 || areas[0].ID != kept.ID {
		t.Errorf("after the delete the project holds %d areas, want only %s", len(areas), kept.Name)
	}
	for _, id := range []string{"run-on-root", "run-on-field"} {
		if _, err := s.GetRun(LocalUserID, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("run %s survived its ground: %v", id, err)
		}
		if _, err := os.Stat(s.RunsDir(id)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("the rasters of %s survived: %v", id, err)
		}
	}

	// Deleting one field leaves the area and its other fields alone.
	fields, err = s.AdoptFields(LocalUserID, kept.ID, "run-b", fieldsNamed("field 1", "field 2"), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteArea(LocalUserID, fields[0].ID); err != nil {
		t.Fatal(err)
	}
	areas, err = s.ListAreas(LocalUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(areas) != 2 {
		t.Errorf("after deleting one field the project holds %d areas, want 2", len(areas))
	}
}

// A file at version 5 has an areas table without the two columns; opening it
// adds them and reads every existing area as a root.
func TestAVersionFiveDatabaseGainsFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), dbFileName)
	s := openStoreOnFile(t, path)
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	p := seedProject(t, s, "Before fields")
	root := seedRoot(t, s, p)
	for _, stmt := range []string{
		`DROP INDEX idx_areas_parent`,
		`ALTER TABLE areas DROP COLUMN parent_id`,
		`ALTER TABLE areas DROP COLUMN source_run_id`,
		`PRAGMA user_version = 5`,
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	assertCurrentShape(t, s)
	got, err := s.GetArea(LocalUserID, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentID != "" || got.SourceRunID != "" {
		t.Errorf("an area from before fields reads parent %q, source %q", got.ParentID, got.SourceRunID)
	}
}
