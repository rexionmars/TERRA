package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"geosense-infer/internal/store"
)

// dataURI wraps bytes the way the WebView hands a canvas to a binding.
func dataURI(mime string, body []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(body)
}

func mustCreateProject(t *testing.T, a *App, name string) *store.Project {
	t.Helper()
	p, err := a.CreateProject(name, "")
	if err != nil {
		t.Fatalf("CreateProject(%q): %v", name, err)
	}
	return p
}

// signIn registers an account and leaves the App holding its session, which is
// the only thing that stops the bindings resolving to the local user.
func signIn(t *testing.T, a *App, email string) *store.User {
	t.Helper()
	u, err := a.Register(email, "a-test-password", "Test User")
	if err != nil {
		t.Fatalf("Register(%q): %v", email, err)
	}
	return u
}

func mustSignOut(t *testing.T, a *App) {
	t.Helper()
	if err := a.Logout(); err != nil {
		t.Fatalf("Logout: %v", err)
	}
}

func mustSaveRun(t *testing.T, a *App, userID, label string) string {
	t.Helper()
	run, err := a.store.SaveRun(store.InferenceRun{
		UserID:    userID,
		ModelKind: "spectral",
		Kind:      store.RunKindClassification,
		Status:    "ok",
		Label:     label,
	})
	if err != nil {
		t.Fatalf("SaveRun(%q): %v", label, err)
	}
	return run.ID
}

// overlayFileNames lists what is on disk in a project's overlay folder, with a
// folder that was never created reported as empty rather than as an error.
func overlayFileNames(t *testing.T, a *App, projectID string) []string {
	t.Helper()
	entries, err := os.ReadDir(a.store.ProjectOverlaysDir(projectID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func mustSaveOverlay(t *testing.T, a *App, req SaveProjectOverlayRequest) *store.ProjectOverlay {
	t.Helper()
	row, err := a.SaveProjectOverlay(req)
	if err != nil {
		t.Fatalf("SaveProjectOverlay: %v", err)
	}
	return row
}

// The only binding in this file that writes to the user data directory, and
// every part of what it writes comes off a string the WebView supplied: the
// project id picks the directory, the data URI carries the bytes.
//
// Both halves are asserted because both can fail silently. A composition
// written under a path derived from an unchecked id lands outside the project
// it is listed under; bytes that are re-encoded, truncated or swapped between
// the two files reopen as a picture nobody made. Neither raises anything on
// the way through -- the row saves either way and the project card counts it.
func TestProjectOverlaySaveWritesTheCompositionItWasGiven(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Overlay project")

	png := []byte("\x89PNG\r\n\x1a\nfirst composition bytes")
	tif := []byte("II*\x00raster bytes for the same composition")

	// The id is padded, because the binding trims it before it becomes a path
	// and an untrimmed id would name a directory nothing else can find.
	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  "  " + p.ID + "  ",
		OverlayURI: dataURI("image/png", png),
		RasterTIF:  dataURI("image/tiff", tif),
	})

	if row.ProjectID != p.ID {
		t.Fatalf("overlay saved under project %q, want %q", row.ProjectID, p.ID)
	}
	if row.ID == "" {
		t.Fatal("the saved overlay carries no id, so nothing can delete it later")
	}
	// The three fields the card is drawn from, none of which the caller set.
	if row.Kind != "composition" || row.Title != "Composition" || row.MetaJSON != "{}" {
		t.Fatalf("defaults not applied: kind %q, title %q, meta %q",
			row.Kind, row.Title, row.MetaJSON)
	}

	wantPNGRel := store.ProjectOverlayRel(p.ID, row.ID+".png")
	wantTIFRel := store.ProjectOverlayRel(p.ID, row.ID+".tif")
	if row.PNGRelPath != wantPNGRel || row.TIFRelPath != wantTIFRel {
		t.Fatalf("recorded paths %q / %q, want %q / %q",
			row.PNGRelPath, row.TIFRelPath, wantPNGRel, wantTIFRel)
	}

	overlaysDir := a.store.ProjectOverlaysDir(p.ID)
	pngAbs := a.store.AbsDataPath(row.PNGRelPath)
	tifAbs := a.store.AbsDataPath(row.TIFRelPath)
	if filepath.Dir(pngAbs) != overlaysDir || filepath.Dir(tifAbs) != overlaysDir {
		t.Fatalf("files written to %q / %q, outside the project folder %q",
			filepath.Dir(pngAbs), filepath.Dir(tifAbs), overlaysDir)
	}
	if got, err := os.ReadFile(pngAbs); err != nil {
		t.Fatalf("reading the saved png: %v", err)
	} else if !bytes.Equal(got, png) {
		t.Fatalf("the png on disk is %d bytes, want the %d that were sent", len(got), len(png))
	}
	if got, err := os.ReadFile(tifAbs); err != nil {
		t.Fatalf("reading the saved raster: %v", err)
	} else if !bytes.Equal(got, tif) {
		t.Fatalf("the raster on disk is %d bytes, want the %d that were sent", len(got), len(tif))
	}

	// What comes back is what goes on screen. The hydrated URI is re-encoded
	// from disk rather than echoed, so equality here is the whole write-read
	// path agreeing, not a field being copied through.
	if row.OverlayURI != dataURI("image/png", png) {
		t.Fatal("the returned overlay_uri is not the image that was saved")
	}
	if row.RasterTIF != tifAbs {
		t.Fatalf("returned raster path %q, want the absolute path %q", row.RasterTIF, tifAbs)
	}

	listed, err := a.ListProjectOverlays(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != row.ID || listed[0].OverlayURI != row.OverlayURI {
		t.Fatalf("the project lists %d overlays, want the one just saved", len(listed))
	}
	if n := len(overlayFileNames(t, a, p.ID)); n != 2 {
		t.Fatalf("%d files in the overlay folder, want the png and the raster", n)
	}
}

// A composition the binding cannot decode must leave nothing behind.
//
// The row is inserted after the files are written, so a write that fails
// half-way and still returns a row would list a composition whose image does
// not exist; a file written under a project id that was never ownership
// checked would put one user's bytes in another user's folder.
func TestProjectOverlaySaveRejectsUnusableInput(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Rejection project")
	good := dataURI("image/png", []byte("\x89PNG\r\n\x1a\npixels"))

	for _, c := range []struct {
		name string
		req  SaveProjectOverlayRequest
		want string
	}{
		{
			"no project id",
			SaveProjectOverlayRequest{ProjectID: "   ", OverlayURI: good},
			"project_id required",
		},
		{
			"no overlay",
			SaveProjectOverlayRequest{ProjectID: p.ID, OverlayURI: "   "},
			"overlay_uri required",
		},
		{
			// A data URI whose header was never terminated: there is no comma,
			// so there is no payload to decode.
			"data uri with no payload separator",
			SaveProjectOverlayRequest{ProjectID: p.ID, OverlayURI: "data:image/png;base64"},
			"save overlay png",
		},
		{
			"data uri with undecodable payload",
			SaveProjectOverlayRequest{ProjectID: p.ID, OverlayURI: "data:image/png;base64,%%not base64%%"},
			"save overlay png",
		},
		{
			"project that does not exist",
			SaveProjectOverlayRequest{ProjectID: "no-such-project", OverlayURI: good},
			"not found",
		},
		{
			// store.WriteDataURIFile reads any string without the "data:"
			// prefix as a path on disk, which raster_tif needs and this value
			// must not have: it comes from the WebView, and copying whatever
			// it names into the project folder makes an arbitrary local file
			// readable back as the overlay's image.
			"filesystem path instead of a data uri",
			SaveProjectOverlayRequest{ProjectID: p.ID, OverlayURI: "/etc/passwd"},
			"must be a data URI",
		},
		{
			"relative filesystem path instead of a data uri",
			SaveProjectOverlayRequest{ProjectID: p.ID, OverlayURI: "../../../etc/hosts"},
			"must be a data URI",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			row, err := a.SaveProjectOverlay(c.req)
			if err == nil {
				t.Fatalf("saved an overlay (%v) from input that cannot produce one", row)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Fatalf("error %q does not name the reason %q", err, c.want)
			}
		})
	}

	overlays, err := a.ListProjectOverlays(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(overlays) != 0 {
		t.Fatalf("%d overlay rows survive the rejected saves", len(overlays))
	}
	if names := overlayFileNames(t, a, p.ID); len(names) != 0 {
		t.Fatalf("rejected saves left files behind: %v", names)
	}
}

// An overlay is refused for a project the signed-in user does not own, and
// refused before anything reaches that project's folder.
//
// The ownership check runs ahead of the write for exactly this reason: the
// directory name is the id the caller supplied, so a check made after the
// write would still have deposited the bytes.
func TestProjectOverlaySaveRefusesAnotherUsersProject(t *testing.T) {
	a := newTestApp(t)
	owner := signIn(t, a, "owner@example.test")
	owned := mustCreateProject(t, a, "Owned by an account")
	if owned.UserID != owner.ID {
		t.Fatalf("project belongs to %q, want the signed-in user %q", owned.UserID, owner.ID)
	}
	mustSignOut(t, a)

	_, err := a.SaveProjectOverlay(SaveProjectOverlayRequest{
		ProjectID:  owned.ID,
		OverlayURI: dataURI("image/png", []byte("bytes from a different user")),
	})
	if err == nil {
		t.Fatal("the local user saved a composition into an account's project")
	}
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("error = %v, want not found", err)
	}
	if names := overlayFileNames(t, a, owned.ID); len(names) != 0 {
		t.Fatalf("the refused save still wrote %v into the other user's folder", names)
	}
}

// A composition larger than a screenshot is stored whole.
//
// Nothing on this path caps the payload, so the property worth pinning is that
// the bytes are neither truncated nor chunked on their way to disk: a
// composition that saves at 90 percent of its length reopens as a torn image
// with no error anywhere. If a cap is ever introduced it belongs at the top of
// the binding as a refusal, and this test should then assert the refusal.
func TestProjectOverlaySaveStoresALargeCompositionWhole(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Large composition")

	body := make([]byte, 2<<20)
	for i := range body {
		body[i] = byte(i % 251)
	}
	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		OverlayURI: dataURI("image/png", body),
	})

	onDisk, err := os.ReadFile(a.store.AbsDataPath(row.PNGRelPath))
	if err != nil {
		t.Fatal(err)
	}
	if len(onDisk) != len(body) {
		t.Fatalf("the png on disk is %d bytes, want %d", len(onDisk), len(body))
	}
	if !bytes.Equal(onDisk, body) {
		t.Fatal("the png on disk differs from the composition that was sent")
	}
	if row.OverlayURI != dataURI("image/png", body) {
		t.Fatal("the composition handed back to the interface is not the one that was saved")
	}
}

// A raster that cannot be decoded does not cost the caller the composition.
//
// The GeoTIFF is an export beside the image, not the thing on screen, so its
// failure clears the recorded path and the row is still written. The row must
// then record no raster at all: a path recorded for a file that was never
// written is an export button that fails when pressed.
func TestProjectOverlaySaveKeepsThePNGWhenTheRasterFails(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Raster fallback")

	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		OverlayURI: dataURI("image/png", []byte("\x89PNG\r\n\x1a\npixels")),
		RasterTIF:  "data:image/tiff;base64,%%not base64%%",
	})
	if row.TIFRelPath != "" || row.RasterTIF != "" {
		t.Fatalf("a raster path was recorded for a file that failed to write: %q / %q",
			row.TIFRelPath, row.RasterTIF)
	}
	if row.PNGRelPath == "" {
		t.Fatal("the composition itself was lost with the raster")
	}
	if names := overlayFileNames(t, a, p.ID); len(names) != 1 {
		t.Fatalf("overlay folder holds %v, want the png alone", names)
	}
}

// A row whose files are gone still lists.
//
// The hydration reads two files that a restore, a manual clean-up or a failed
// write can leave missing. Returning an error there would take the whole
// project list down over one absent image, so the row is returned with the
// fields it could not fill left empty and the interface decides what to draw.
func TestProjectOverlayListsRowsWhoseFilesAreMissing(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Missing files")

	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		OverlayURI: dataURI("image/png", []byte("\x89PNG\r\n\x1a\npixels")),
		RasterTIF:  dataURI("image/tiff", []byte("II*\x00raster")),
	})
	for _, rel := range []string{row.PNGRelPath, row.TIFRelPath} {
		if err := os.Remove(a.store.AbsDataPath(rel)); err != nil {
			t.Fatal(err)
		}
	}

	listed, err := a.ListProjectOverlays(p.ID)
	if err != nil {
		t.Fatalf("listing failed over a missing file: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("%d rows listed, want the one whose files were removed", len(listed))
	}
	got := listed[0]
	if got.ID != row.ID || got.PNGRelPath != row.PNGRelPath {
		t.Fatalf("the listed row is not the saved one: %+v", got)
	}
	if got.OverlayURI != "" || got.RasterTIF != "" {
		t.Fatalf("a preview was produced for files that do not exist: %q / %q",
			got.OverlayURI, got.RasterTIF)
	}
	if got.MetaJSON != "{}" {
		t.Fatalf("meta_json = %q; empty metadata must list as an empty object, since the interface parses it", got.MetaJSON)
	}
}

// Deleting one overlay takes its files and leaves every other overlay alone.
func TestProjectOverlayDeleteRemovesOnlyItsOwnFiles(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Two compositions")

	first := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		Title:      "First",
		OverlayURI: dataURI("image/png", []byte("first")),
		RasterTIF:  dataURI("image/tiff", []byte("first raster")),
	})
	second := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		Title:      "Second",
		OverlayURI: dataURI("image/png", []byte("second")),
	})

	if err := a.DeleteProjectOverlay(first.ID); err != nil {
		t.Fatal(err)
	}
	listed, err := a.ListProjectOverlays(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != second.ID {
		t.Fatalf("after deleting one of two overlays the project lists %d rows", len(listed))
	}
	for _, rel := range []string{first.PNGRelPath, first.TIFRelPath} {
		if _, err := os.Stat(a.store.AbsDataPath(rel)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s survives the delete of its row", rel)
		}
	}
	if _, err := os.Stat(a.store.AbsDataPath(second.PNGRelPath)); err != nil {
		t.Fatalf("the surviving overlay lost its file: %v", err)
	}
	if err := a.DeleteProjectOverlay(first.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleting an overlay twice returned %v, want not found", err)
	}
}

// An overlay belonging to another user is neither deleted nor reported as
// deleted.
func TestProjectOverlayDeleteRefusesAnotherUsersOverlay(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Local project")
	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		OverlayURI: dataURI("image/png", []byte("local pixels")),
	})

	signIn(t, a, "other@example.test")
	if err := a.DeleteProjectOverlay(row.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("error = %v, want not found", err)
	}
	if _, err := os.Stat(a.store.AbsDataPath(row.PNGRelPath)); err != nil {
		t.Fatalf("the other user's overlay file was removed: %v", err)
	}

	mustSignOut(t, a)
	listed, err := a.ListProjectOverlays(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("the owner now lists %d overlays, want the one that was refused deletion", len(listed))
	}
}

// Nobody is signed in most of the time. Every binding in this file resolves
// its user through the same fallback, so a wrong answer here silently moves
// every project and every run between owners.
func TestProjectEffectiveUserIDFallsBackToTheLocalUser(t *testing.T) {
	a := newTestApp(t)
	if got := a.effectiveUserID(); got != store.LocalUserID {
		t.Fatalf("logged out, effectiveUserID = %q, want the local user %q", got, store.LocalUserID)
	}
	// Answered without a store, because the first call happens before a store
	// is opened and must not depend on one.
	if got := (&App{}).effectiveUserID(); got != store.LocalUserID {
		t.Fatalf("with no store, effectiveUserID = %q, want %q", got, store.LocalUserID)
	}

	u := signIn(t, a, "signed-in@example.test")
	if got := a.effectiveUserID(); got != u.ID {
		t.Fatalf("signed in, effectiveUserID = %q, want %q", got, u.ID)
	}
	mustSignOut(t, a)
	if got := a.effectiveUserID(); got != store.LocalUserID {
		t.Fatalf("after signing out, effectiveUserID = %q, want %q", got, store.LocalUserID)
	}
}

// One user's projects are not reachable from another user's session, through
// any of the four bindings that take a project id from the interface.
//
// The id is opaque to the caller and every one of these bindings looks it up
// by id, so the user column is the only thing separating two accounts sharing
// one local database.
func TestProjectRowsAreScopedToTheirUser(t *testing.T) {
	a := newTestApp(t)
	guestProject := mustCreateProject(t, a, "Guest project")
	if guestProject.UserID != store.LocalUserID {
		t.Fatalf("a logged-out project belongs to %q, want the local user", guestProject.UserID)
	}

	u := signIn(t, a, "scoped@example.test")
	ownProject := mustCreateProject(t, a, "Account project")

	listed, err := a.ListProjects()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != ownProject.ID {
		t.Fatalf("the account lists %d projects, want its own alone", len(listed))
	}
	if _, err := a.GetProject(guestProject.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("GetProject on another user's project returned %v, want not found", err)
	}
	if _, err := a.UpdateProject(store.Project{ID: guestProject.ID, Name: "Renamed by the account"}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("UpdateProject on another user's project returned %v, want not found", err)
	}
	if err := a.DeleteProject(guestProject.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("DeleteProject on another user's project returned %v, want not found", err)
	}
	if _, err := a.SetProjectLastArea(guestProject.ID, "area"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("SetProjectLastArea on another user's project returned %v, want not found", err)
	}
	if _, err := a.UpdateProjectRunLabels(guestProject.ID, "Renamed"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("UpdateProjectRunLabels on another user's project returned %v, want not found", err)
	}
	if u.ID == store.LocalUserID {
		t.Fatal("the registered account was given the local user id, so none of the above tested scoping")
	}

	mustSignOut(t, a)
	back, err := a.ListProjects()
	if err != nil {
		t.Fatal(err)
	}
	if len(back) != 1 || back[0].ID != guestProject.ID {
		t.Fatalf("the local user lists %d projects, want the one it created", len(back))
	}
	if back[0].Name != "Guest project" {
		t.Fatalf("the local user's project is now named %q: the refused update was applied after all", back[0].Name)
	}
}

// Creation, update and deletion of a project, and what deletion takes with it.
func TestProjectCreateUpdateDelete(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.CreateProject("   ", "notes"); err == nil {
		t.Fatal("a project was created with no name, which nothing in the interface can label")
	}

	p := mustCreateProject(t, a, "  Field survey  ")
	if p.Name != "Field survey" {
		t.Fatalf("name = %q, want it trimmed", p.Name)
	}
	if p.ID == "" || p.CreatedAt == "" {
		t.Fatalf("project created without an id or a timestamp: %+v", p)
	}

	// The interface sends the whole row back on an edit, so the fields it does
	// not show must survive the round trip: created_at is the sort key of the
	// project list and is not among them.
	updated, err := a.UpdateProject(store.Project{ID: p.ID, Name: "Field survey 2", Notes: "second visit"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Field survey 2" || updated.Notes != "second visit" {
		t.Fatalf("update did not take: %+v", updated)
	}
	if updated.CreatedAt != p.CreatedAt {
		t.Fatalf("created_at changed from %q to %q on an edit", p.CreatedAt, updated.CreatedAt)
	}
	if updated.UserID != store.LocalUserID {
		t.Fatalf("the updated project belongs to %q", updated.UserID)
	}
	if got, err := a.GetProject(p.ID); err != nil || got.Name != "Field survey 2" {
		t.Fatalf("GetProject after update: %+v, %v", got, err)
	}

	if err := a.DeleteProject(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetProject(p.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("GetProject after delete returned %v, want not found", err)
	}
	if listed, err := a.ListProjects(); err != nil || len(listed) != 0 {
		t.Fatalf("after deleting the only project the list holds %d rows (%v)", len(listed), err)
	}
	// The folder goes too, or a deleted project keeps its compositions on disk
	// where nothing can reach or remove them.
	if _, err := os.Stat(a.store.ProjectsDir(p.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the project folder survives the delete: %v", err)
	}
}

// Deleting a project detaches its runs rather than deleting them.
//
/*
Deleting a project deletes what is inside it.

THIS TEST ASSERTED THE OPPOSITE AND WAS RIGHT TO, until ownership became a
chain. It said a run is the expensive artefact and the project a folder over it,
so deleting the folder should return the run to the unassigned list rather than
destroy it. That reasoning depended on there BEING an unassigned list: somewhere
a run could stand on its own.

A project now holds areas and an area holds runs, so there is nowhere to detach
to -- a run with no project is a run of no ground. The folder is not a label over
the work any more; it is what the work is inside.
*/
func TestProjectDeleteRemovesItsRunsAndOverlays(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Doomed project")
	runID := mustSaveRun(t, a, store.LocalUserID, "run-in-project")
	if err := a.SetRunProject(runID, p.ID); err != nil {
		t.Fatal(err)
	}
	row := mustSaveOverlay(t, a, SaveProjectOverlayRequest{
		ProjectID:  p.ID,
		OverlayURI: dataURI("image/png", []byte("composition to be deleted")),
	})
	pngAbs := a.store.AbsDataPath(row.PNGRelPath)

	if err := a.DeleteProject(p.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := a.store.GetRun(store.LocalUserID, runID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("the run outlived its project: %v", err)
	}
	// And it is not hiding in the unassigned list either, which is the state
	// this deletion used to produce and the hierarchy no longer has.
	unassigned, err := a.ListProjectRuns("", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(unassigned) != 0 {
		t.Fatalf("deleting the project left %d run(s) with no project", len(unassigned))
	}
	if _, err := os.Stat(pngAbs); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the composition file outlived its project: %v", err)
	}
}

// Assigning a run to a project and clearing it again.
//
// Empty means unassigned on both sides of this pair: the same empty string
// clears the assignment in SetRunProject and asks for the unassigned runs in
// ListProjectRuns. A run must appear in exactly one of the two lists.
func TestProjectRunAssignment(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Assignment project")
	runID := mustSaveRun(t, a, store.LocalUserID, "run-to-assign")

	if runs, err := a.ListProjectRuns("", 0); err != nil || len(runs) != 1 || runs[0].ID != runID {
		t.Fatalf("a fresh run is not listed as unassigned: %d rows, %v", len(runs), err)
	}

	if err := a.SetRunProject(runID, p.ID); err != nil {
		t.Fatal(err)
	}
	inProject, err := a.ListProjectRuns(p.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(inProject) != 1 || inProject[0].ID != runID || inProject[0].ProjectID != p.ID {
		t.Fatalf("the assigned run is not listed under its project: %d rows", len(inProject))
	}
	if runs, err := a.ListProjectRuns("", 0); err != nil || len(runs) != 0 {
		t.Fatalf("the assigned run is still listed as unassigned: %d rows, %v", len(runs), err)
	}
	// The count on the project card comes from the same assignment.
	listed, err := a.ListProjects()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].RunCount != 1 {
		t.Fatalf("project run_count = %d, want 1", listed[0].RunCount)
	}

	if err := a.SetRunProject(runID, ""); err != nil {
		t.Fatal(err)
	}
	if runs, err := a.ListProjectRuns(p.ID, 0); err != nil || len(runs) != 0 {
		t.Fatalf("the cleared run is still listed under the project: %d rows, %v", len(runs), err)
	}
	if runs, err := a.ListProjectRuns("", 0); err != nil || len(runs) != 1 {
		t.Fatalf("the cleared run did not return to the unassigned list: %d rows, %v", len(runs), err)
	}

	if err := a.SetRunProject("no-such-run", p.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("assigning a run that does not exist returned %v, want not found", err)
	}
}

// A run cannot be filed into another user's project.
func TestProjectRunAssignmentRefusesAnotherUsersProject(t *testing.T) {
	a := newTestApp(t)
	runID := mustSaveRun(t, a, store.LocalUserID, "local-run")

	signIn(t, a, "filer@example.test")
	theirs := mustCreateProject(t, a, "Account project")
	mustSignOut(t, a)

	if err := a.SetRunProject(runID, theirs.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("error = %v, want not found", err)
	}
	run, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.ProjectID != "" {
		t.Fatalf("the run was filed into %q, a project of another user", run.ProjectID)
	}
}

/*
The cursor a project keeps: which ground the reader was last on.

It was TestProjectAOIUpdate, over UpdateProjectAOI, which wrote the map's
current shape and label onto the project row and refused a polygon that was not
JSON. There is no polygon on a project any more -- the shapes live in `areas`,
one row each -- so what is left to test is that the cursor is stored trimmed,
that setting it does not disturb the project's own fields, and that it can be
cleared.

Clearing matters on its own: leaving a project with nothing selected has to be
expressible, and an empty string is how it is said.
*/
func TestProjectLastAreaCursor(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Cursor project")

	got, err := a.SetProjectLastArea(p.ID, "  area-7  ")
	if err != nil {
		t.Fatal(err)
	}
	if got.LastAreaID != "area-7" {
		t.Fatalf("cursor stored as %q, want trimmed", got.LastAreaID)
	}
	if got.Name != p.Name {
		t.Fatalf("setting the cursor renamed the project to %q", got.Name)
	}

	after, err := a.GetProject(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.LastAreaID != "area-7" {
		t.Fatalf("the cursor did not survive a read back: %+v", after)
	}

	cleared, err := a.SetProjectLastArea(p.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if cleared.LastAreaID != "" {
		t.Fatalf("the cursor was not cleared: %+v", cleared)
	}
}

// Renaming a project's runs touches that project's runs and no others.
func TestProjectRunLabelsRenameOnlyTheProjectsRuns(t *testing.T) {
	a := newTestApp(t)
	p := mustCreateProject(t, a, "Labelled project")
	other := mustCreateProject(t, a, "Other project")

	first := mustSaveRun(t, a, store.LocalUserID, "run-one")
	second := mustSaveRun(t, a, store.LocalUserID, "run-two")
	elsewhere := mustSaveRun(t, a, store.LocalUserID, "run-elsewhere")
	loose := mustSaveRun(t, a, store.LocalUserID, "run-loose")
	for id, project := range map[string]string{first: p.ID, second: p.ID, elsewhere: other.ID} {
		if err := a.SetRunProject(id, project); err != nil {
			t.Fatal(err)
		}
	}

	n, err := a.UpdateProjectRunLabels(p.ID, "  Harvest survey  ")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("renamed %d runs, want the 2 in the project", n)
	}
	runs, err := a.ListProjectRuns(p.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("the project holds %d runs, want 2", len(runs))
	}
	for _, r := range runs {
		if r.Label != "Harvest survey" {
			t.Fatalf("run %s is labelled %q, want the trimmed label", r.ID, r.Label)
		}
	}
	for _, id := range []string{elsewhere, loose} {
		r, err := a.store.GetRun(store.LocalUserID, id)
		if err != nil {
			t.Fatal(err)
		}
		if r.Label == "Harvest survey" {
			t.Fatalf("run %s outside the project was renamed as well", id)
		}
	}

	// A blank label would erase every run name in the project, so it is
	// refused rather than applied.
	if _, err := a.UpdateProjectRunLabels(p.ID, "   "); err == nil {
		t.Fatal("a blank label was accepted")
	}
	if _, err := a.UpdateProjectRunLabels("   ", "Harvest survey"); err == nil {
		t.Fatal("a blank project id was accepted")
	}
	if runs, _ := a.ListProjectRuns(p.ID, 0); len(runs) != 2 || runs[0].Label != "Harvest survey" {
		t.Fatal("a refused rename changed the runs anyway")
	}
}

// Deleting a saved analysis, and not deleting somebody else's.
func TestProjectDeleteAnalysis(t *testing.T) {
	a := newTestApp(t)
	runID := mustSaveRun(t, a, store.LocalUserID, "run-to-delete")

	if err := a.DeleteAnalysis(runID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.GetRun(store.LocalUserID, runID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("the run survives its delete: %v", err)
	}
	if err := a.DeleteAnalysis(runID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleting the same run twice returned %v, want not found", err)
	}

	survivor := mustSaveRun(t, a, store.LocalUserID, "run-of-the-local-user")
	signIn(t, a, "deleter@example.test")
	if err := a.DeleteAnalysis(survivor); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleting another user's run returned %v, want not found", err)
	}
	mustSignOut(t, a)
	if _, err := a.store.GetRun(store.LocalUserID, survivor); err != nil {
		t.Fatalf("the local user's run was deleted by another account: %v", err)
	}
}

// Every binding in this file answers with an error when there is no store.
//
// The window is up before the store is opened, and it stays up if opening
// fails: the interface can call any of these at any point in that window. A
// nil dereference there takes the whole application down with a panic the user
// cannot read, so the property asserted is that each one returns instead.
func TestProjectBindingsWithoutAStoreReturnAnError(t *testing.T) {
	a := &App{}
	for _, c := range []struct {
		name string
		call func() error
	}{
		{"CreateProject", func() error { _, err := a.CreateProject("P", ""); return err }},
		{"UpdateProject", func() error { _, err := a.UpdateProject(store.Project{ID: "p", Name: "P"}); return err }},
		{"DeleteProject", func() error { return a.DeleteProject("p") }},
		{"ListProjects", func() error { _, err := a.ListProjects(); return err }},
		{"GetProject", func() error { _, err := a.GetProject("p"); return err }},
		{"ListProjectRuns", func() error { _, err := a.ListProjectRuns("p", 0); return err }},
		{"SetRunProject", func() error { return a.SetRunProject("r", "p") }},
		{"SaveProjectOverlay", func() error {
			_, err := a.SaveProjectOverlay(SaveProjectOverlayRequest{ProjectID: "p", OverlayURI: "data:image/png;base64,AAAA"})
			return err
		}},
		{"ListProjectOverlays", func() error { _, err := a.ListProjectOverlays("p"); return err }},
		{"DeleteProjectOverlay", func() error { return a.DeleteProjectOverlay("o") }},
		{"DeleteAnalysis", func() error { return a.DeleteAnalysis("r") }},
		{"SetProjectLastArea", func() error { _, err := a.SetProjectLastArea("p", "a"); return err }},
		{"UpdateProjectRunLabels", func() error { _, err := a.UpdateProjectRunLabels("p", "L"); return err }},
	} {
		err := c.call()
		if err == nil {
			t.Errorf("%s reported success with no store behind it", c.name)
			continue
		}
		if !strings.Contains(err.Error(), "store") {
			t.Errorf("%s returned %q, which does not tell the interface the store is missing", c.name, err)
		}
	}
}
