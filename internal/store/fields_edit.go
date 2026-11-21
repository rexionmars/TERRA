package store

import (
	"database/sql"
	"errors"
	"os"
	"strings"
)

/*
Ground corrected by hand: a field cut in two, neighbours joined, an outline
moved.

WHAT WAS MADE OVER THE OLD GROUND GOES WITH IT. A run is a measurement of the
ground it names (DeleteArea), and the latest run of a product on a field is what
the interface reads as that field's answer (frontend/src/lib/fieldSets.ts). A
field whose outline has moved would otherwise answer with a measurement of the
outline it no longer has. So each method here removes the runs of the ground it
changes, as AdoptFields removes those of the fields it replaces, and the caller
asks first when there are any: removing them is the point, and the reader is the
one who can say whether the old measurements are worth more than the new shape.

The geometry itself is not done here, for the reason Area gives: the store does
none. The caller sends the polygons the sidecar made (app_fields_edit.go).
*/

// ReplaceFields puts the fields in add where the fields in remove were, in one
// transaction, and returns them as written. Every field removed has to be a
// field of the same area, and the ones added become fields of that area,
// stamped as edited now. Their names are the caller's, numbered by the store if
// a sibling already holds one; the names of the fields removed are free by
// then.
func (s *Store) ReplaceFields(userID string, remove []string, add []Area) ([]Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if len(remove) == 0 || len(add) == 0 {
		return nil, ErrInvalidInput
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var parentID, projectID string
	for _, id := range remove {
		var project, owner, parent string
		err := tx.QueryRow(
			`SELECT project_id, user_id, parent_id FROM areas WHERE id = ?`, id,
		).Scan(&project, &owner, &parent)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		// A root is not a field, and fields of two areas are not one edit.
		if parent == "" || (parentID != "" && parent != parentID) {
			return nil, ErrInvalidInput
		}
		parentID, projectID = parent, project
	}

	var runIDs []string
	for _, id := range remove {
		ids, err := removeAreaRows(tx, id, userID)
		if err != nil {
			return nil, err
		}
		runIDs = append(runIDs, ids...)
	}
	edited := nowISO()
	out := make([]Area, 0, len(add))
	for _, f := range add {
		if strings.TrimSpace(f.PolygonGeoJSON) == "" {
			return nil, ErrInvalidInput
		}
		a := Area{
			ProjectID:      projectID,
			UserID:         userID,
			Name:           f.Name,
			PolygonGeoJSON: f.PolygonGeoJSON,
			Notes:          f.Notes,
			ParentID:       parentID,
			SourceRunID:    f.SourceRunID,
			EditedAt:       edited,
		}
		if err := insertArea(tx, &a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	for _, id := range runIDs {
		_ = os.RemoveAll(s.RunsDir(id))
	}
	return out, nil
}

// ReshapeArea gives one ground, a field or an area, the outline it was edited
// to, stamps it as edited and removes what was made over the old one. Its
// fields, if it is an area, stay as they are: they are ground of their own.
func (s *Store) ReshapeArea(userID, areaID, polygonGeoJSON string) (*Area, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(areaID) == "" || strings.TrimSpace(polygonGeoJSON) == "" {
		return nil, ErrInvalidInput
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	ts := nowISO()
	res, err := tx.Exec(
		`UPDATE areas SET polygon_geojson = ?, edited_at = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		polygonGeoJSON, ts, ts, areaID, userID,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	runIDs, err := removeAreaRuns(tx, areaID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	for _, id := range runIDs {
		_ = os.RemoveAll(s.RunsDir(id))
	}
	return s.GetArea(userID, areaID)
}
