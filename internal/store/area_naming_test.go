package store

import "testing"

/*
A stem the caller supplies is numbered the way "drawn" is.

The numbering was moved into this package because a caller cannot see what the
project already holds -- two draws reported in one batch read the same stale
list and produced two areas with one name. A caller that supplies a stem is in
exactly that position: two grounds drawn under one studio, or one file imported
twice, arrive with the same name and no way of knowing it.
*/
func TestCreateAreaNumbersASuppliedStem(t *testing.T) {
	s := openTestStore(t)
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: "Goias"})
	if err != nil {
		t.Fatal(err)
	}

	const poly = `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`
	names := []string{}
	for i := 0; i < 3; i++ {
		a, err := s.CreateArea(LocalUserID, Area{
			ProjectID:      p.ID,
			Name:           "Serra do mel",
			PolygonGeoJSON: poly,
		})
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		names = append(names, a.Name)
	}
	want := []string{"Serra do mel", "Serra do mel 2", "Serra do mel 3"}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("area %d is %q, want %q", i, names[i], want[i])
		}
	}
}

// With no stem the sequence is the one it has always been.
func TestCreateAreaKeepsTheDrawnSequence(t *testing.T) {
	s := openTestStore(t)
	p, err := s.CreateProject(Project{UserID: LocalUserID, Name: "Goias"})
	if err != nil {
		t.Fatal(err)
	}
	const poly = `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`
	for _, want := range []string{"drawn", "drawn 2", "drawn 3"} {
		a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: poly})
		if err != nil {
			t.Fatal(err)
		}
		if a.Name != want {
			t.Errorf("name = %q, want %q", a.Name, want)
		}
	}
}

// The sequence is per project: a second project opens at the start of it
// rather than continuing the first one's count.
func TestProvisionalNamesAreScopedToTheProject(t *testing.T) {
	s := openTestStore(t)
	const poly = `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`
	for _, name := range []string{"Goias", "Tocantins"} {
		p, err := s.CreateProject(Project{UserID: LocalUserID, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		a, err := s.CreateArea(LocalUserID, Area{ProjectID: p.ID, PolygonGeoJSON: poly})
		if err != nil {
			t.Fatal(err)
		}
		if a.Name != "drawn" {
			t.Errorf("first area of %s is %q, want \"drawn\"", name, a.Name)
		}
	}
}
