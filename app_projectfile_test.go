package main

import (
	"path/filepath"
	"testing"
)

// Files the system opens before the interface exists are held, handed over
// once, in order, and not again.
func TestTakeOpenedFilesHandsEachPathOverOnce(t *testing.T) {
	a := NewApp()
	if got := a.TakeOpenedFiles(); len(got) != 0 {
		t.Fatalf("nothing opened, got %v", got)
	}
	a.fileOpened("/x/one.terra")
	a.fileOpened("/x/two.terra")
	got := a.TakeOpenedFiles()
	if len(got) != 2 || got[0] != "/x/one.terra" || got[1] != "/x/two.terra" {
		t.Fatalf("got %v", got)
	}
	if again := a.TakeOpenedFiles(); len(again) != 0 {
		t.Fatalf("handed over twice: %v", again)
	}
}

func TestSafeFileName(t *testing.T) {
	for in, want := range map[string]string{
		"Field north":     "Field north",
		"a/b:c":           "a-b-c",
		"  ":              "Project",
		"..":              "Project",
		"Soja 2026 <v2>?": "Soja 2026 -v2--",
	} {
		if got := safeFileName(in); got != want {
			t.Errorf("safeFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

// Through the bindings, with a path given: what the interface does after its
// own dialog, or for a file the Finder opened.
func TestProjectFileBindingsRoundTrip(t *testing.T) {
	a := newTestApp(t)
	signIn(t, a, "files@terra.test")
	p := mustCreateProject(t, a, "Field")
	path := filepath.Join(t.TempDir(), "Field")

	saved, err := a.SaveProjectFile(p.ID, path)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Path != path+".terra" || saved.ProjectID != p.ID {
		t.Fatalf("saved: %+v", saved)
	}
	opened, err := a.OpenProjectFile(saved.Path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.ProjectID != p.ID || opened.ProjectName != "Field" {
		t.Fatalf("opened: %+v", opened)
	}
}
