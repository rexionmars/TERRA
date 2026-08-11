package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"geosense-infer/backend/store"

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
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.CreateProject(store.Project{
		UserID: a.effectiveUserID(),
		Name:   name,
		Notes:  notes,
	})
}

// UpdateProject updates project metadata and/or AOI.
func (a *App) UpdateProject(p store.Project) (*store.Project, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.UpdateProject(a.effectiveUserID(), p)
}

// DeleteProject deletes a project, detaches runs, and removes overlay files.
func (a *App) DeleteProject(projectID string) error {
	if err := a.requireStore(); err != nil {
		return err
	}
	return a.store.DeleteProject(a.effectiveUserID(), projectID)
}

// ListProjects returns projects for the current user.
func (a *App) ListProjects() ([]store.Project, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.ListProjects(a.effectiveUserID())
}

// GetProject returns one project.
func (a *App) GetProject(projectID string) (*store.Project, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.GetProject(a.effectiveUserID(), projectID)
}

// ListProjectRuns lists runs in a project; empty projectID lists unassigned runs.
func (a *App) ListProjectRuns(projectID string, limit int) ([]store.InferenceRun, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.ListRunsByProject(a.effectiveUserID(), projectID, limit)
}

// SetRunProject assigns a run to a project (empty projectID clears).
func (a *App) SetRunProject(runID, projectID string) error {
	if err := a.requireStore(); err != nil {
		return err
	}
	return a.store.SetRunProject(a.effectiveUserID(), runID, projectID)
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
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	projectID := strings.TrimSpace(req.ProjectID)
	if projectID == "" {
		return nil, errors.New("project_id required")
	}
	if err := a.store.EnsureProjectOwned(userID, projectID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.OverlayURI) == "" {
		return nil, errors.New("overlay_uri required")
	}

	overlayID := uuid.NewString()
	dir := a.store.ProjectOverlaysDir(projectID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	pngName := overlayID + ".png"
	pngRel := store.ProjectOverlayRel(projectID, pngName)
	if err := store.WriteDataURIFile(req.OverlayURI, filepath.Join(a.store.DataDir(), pngRel)); err != nil {
		return nil, fmt.Errorf("save overlay png: %w", err)
	}
	tifRel := ""
	if strings.TrimSpace(req.RasterTIF) != "" {
		tifName := overlayID + ".tif"
		tifRel = store.ProjectOverlayRel(projectID, tifName)
		if err := store.WriteDataURIFile(req.RasterTIF, filepath.Join(a.store.DataDir(), tifRel)); err != nil {
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
	row, err := a.store.AddProjectOverlay(userID, store.ProjectOverlay{
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
	return a.hydrateProjectOverlay(row), nil
}

// ListProjectOverlays returns overlays with hydrated preview URIs.
func (a *App) ListProjectOverlays(projectID string) ([]store.ProjectOverlay, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	rows, err := a.store.ListProjectOverlays(a.effectiveUserID(), projectID)
	if err != nil {
		return nil, err
	}
	out := make([]store.ProjectOverlay, 0, len(rows))
	for i := range rows {
		out = append(out, *a.hydrateProjectOverlay(&rows[i]))
	}
	return out, nil
}

// DeleteProjectOverlay removes one overlay from a project.
func (a *App) DeleteProjectOverlay(overlayID string) error {
	if err := a.requireStore(); err != nil {
		return err
	}
	return a.store.DeleteProjectOverlay(a.effectiveUserID(), overlayID)
}

// DeleteAnalysis deletes a saved inference run and its files.
func (a *App) DeleteAnalysis(runID string) error {
	if err := a.requireStore(); err != nil {
		return err
	}
	return a.store.DeleteRun(a.effectiveUserID(), runID)
}

func (a *App) hydrateProjectOverlay(o *store.ProjectOverlay) *store.ProjectOverlay {
	if o == nil {
		return nil
	}
	out := *o
	if o.PNGRelPath != "" {
		if uri, err := store.ReadFileDataURI(a.store.AbsDataPath(o.PNGRelPath), "image/png"); err == nil {
			out.OverlayURI = uri
		}
	}
	if o.TIFRelPath != "" {
		abs := a.store.AbsDataPath(o.TIFRelPath)
		if _, err := os.Stat(abs); err == nil {
			out.RasterTIF = abs
		}
	}
	if out.MetaJSON == "" {
		out.MetaJSON = "{}"
	}
	return &out
}

// UpdateProjectAOI is a convenience wrapper for binding the current map AOI.
func (a *App) UpdateProjectAOI(projectID, areaID, polygonGeoJSON, label string) (*store.Project, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	p, err := a.store.GetProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	p.AreaID = strings.TrimSpace(areaID)
	p.PolygonGeoJSON = strings.TrimSpace(polygonGeoJSON)
	p.Label = strings.TrimSpace(label)
	// Keep name; ensure polygon JSON is valid-ish when provided.
	if p.PolygonGeoJSON != "" && !json.Valid([]byte(p.PolygonGeoJSON)) {
		return nil, errors.New("invalid polygon_geojson")
	}
	return a.store.UpdateProject(userID, *p)
}

// UpdateProjectRunLabels renames all inference runs attached to a project.
func (a *App) UpdateProjectRunLabels(projectID, label string) (int64, error) {
	if err := a.requireStore(); err != nil {
		return 0, err
	}
	projectID = strings.TrimSpace(projectID)
	label = strings.TrimSpace(label)
	if projectID == "" || label == "" {
		return 0, errors.New("project id and label are required")
	}
	userID := a.effectiveUserID()
	// Ensure the project belongs to this user.
	if _, err := a.store.GetProject(userID, projectID); err != nil {
		return 0, err
	}
	return a.store.UpdateProjectRunLabels(userID, projectID, label)
}
