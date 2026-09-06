package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
)

/*
An area: one piece of ground inside a project, and what runs are of.

WHY THIS IS A TABLE AND NOT A PREFERENCE. It was a JSON array inside
preferences.extras_json.saved_aois -- a list belonging to a user, referenced by
inference_runs.aoi_id and projects.area_id, and validated by nothing. Nothing
could query it: there is not one WHERE aoi_id = ? in this package, because there
was no column to put on the left of it. A run therefore pointed at something
that might not exist, the project it landed in was whichever one happened to be
active, and every reader that needed to get from a run back to its ground did it
by comparing polygon rings.

The schema lives here rather than in store.go for the reason studioSchema
does: the statements that make a subject belong with the subject, and migrate()
reads as the order they are applied in rather than as their content.
*/

// areaSchema is applied unconditionally, like every other CREATE TABLE IF NOT
// EXISTS in migrate: the version records how far the gated steps have run, and
// says nothing about which tables exist. See addColumns for why those are two
// different questions here.
const areaSchema = `
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  polygon_geojson TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_areas_project_created ON areas(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_areas_user ON areas(user_id);
`

/*
Area is one ground inside one project.

user_id is carried as well as project_id, and it is not redundancy. Foreign keys
here are declared and never enforced -- nothing runs PRAGMA foreign_keys = ON,
which doc.go states outright -- so every reader in this package scopes by user
IN THE SAME STATEMENT rather than checking ownership first and trusting it
after. Without the column each of those statements would need a join to
projects, which is one more thing to get right a dozen times. The invariant that
an area's user is its project's user is established once, where the row is
created, by reading the project.

No position column. Areas are read in the order they were drawn, and nothing
reorders them; a column nothing writes is a column that will disagree with the
list one day.
*/
type Area struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	UserID    string `json:"user_id"`
	Name      string `json:"name"`
	// The ground itself, as GeoJSON. Stored as text for the reason every other
	// geometry column here is: the store does no geometry, and a shape it
	// cannot interpret is a shape it cannot corrupt.
	PolygonGeoJSON string `json:"polygon_geojson"`
	Notes          string `json:"notes"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	// How many runs are of this ground. Filled by the listing query, the way
	// Project.RunCount is, so a caller can size a list without loading it.
	RunCount int `json:"run_count"`
}

/*
CreateArea puts one ground inside one project.

The project is read in the same transaction the area is written in, for two
things at once: that it exists and belongs to this user, and whose user_id the
area carries. That is where the invariant "an area's user is its project's user"
is established, and it is established once so that every reader afterwards can
scope by user without a join.

THE NAME IS MINTED HERE WHEN THE CALLER HAS NONE. "drawn", "drawn 2", "drawn 3"
-- the sequence the frontend used to compute from its own copy of the catalogue.
It moves because the count it is derived from is one the store holds and the
caller does not: two draws reported in one batch read the same stale list and
produced two areas with one name between them, which is a defect this repository
has already had to fix twice from the other end.
*/
func (s *Store) CreateArea(userID string, a Area) (*Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	a.ProjectID = strings.TrimSpace(a.ProjectID)
	if a.ProjectID == "" || strings.TrimSpace(a.PolygonGeoJSON) == "" {
		return nil, ErrInvalidInput
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var owner string
	err = tx.QueryRow(`SELECT user_id FROM projects WHERE id = ?`, a.ProjectID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
		// ErrNotFound and not a distinct "not yours": the two answers together
		// would tell a caller which ids exist in another account.
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	a.UserID = owner
	/*
		The name is numbered whether the caller supplied a stem or not.

		It used to be numbered only when the caller had nothing, and any name
		it was given went in verbatim -- so two imports of one file, or two
		grounds drawn under one studio, produced two areas with one name
		between them. That is the same defect the numbering was moved in here
		to fix, reached from the other side: the caller cannot see what the
		project already holds, and this can.
	*/
	a.Name, err = provisionalName(tx, a.ProjectID, a.Name)
	if err != nil {
		return nil, err
	}
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	ts := nowISO()
	if a.CreatedAt == "" {
		a.CreatedAt = ts
	}
	a.UpdatedAt = ts

	if _, err := tx.Exec(
		`INSERT INTO areas
		 (id, project_id, user_id, name, polygon_geojson, notes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.ProjectID, a.UserID, a.Name, a.PolygonGeoJSON, a.Notes,
		a.CreatedAt, a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &a, nil
}

/*
provisionalName is the stem, then the stem and 2, and so on within one project.

"drawn" when the caller has no stem of its own, which is the sequence this
started as. A caller that does have one -- the file name an import carries, the
studio a ground was drawn under -- passes it and gets the same treatment, since
a name that is provisional is provisional whatever it was derived from.

Scoped to the project rather than to the user: two projects each holding a
"drawn" is not a collision, it is two fields with the same provisional name, and
numbering across them would make the second project open at "drawn 4".

Counted by asking rather than by taking the row count, because an area renamed
by hand leaves a gap the count would step on.
*/
func provisionalName(tx *sql.Tx, projectID, stem string) (string, error) {
	stem = strings.TrimSpace(stem)
	if stem == "" {
		stem = "drawn"
	}
	rows, err := tx.Query(`SELECT name FROM areas WHERE project_id = ?`, projectID)
	if err != nil {
		return "", err
	}
	defer func() { _ = rows.Close() }()
	taken := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return "", err
		}
		taken[strings.ToLower(strings.TrimSpace(n))] = true
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if !taken[strings.ToLower(stem)] {
		return stem, nil
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s %d", stem, i)
		if !taken[strings.ToLower(candidate)] {
			return candidate, nil
		}
	}
}

// ListAreas returns a project's grounds, oldest first, each with how many runs
// are of it. The order is the order they were drawn in, which is the only order
// that does not change under the reader.
func (s *Store) ListAreas(userID, projectID string) ([]Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(projectID) == "" {
		return nil, ErrInvalidInput
	}
	rows, err := s.db.Query(
		`SELECT a.id, a.project_id, a.user_id, a.name, a.polygon_geojson, a.notes,
		        a.created_at, a.updated_at,
		        (SELECT COUNT(1) FROM inference_runs r WHERE r.area_id = a.id)
		 FROM areas a
		 WHERE a.project_id = ? AND a.user_id = ?
		 ORDER BY a.created_at ASC`,
		projectID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []Area{}
	for rows.Next() {
		var a Area
		if err := rows.Scan(
			&a.ID, &a.ProjectID, &a.UserID, &a.Name, &a.PolygonGeoJSON, &a.Notes,
			&a.CreatedAt, &a.UpdatedAt, &a.RunCount,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetArea returns one ground, or ErrNotFound when it is not this user's.
func (s *Store) GetArea(userID, areaID string) (*Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(areaID) == "" {
		return nil, ErrInvalidInput
	}
	var a Area
	err := s.db.QueryRow(
		`SELECT id, project_id, user_id, name, polygon_geojson, notes,
		        created_at, updated_at
		 FROM areas WHERE id = ? AND user_id = ?`,
		areaID, userID,
	).Scan(
		&a.ID, &a.ProjectID, &a.UserID, &a.Name, &a.PolygonGeoJSON, &a.Notes,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// UpdateArea changes the name, the notes or the ground itself. The project is
// not among them: moving an area between projects has to move its runs with it,
// which is a different act and will need its own method when something asks.
func (s *Store) UpdateArea(userID string, a Area) (*Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(a.ID) == "" {
		return nil, ErrInvalidInput
	}
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" || strings.TrimSpace(a.PolygonGeoJSON) == "" {
		return nil, ErrInvalidInput
	}
	res, err := s.db.Exec(
		`UPDATE areas SET name = ?, notes = ?, polygon_geojson = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		a.Name, a.Notes, a.PolygonGeoJSON, nowISO(), a.ID, userID,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.GetArea(userID, a.ID)
}

/*
DeleteArea removes one ground and everything that is OF it.

Its runs go, and their rasters with them, because a run is a measurement of this
ground and means nothing without it. So do the board members naming those runs
and the compositions filed under the area. None of that happens on its own:
foreign keys here are declared and never enforced, so every cascade in this
package is written where the delete is -- DeleteProject and DeleteStudio
each say the same.

The row directories are removed after the transaction commits, in the order
DeleteRun uses: a file removed for a row that then fails to delete is a run
listed with nothing behind it.
*/
func (s *Store) DeleteArea(userID, areaID string) error {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(areaID) == "" {
		return ErrInvalidInput
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var owner string
	err = tx.QueryRow(`SELECT user_id FROM areas WHERE id = ?`, areaID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	// Collected before the rows go, since afterwards there is nothing left to
	// ask which directories were theirs.
	runIDs, err := runIDsOfArea(tx, areaID)
	if err != nil {
		return err
	}

	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`DELETE FROM studio_members WHERE run_id IN
		   (SELECT id FROM inference_runs WHERE area_id = ?)`, []any{areaID}},
		{`DELETE FROM project_overlays WHERE area_id = ?`, []any{areaID}},
		{`DELETE FROM inference_runs WHERE area_id = ?`, []any{areaID}},
		{`UPDATE projects SET last_area_id = '' WHERE last_area_id = ?`, []any{areaID}},
		{`DELETE FROM areas WHERE id = ? AND user_id = ?`, []any{areaID, userID}},
	} {
		if _, err := tx.Exec(stmt.sql, stmt.args...); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	for _, id := range runIDs {
		_ = os.RemoveAll(s.RunsDir(id))
	}
	return nil
}

func runIDsOfArea(tx *sql.Tx, areaID string) ([]string, error) {
	rows, err := tx.Query(`SELECT id FROM inference_runs WHERE area_id = ?`, areaID)
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

/*
ListRunsByArea lists the runs of one ground, newest first.

The counterpart of ListRunsByProject one level down, and the query the hub needs
to show a project as its areas rather than as a flat list of runs. Scoped by
user in the same statement for the reason the rest of this file is.
*/
func (s *Store) ListRunsByArea(userID, areaID string, limit int) ([]InferenceRun, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(areaID) == "" {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(
		`SELECT id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
		        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
		        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
		        COALESCE(project_id,''), COALESCE(kind,'classification'),
		        COALESCE(area_id,'')
		 FROM inference_runs
		 WHERE user_id = ? AND area_id = ?
		 ORDER BY created_at DESC LIMIT ?`,
		userID, areaID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []InferenceRun{}
	for rows.Next() {
		var r InferenceRun
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.CreatedAt, &r.ModelKind, &r.PeriodStart, &r.PeriodEnd,
			&r.PolygonGeoJSON, &r.Status, &r.SummaryJSON, &r.OverlayRelPath, &r.NDates,
			&r.ResultJSON, &r.AssetsRelPath, &r.Label, &r.ProjectID, &r.Kind,
			&r.AreaID,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
