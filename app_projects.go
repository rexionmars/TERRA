package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"geosense-infer/internal/store"

	"github.com/google/uuid"
)

func (a *App) effectiveUserID() string {
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	if u != nil {
		return u.ID
	}
	return store.LocalUserID
}

// CreateProject creates a named project for the current user (or local guest).
func (a *App) CreateProject(name, notes string) (*store.Project, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.CreateProject(store.Project{
		UserID: a.effectiveUserID(),
		Name:   name,
		Notes:  notes,
	})
}

// UpdateProject updates project metadata and/or AOI.
func (a *App) UpdateProject(p store.Project) (*store.Project, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.UpdateProject(a.effectiveUserID(), p)
}

// DeleteProject deletes a project, detaches runs, and removes overlay files.
func (a *App) DeleteProject(projectID string) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	return st.DeleteProject(a.effectiveUserID(), projectID)
}

// ListProjects returns projects for the current user.
func (a *App) ListProjects() ([]store.Project, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.ListProjects(a.effectiveUserID())
}

// GetProject returns one project.
func (a *App) GetProject(projectID string) (*store.Project, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.GetProject(a.effectiveUserID(), projectID)
}

// ListProjectRuns lists runs in a project; empty projectID lists unassigned runs.
func (a *App) ListProjectRuns(projectID string, limit int) ([]store.InferenceRun, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.ListRunsByProject(a.effectiveUserID(), projectID, limit)
}

// SetRunProject assigns a run to a project (empty projectID clears).
func (a *App) SetRunProject(runID, projectID string) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	return st.SetRunProject(a.effectiveUserID(), runID, projectID)
}

// SaveProjectOverlayRequest persists a composition (or similar) into a project.
type SaveProjectOverlayRequest struct {
	ProjectID string `json:"project_id"`
	/*
		The run on screen when this composition was made, when there was one.

		Optional by design: a composition needs no classification -- browsing
		scenes on the map produces one -- and those belong to the project
		rather than to a run.
	*/
	RunID      string `json:"run_id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	MetaJSON   string `json:"meta_json"`
	OverlayURI string `json:"overlay_uri"`
	RasterTIF  string `json:"raster_tif"`
}

// SaveProjectOverlay copies overlay assets into the project folder and inserts a row.
func (a *App) SaveProjectOverlay(req SaveProjectOverlayRequest) (*store.ProjectOverlay, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	projectID := strings.TrimSpace(req.ProjectID)
	if projectID == "" {
		return nil, errors.New("project_id required")
	}
	if err := st.EnsureProjectOwned(userID, projectID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.OverlayURI) == "" {
		return nil, errors.New("overlay_uri required")
	}
	// A canvas export, so it is a data URI and nothing else.
	//
	// store.WriteDataURIFile treats any string without the prefix as a
	// filesystem path and reads it, which raster_tif needs -- that one is a
	// GeoTIFF the sidecar wrote and named. This value is not: it arrives from
	// the WebView, so without this line "/etc/passwd" is copied into the
	// project's overlay folder and handed straight back by
	// hydrateProjectOverlay, base64-encoded, as the overlay's own image.
	if !strings.HasPrefix(req.OverlayURI, "data:") {
		return nil, errors.New("overlay_uri must be a data URI")
	}

	overlayID := uuid.NewString()
	dir := st.ProjectOverlaysDir(projectID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	pngName := overlayID + ".png"
	pngRel := store.ProjectOverlayRel(projectID, pngName)
	if err := store.WriteDataURIFile(req.OverlayURI, filepath.Join(st.DataDir(), pngRel)); err != nil {
		return nil, fmt.Errorf("save overlay png: %w", err)
	}
	tifRel := ""
	if strings.TrimSpace(req.RasterTIF) != "" {
		tifName := overlayID + ".tif"
		tifRel = store.ProjectOverlayRel(projectID, tifName)
		if err := store.WriteDataURIFile(req.RasterTIF, filepath.Join(st.DataDir(), tifRel)); err != nil {
			tifRel = ""
		}
	}
	meta := strings.TrimSpace(req.MetaJSON)
	if meta == "" {
		meta = "{}"
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "composition"
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Composition"
	}
	row, err := st.AddProjectOverlay(userID, store.ProjectOverlay{
		ID:         overlayID,
		ProjectID:  projectID,
		RunID:      strings.TrimSpace(req.RunID),
		Kind:       kind,
		Title:      title,
		MetaJSON:   meta,
		PNGRelPath: pngRel,
		TIFRelPath: tifRel,
	})
	if err != nil {
		return nil, err
	}
	return hydrateProjectOverlay(st, row), nil
}

// ListProjectOverlays returns overlays with hydrated preview URIs.
func (a *App) ListProjectOverlays(projectID string) ([]store.ProjectOverlay, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	rows, err := st.ListProjectOverlays(a.effectiveUserID(), projectID)
	if err != nil {
		return nil, err
	}
	out := make([]store.ProjectOverlay, 0, len(rows))
	for i := range rows {
		out = append(out, *hydrateProjectOverlay(st, &rows[i]))
	}
	return out, nil
}

// DeleteProjectOverlay removes one overlay from a project.
func (a *App) DeleteProjectOverlay(overlayID string) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	return st.DeleteProjectOverlay(a.effectiveUserID(), overlayID)
}

// DeleteAnalysis deletes a saved inference run and its files.
func (a *App) DeleteAnalysis(runID string) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	return st.DeleteRun(a.effectiveUserID(), runID)
}

// hydrateProjectOverlay fills in the preview URI and raster path a row only
// records the location of.
//
// The store is a parameter rather than read off the App: the caller already
// holds the one it checked, and reading the field again here would be a second
// read that a restore can turn into nil between the two.
func hydrateProjectOverlay(st *store.Store, o *store.ProjectOverlay) *store.ProjectOverlay {
	if o == nil {
		return nil
	}
	out := *o
	if o.PNGRelPath != "" {
		if uri, err := store.ReadFileDataURI(st.AbsDataPath(o.PNGRelPath), "image/png"); err == nil {
			out.OverlayURI = uri
		}
	}
	if o.TIFRelPath != "" {
		abs := st.AbsDataPath(o.TIFRelPath)
		if _, err := os.Stat(abs); err == nil {
			out.RasterTIF = abs
		}
	}
	if out.MetaJSON == "" {
		out.MetaJSON = "{}"
	}
	return &out
}

/*
SetProjectLastArea records which ground the reader is on, so opening the project
again resumes there.

IT WAS UpdateProjectAOI, and it wrote the map's current shape, its area id and
its label onto the project row -- one geometry per project, taken from whatever
was on screen. That is the model areas replaced: a project working a dozen
fields still showed a single line naming one of them, and a run made in it
inherited that line rather than the ground it was actually over.

An empty areaID clears the cursor, which is what leaving a project with nothing
selected means. The area is not checked here: DeleteArea clears this column for
every project pointing at it, so the only way to store a dangling id is to pass
one that never existed, and the reader treats an id it cannot resolve as no
cursor at all.
*/
func (a *App) SetProjectLastArea(projectID, areaID string) (*store.Project, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	p, err := st.GetProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	p.LastAreaID = strings.TrimSpace(areaID)
	return st.UpdateProject(userID, *p)
}

// UpdateProjectRunLabels renames all inference runs attached to a project.
func (a *App) UpdateProjectRunLabels(projectID, label string) (int64, error) {
	st, err := a.requireStore()
	if err != nil {
		return 0, err
	}
	projectID = strings.TrimSpace(projectID)
	label = strings.TrimSpace(label)
	if projectID == "" || label == "" {
		return 0, errors.New("project id and label are required")
	}
	userID := a.effectiveUserID()
	// Ensure the project belongs to this user.
	if _, err := st.GetProject(userID, projectID); err != nil {
		return 0, err
	}
	return st.UpdateProjectRunLabels(userID, projectID, label)
}
