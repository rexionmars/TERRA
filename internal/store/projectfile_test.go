package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fieldProject is a project with one of everything a file carries: an area, a
// run with its folder and overlay, a composition with its PNG, and a studio
// arranging the run.
type fieldProject struct {
	userID, projectID, areaID, runID, overlayID, studioID string
	overlayRel                                            string
}

func seedFieldProject(t *testing.T, s *Store, email string) fieldProject {
	t.Helper()
	u, _, err := s.Register(email, "secret12", "Field")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject(Project{UserID: u.ID, Name: "Field"})
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateArea(u.ID, Area{ProjectID: p.ID, Name: "North plot", PolygonGeoJSON: `{"type":"Polygon","coordinates":[]}`})
	if err != nil {
		t.Fatal(err)
	}
	runID := "run-field-1"
	assets := filepath.Join("runs", runID)
	writeTestFile(t, filepath.Join(s.DataDir(), assets, "overlay.png"), "png bytes")
	writeTestFile(t, filepath.Join(s.DataDir(), assets, "prediction.tif"), "tif bytes")
	if _, err := s.SaveRun(InferenceRun{
		ID: runID, UserID: u.ID, CreatedAt: nowISO(), ModelKind: "spectral",
		PeriodStart: "2026-01-01", PeriodEnd: "2026-03-01", PolygonGeoJSON: `{}`,
		Status: "ok", SummaryJSON: `{"n":1}`, ResultJSON: `{"extent":{}}`,
		OverlayRelPath: filepath.Join(assets, "overlay.png"), AssetsRelPath: assets,
		Label: "run-field", ProjectID: p.ID, AreaID: a.ID, Kind: RunKindClassification,
	}); err != nil {
		t.Fatal(err)
	}
	overlayRel := filepath.Join("projects", p.ID, "overlays", "c1.png")
	writeTestFile(t, filepath.Join(s.DataDir(), overlayRel), "composition bytes")
	o, err := s.AddProjectOverlay(u.ID, ProjectOverlay{
		ProjectID: p.ID, RunID: runID, AreaID: a.ID, Title: "False colour", PNGRelPath: overlayRel,
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.SaveStudio(Studio{
		UserID: u.ID, ProjectID: p.ID, Name: "Compare north", ViewJSON: `{"gap":0.1}`,
		Members: []StudioMember{{RunID: runID, Position: 0}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return fieldProject{u.ID, p.ID, a.ID, runID, o.ID, c.ID, overlayRel}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readTestFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestProjectFileRoundTrip(t *testing.T) {
	a := openTestStore(t)
	f := seedFieldProject(t, a, "a@field.test")
	dir := t.TempDir()

	sum, err := a.SaveProjectFile(f.userID, f.projectID, filepath.Join(dir, "Field"), "0.6.0")
	if err != nil {
		t.Fatal(err)
	}
	if sum.Path != filepath.Join(dir, "Field.terra") {
		t.Fatalf("the extension was not added: %s", sum.Path)
	}
	if sum.Runs != 1 || sum.Areas != 1 || sum.Overlays != 1 || sum.Studios != 1 || sum.MissingAssets != 0 {
		t.Fatalf("summary: %+v", sum)
	}
	data := filepath.Join(dir, "Field.terra-data")
	if got := readTestFile(t, filepath.Join(data, "runs", f.runID, "prediction.tif")); got != "tif bytes" {
		t.Fatalf("run folder not carried: %q", got)
	}
	if got := readTestFile(t, filepath.Join(data, f.overlayRel)); got != "composition bytes" {
		t.Fatalf("composition not carried: %q", got)
	}
	// No user of this machine travels with the file.
	if strings.Contains(readTestFile(t, sum.Path), f.userID) {
		t.Fatal("the document names the user who saved it")
	}

	// Another machine: another store, another account.
	b := openTestStore(t)
	u, _, err := b.Register("b@field.test", "secret12", "Other")
	if err != nil {
		t.Fatal(err)
	}
	opened, err := b.OpenProjectFile(u.ID, sum.Path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.ProjectID != f.projectID || opened.MissingAssets != 0 {
		t.Fatalf("opened: %+v", opened)
	}
	run, err := b.GetRun(u.ID, f.runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.AreaID != f.areaID || run.SummaryJSON != `{"n":1}` || run.ProjectID != f.projectID {
		t.Fatalf("run came back as %+v", run)
	}
	if got := readTestFile(t, b.AbsDataPath(run.OverlayRelPath)); got != "png bytes" {
		t.Fatalf("overlay not restored: %q", got)
	}
	studio, err := b.GetStudio(u.ID, f.studioID)
	if err != nil {
		t.Fatal(err)
	}
	if len(studio.Members) != 1 || studio.Members[0].RunID != f.runID || studio.ViewJSON != `{"gap":0.1}` {
		t.Fatalf("studio came back as %+v", studio)
	}
	overlays, err := b.ListProjectOverlays(u.ID, f.projectID)
	if err != nil || len(overlays) != 1 || overlays[0].ID != f.overlayID {
		t.Fatalf("overlays: %+v, %v", overlays, err)
	}

	// Opened again, nothing doubles; work made here since is kept.
	if _, err := b.SaveRun(InferenceRun{
		ID: "run-local", UserID: u.ID, CreatedAt: nowISO(), ModelKind: "spectral",
		PeriodStart: "2026-01-01", PeriodEnd: "2026-02-01", PolygonGeoJSON: `{}`,
		Status: "ok", ProjectID: f.projectID, Kind: RunKindClassification,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.OpenProjectFile(u.ID, sum.Path); err != nil {
		t.Fatal(err)
	}
	runs, err := b.ListRunsByProject(u.ID, f.projectID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("after opening twice with a local run, %d runs", len(runs))
	}
	areas, err := b.ListAreas(u.ID, f.projectID)
	if err != nil || len(areas) != 1 {
		t.Fatalf("areas after opening twice: %d, %v", len(areas), err)
	}
	studio, err = b.GetStudio(u.ID, f.studioID)
	if err != nil || len(studio.Members) != 1 {
		t.Fatalf("members after opening twice: %+v, %v", studio, err)
	}
}

func TestProjectFileSaveDropsWhatTheProjectNoLongerHolds(t *testing.T) {
	s := openTestStore(t)
	f := seedFieldProject(t, s, "prune@field.test")
	path := filepath.Join(t.TempDir(), "Field.terra")
	if _, err := s.SaveProjectFile(f.userID, f.projectID, path, "0.6.0"); err != nil {
		t.Fatal(err)
	}
	runFolder := filepath.Join(projectDataDir(path), "runs", f.runID)
	if !isDir(runFolder) {
		t.Fatal("the run folder was not written")
	}
	if err := s.DeleteRun(f.userID, f.runID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveProjectFile(f.userID, f.projectID, path, "0.6.0"); err != nil {
		t.Fatal(err)
	}
	if exists(runFolder) {
		t.Fatal("a deleted run's folder stayed in the data folder")
	}
	if !exists(filepath.Join(projectDataDir(path), f.overlayRel)) {
		t.Fatal("the composition, still in the project, was removed")
	}
}

func TestProjectFileRefusals(t *testing.T) {
	s := openTestStore(t)
	f := seedFieldProject(t, s, "owner@field.test")
	dir := t.TempDir()
	saved, err := s.SaveProjectFile(f.userID, f.projectID, filepath.Join(dir, "Field.terra"), "0.6.0")
	if err != nil {
		t.Fatal(err)
	}

	// Another account on the same machine cannot take it over by id.
	other, _, err := s.Register("other@field.test", "secret12", "Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenProjectFile(other.ID, saved.Path); !errors.Is(err, ErrProjectOwnedElsewhere) {
		t.Fatalf("opened another account's project: %v", err)
	}

	rewrite := func(name string, edit func(map[string]any)) string {
		var doc map[string]any
		if err := json.Unmarshal([]byte(readTestFile(t, saved.Path)), &doc); err != nil {
			t.Fatal(err)
		}
		edit(doc)
		raw, _ := json.Marshal(doc)
		p := filepath.Join(dir, name+".terra")
		writeTestFile(t, p, string(raw))
		return p
	}
	cases := []struct {
		name string
		edit func(map[string]any)
		want error
	}{
		{"climbs-out", func(d map[string]any) {
			d["runs"].([]any)[0].(map[string]any)["assets_relpath"] = "../../outside"
		}, ErrNotAProjectFile},
		{"names-the-database", func(d map[string]any) {
			d["runs"].([]any)[0].(map[string]any)["assets_relpath"] = "terra.db"
		}, ErrNotAProjectFile},
		{"solara", func(d map[string]any) { d["format"] = solaraProjectFormat }, ErrNotAProjectFile},
		{"newer", func(d map[string]any) { d["version"] = 99 }, ErrProjectFileNewer},
		{"another-project", func(d map[string]any) {
			d["areas"].([]any)[0].(map[string]any)["project_id"] = "someone-else"
		}, ErrNotAProjectFile},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := s.OpenProjectFile(f.userID, rewrite(c.name, c.edit)); !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}

	notJSON := filepath.Join(dir, "notes.terra")
	writeTestFile(t, notJSON, "not a document")
	if _, err := s.OpenProjectFile(f.userID, notJSON); !errors.Is(err, ErrNotAProjectFile) {
		t.Fatalf("opened a text file: %v", err)
	}
}

func TestProjectFilePath(t *testing.T) {
	for in, want := range map[string]string{
		"/x/Field":       "/x/Field.terra",
		"/x/Field.terra": "/x/Field.terra",
		"/x/Field.TERRA": "/x/Field.TERRA",
		"/x/Field.json":  "/x/Field.json.terra",
	} {
		if got := ProjectFilePath(in); got != want {
			t.Errorf("ProjectFilePath(%q) = %q, want %q", in, got, want)
		}
	}
}
