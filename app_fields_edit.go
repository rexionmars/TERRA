package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

/*
Reviewing fields by hand before the products that run over them: a field cut
along a line, neighbours joined into one, an outline reshaped. Deleting a field
is DeleteArea's, since a field is an area.

The cut and the join are geometry, done by the sidecar in the field's UTM zone
(sidecar/terra/fields/editing.py); the store then puts the result in the place
of what it replaces, in one transaction, and removes the runs made over the old
ground (internal/store/fields_edit.go says why). The interface asks before an
edit that removes any.
*/

// SplitField cuts one field along a line drawn across it. The field is
// replaced by its parts, named after it with a letter each, largest first.
func (a *App) SplitField(fieldID string, line analysis.GeoJSONLine) ([]store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	field, err := st.GetArea(userID, fieldID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if field.ParentID == "" {
		return nil, errors.New("only a field can be cut; this is an area")
	}
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	parts, err := runner.SplitField(a.ctx, field.PolygonGeoJSON, line)
	if err != nil {
		return nil, err
	}
	add := make([]store.Area, len(parts))
	for i, p := range parts {
		poly, err := json.Marshal(p.Geometry)
		if err != nil {
			return nil, err
		}
		add[i] = store.Area{
			Name:           partName(field.Name, i),
			PolygonGeoJSON: string(poly),
			SourceRunID:    field.SourceRunID,
		}
	}
	made, err := st.ReplaceFields(userID, []string{field.ID}, add)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return made, nil
}

// partName is the name of the i-th part of a field cut in pieces: "field 12a",
// "field 12b", and past the alphabet "field 12-27".
func partName(name string, i int) string {
	if i < 26 {
		return name + string(rune('a'+i))
	}
	return fmt.Sprintf("%s-%d", name, i+1)
}

/*
JoinFields makes neighbouring fields of one area one field, across the strip
the delineation leaves between them.

The field made takes the name of the first one given; the interface passes
them in the order it lists them, so it is the lowest number. It keeps the
delineation they were adopted from when they share one, so a later delineation
replaces it as it would have replaced them; otherwise it counts as drawn by
hand, which a delineation leaves alone.
*/
func (a *App) JoinFields(fieldIDs []string) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	if len(fieldIDs) < 2 {
		return nil, errors.New("choose at least two fields to join")
	}
	userID := a.effectiveUserID()
	fields := make([]*store.Area, len(fieldIDs))
	polygons := make([]string, len(fieldIDs))
	for i, id := range fieldIDs {
		f, err := st.GetArea(userID, id)
		if err != nil {
			return nil, mapStoreErr(err)
		}
		if f.ParentID == "" || (i > 0 && f.ParentID != fields[0].ParentID) {
			return nil, errors.New("only fields of one area can be joined")
		}
		fields[i], polygons[i] = f, f.PolygonGeoJSON
	}
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	part, err := runner.JoinFields(a.ctx, polygons)
	if err != nil {
		return nil, err
	}
	poly, err := json.Marshal(part.Geometry)
	if err != nil {
		return nil, err
	}
	source := fields[0].SourceRunID
	for _, f := range fields[1:] {
		if f.SourceRunID != source {
			source = ""
		}
	}
	made, err := st.ReplaceFields(userID, fieldIDs, []store.Area{{
		Name:           fields[0].Name,
		PolygonGeoJSON: string(poly),
		SourceRunID:    source,
	}})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return &made[0], nil
}

// ReshapeArea gives an area or a field the outline it was edited to on the map,
// and removes the runs made over the old one.
func (a *App) ReshapeArea(areaID, polygonGeoJSON string) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	var poly analysis.GeoJSONGeometry
	if err := json.Unmarshal([]byte(polygonGeoJSON), &poly); err != nil {
		return nil, fmt.Errorf("the outline is not GeoJSON: %w", err)
	}
	if poly.Type != "Polygon" || len(poly.Coordinates) == 0 || len(poly.Coordinates[0]) < 4 {
		return nil, errors.New("the outline has to be a polygon of at least three corners")
	}
	area, err := st.ReshapeArea(a.effectiveUserID(), strings.TrimSpace(areaID), polygonGeoJSON)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return area, nil
}
