package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

func (s *Store) ProjectsDir(projectID string) string {
	return filepath.Join(s.dataDir, "projects", projectID)
}

func (s *Store) ProjectOverlaysDir(projectID string) string {
	return filepath.Join(s.ProjectsDir(projectID), "overlays")
}

// CreateProject inserts a new project for the user.
func (s *Store) CreateProject(p Project) (*Project, error) {
	if p.UserID == "" {
		return nil, ErrInvalidInput
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return nil, ErrInvalidInput
	}
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	ts := nowISO()
	if p.CreatedAt == "" {
		p.CreatedAt = ts
	}
	p.UpdatedAt = ts
	_, err := s.db.Exec(
		`INSERT INTO projects
		 (id, user_id, name, notes, created_at, updated_at, polygon_geojson, area_id, label)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.UserID, p.Name, p.Notes, p.CreatedAt, p.UpdatedAt,
		p.PolygonGeoJSON, p.AreaID, p.Label,
	)
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(s.ProjectOverlaysDir(p.ID), 0o700)
	return &p, nil
}

// UpdateProject updates mutable project fields (must belong to userID).
func (s *Store) UpdateProject(userID string, p Project) (*Project, error) {
	if userID == "" || p.ID == "" {
		return nil, ErrInvalidInput
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return nil, ErrInvalidInput
	}
	p.UpdatedAt = nowISO()
	res, err := s.db.Exec(
		`UPDATE projects SET name = ?, notes = ?, updated_at = ?,
		 polygon_geojson = ?, area_id = ?, label = ?
		 WHERE id = ? AND user_id = ?`,
		p.Name, p.Notes, p.UpdatedAt, p.PolygonGeoJSON, p.AreaID, p.Label, p.ID, userID,
	)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	out, err := s.GetProject(userID, p.ID)
	if err != nil {
		return nil, err
	}
	return out, nil
}

/*
DeleteProject removes the project and everything inside it.

IT USED TO DETACH THE RUNS -- `project_id = NULL` -- and that was right while a
run could stand on its own. Under the chain a project holds areas and an area
holds runs, so there is nowhere to detach TO: a run with no project is a run of
no ground, which is the shape this change exists to remove. The runs go with the
areas, and their rasters with them.

A destructive change to a control that already read as destructive, and the one
worth stating out loud: deleting a project now deletes the analyses in it.
*/
func (s *Store) DeleteProject(userID, projectID string) error {
	if userID == "" || projectID == "" {
		return ErrInvalidInput
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var owner string
	err = tx.QueryRow(`SELECT user_id FROM projects WHERE id = ?`, projectID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrNotFound
	}

	// Gathered before the rows go: afterwards nothing can say which run
	// directories were this project's.
	runDirs, err := runIDsOfProject(tx, projectID)
	if err != nil {
		return err
	}

	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`DELETE FROM whiteboard_members WHERE whiteboard_id IN
		   (SELECT id FROM whiteboards WHERE project_id = ?)`, []any{projectID}},
		{`DELETE FROM whiteboards WHERE project_id = ?`, []any{projectID}},
		{`DELETE FROM whiteboard_members WHERE run_id IN
		   (SELECT id FROM inference_runs WHERE project_id = ?)`, []any{projectID}},
		{`DELETE FROM project_overlays WHERE project_id = ?`, []any{projectID}},
		{`DELETE FROM inference_runs WHERE project_id = ? AND user_id = ?`,
			[]any{projectID, userID}},
		{`DELETE FROM areas WHERE project_id = ?`, []any{projectID}},
		{`DELETE FROM projects WHERE id = ? AND user_id = ?`, []any{projectID, userID}},
	} {
		if _, err := tx.Exec(stmt.sql, stmt.args...); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = os.RemoveAll(s.ProjectsDir(projectID))
	for _, id := range runDirs {
		_ = os.RemoveAll(s.RunsDir(id))
	}
	return nil
}

func runIDsOfProject(tx *sql.Tx, projectID string) ([]string, error) {
	rows, err := tx.Query(`SELECT id FROM inference_runs WHERE project_id = ?`, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListProjects returns projects for the user (newest updated first) with counts.
func (s *Store) ListProjects(userID string) ([]Project, error) {
	if userID == "" {
		userID = LocalUserID
	}
	rows, err := s.db.Query(
		`SELECT p.id, p.user_id, p.name, p.notes, p.created_at, p.updated_at,
		        p.polygon_geojson, p.area_id, p.label,
		        (SELECT COUNT(1) FROM inference_runs r WHERE r.project_id = p.id) AS run_count,
		        (SELECT COUNT(1) FROM project_overlays o WHERE o.project_id = p.id) AS overlay_count
		 FROM projects p
		 WHERE p.user_id = ?
		 ORDER BY p.updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Notes, &p.CreatedAt, &p.UpdatedAt,
			&p.PolygonGeoJSON, &p.AreaID, &p.Label, &p.RunCount, &p.OverlayCount,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetProject returns one project owned by userID.
func (s *Store) GetProject(userID, projectID string) (*Project, error) {
	if userID == "" {
		userID = LocalUserID
	}
	var p Project
	err := s.db.QueryRow(
		`SELECT p.id, p.user_id, p.name, p.notes, p.created_at, p.updated_at,
		        p.polygon_geojson, p.area_id, p.label,
		        (SELECT COUNT(1) FROM inference_runs r WHERE r.project_id = p.id) AS run_count,
		        (SELECT COUNT(1) FROM project_overlays o WHERE o.project_id = p.id) AS overlay_count
		 FROM projects p
		 WHERE p.id = ? AND p.user_id = ?`,
		projectID, userID,
	).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Notes, &p.CreatedAt, &p.UpdatedAt,
		&p.PolygonGeoJSON, &p.AreaID, &p.Label, &p.RunCount, &p.OverlayCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdateProjectRunLabels sets label on every run linked to the project.
func (s *Store) UpdateProjectRunLabels(userID, projectID, label string) (int64, error) {
	if userID == "" {
		userID = LocalUserID
	}
	projectID = strings.TrimSpace(projectID)
	label = strings.TrimSpace(label)
	if projectID == "" || label == "" {
		return 0, ErrInvalidInput
	}
	res, err := s.db.Exec(
		`UPDATE inference_runs SET label = ? WHERE user_id = ? AND project_id = ?`,
		label, userID, projectID,
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

/*
ListRunsByProject lists runs for a project. Empty projectID lists unassigned runs.

IT USED TO OMIT THE AREA. This query selected sixteen columns where ListRuns and
GetRun select the run's whole row, and the one it left out was the link back to
the ground -- so a run read through the project list came back claiming to be of
no area at all, while the same run read any other way named one. The hub reads
runs through here, which is why grouping them by ground was impossible from the
screen where it matters most.
*/
func (s *Store) ListRunsByProject(userID, projectID string, limit int) ([]InferenceRun, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var (
		rows *sql.Rows
		err  error
	)
	if strings.TrimSpace(projectID) == "" {
		rows, err = s.db.Query(
			`SELECT id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
			        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
			        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
			        COALESCE(project_id,''), COALESCE(kind,'classification'),
			        COALESCE(aoi_id,''), COALESCE(area_id,'')
			 FROM inference_runs
			 WHERE user_id = ? AND (project_id IS NULL OR project_id = '')
			 ORDER BY created_at DESC LIMIT ?`,
			userID, limit,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
			        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
			        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
			        COALESCE(project_id,''), COALESCE(kind,'classification'),
			        COALESCE(aoi_id,''), COALESCE(area_id,'')
			 FROM inference_runs
			 WHERE user_id = ? AND project_id = ?
			 ORDER BY created_at DESC LIMIT ?`,
			userID, projectID, limit,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InferenceRun{}
	for rows.Next() {
		var r InferenceRun
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.CreatedAt, &r.ModelKind, &r.PeriodStart, &r.PeriodEnd,
			&r.PolygonGeoJSON, &r.Status, &r.SummaryJSON, &r.OverlayRelPath, &r.NDates,
			&r.ResultJSON, &r.AssetsRelPath, &r.Label, &r.ProjectID, &r.Kind,
			&r.AoiID, &r.AreaID,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetRunProject assigns or clears a run's project (empty projectID clears).
func (s *Store) SetRunProject(userID, runID, projectID string) error {
	if userID == "" || runID == "" {
		return ErrInvalidInput
	}
	if projectID != "" {
		if _, err := s.GetProject(userID, projectID); err != nil {
			return err
		}
	}
	res, err := s.db.Exec(
		`UPDATE inference_runs SET project_id = ? WHERE id = ? AND user_id = ?`,
		nullIfEmpty(projectID), runID, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	if projectID != "" {
		_, _ = s.db.Exec(`UPDATE projects SET updated_at = ? WHERE id = ?`, nowISO(), projectID)
	}
	return nil
}

// AddProjectOverlay inserts an overlay row (paths already written by caller).
func (s *Store) AddProjectOverlay(userID string, o ProjectOverlay) (*ProjectOverlay, error) {
	if userID == "" || o.ProjectID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.GetProject(userID, o.ProjectID); err != nil {
		return nil, err
	}
	if o.ID == "" {
		o.ID = uuid.NewString()
	}
	if o.CreatedAt == "" {
		o.CreatedAt = nowISO()
	}
	if o.Kind == "" {
		o.Kind = "composition"
	}
	if o.MetaJSON == "" || !json.Valid([]byte(o.MetaJSON)) {
		o.MetaJSON = "{}"
	}
	_, err := s.db.Exec(
		`INSERT INTO project_overlays
		 (id, project_id, run_id, kind, title, meta_json, png_relpath, tif_relpath, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		o.ID, o.ProjectID, nullIfEmpty(o.RunID), o.Kind, o.Title, o.MetaJSON,
		nullIfEmpty(o.PNGRelPath), nullIfEmpty(o.TIFRelPath), o.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(`UPDATE projects SET updated_at = ? WHERE id = ?`, nowISO(), o.ProjectID)
	return &o, nil
}

// ListProjectOverlays returns overlays newest-first (without hydrating URIs).
func (s *Store) ListProjectOverlays(userID, projectID string) ([]ProjectOverlay, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if _, err := s.GetProject(userID, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(
		`SELECT id, project_id, COALESCE(run_id,''), kind, title, meta_json,
		        COALESCE(png_relpath,''), COALESCE(tif_relpath,''), created_at
		 FROM project_overlays WHERE project_id = ?
		 ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectOverlay{}
	for rows.Next() {
		var o ProjectOverlay
		if err := rows.Scan(
			&o.ID, &o.ProjectID, &o.RunID, &o.Kind, &o.Title, &o.MetaJSON,
			&o.PNGRelPath, &o.TIFRelPath, &o.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// DeleteProjectOverlay removes one overlay row and its files.
func (s *Store) DeleteProjectOverlay(userID, overlayID string) error {
	if userID == "" || overlayID == "" {
		return ErrInvalidInput
	}
	var (
		projectID string
		pngRel    string
		tifRel    string
		owner     string
	)
	err := s.db.QueryRow(
		`SELECT o.project_id, COALESCE(o.png_relpath,''), COALESCE(o.tif_relpath,''), p.user_id
		 FROM project_overlays o
		 JOIN projects p ON p.id = o.project_id
		 WHERE o.id = ?`,
		overlayID,
	).Scan(&projectID, &pngRel, &tifRel, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrNotFound
	}
	if _, err := s.db.Exec(`DELETE FROM project_overlays WHERE id = ?`, overlayID); err != nil {
		return err
	}
	_, _ = s.db.Exec(`UPDATE projects SET updated_at = ? WHERE id = ?`, nowISO(), projectID)
	if pngRel != "" {
		_ = os.Remove(filepath.Join(s.dataDir, pngRel))
	}
	if tifRel != "" {
		_ = os.Remove(filepath.Join(s.dataDir, tifRel))
	}
	return nil
}

// AbsDataPath joins a relative path under the store data dir.
func (s *Store) AbsDataPath(rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return ""
	}
	return filepath.Join(s.dataDir, rel)
}

// TouchProject bumps updated_at.
func (s *Store) TouchProject(projectID string) {
	if projectID == "" {
		return
	}
	_, _ = s.db.Exec(`UPDATE projects SET updated_at = ? WHERE id = ?`, nowISO(), projectID)
}

// EnsureProjectOwned returns ErrNotFound if the project is missing or not owned.
func (s *Store) EnsureProjectOwned(userID, projectID string) error {
	_, err := s.GetProject(userID, projectID)
	return err
}

// ProjectOverlayRel builds the overlay path a row stores: relative to the data
// directory, so a restored or moved data directory keeps every row valid.
func ProjectOverlayRel(projectID, filename string) string {
	return filepath.Join("projects", projectID, "overlays", filename)
}
