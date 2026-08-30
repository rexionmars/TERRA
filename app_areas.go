package main

/*
The areas API, thin over internal/store.

Every method here resolves the effective user and hands through, the way
app_projects.go and app_whiteboards.go do. The rules that matter -- an area
belongs to a project, its user is the project's, deleting it takes the runs of
it -- live in the store, where a test reaches them without a running
application.

WHY THESE ARE BOUND AT ALL, when the catalogue used to need no API: it was a
JSON array inside a preferences blob, so the frontend held the whole of it and
the store never saw an area. That is what made a run's aoi_id point at something
nothing could check. An area is a row now, and a row is reached by asking.
*/

import "geosense-infer/internal/store"

// ListAreas returns the grounds inside one project, oldest first.
func (a *App) ListAreas(projectID string) ([]store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.ListAreas(a.effectiveUserID(), projectID)
}

/*
CreateArea puts one drawn ground inside a project.

The name is optional and usually absent: the store mints "drawn", "drawn 2" and
so on from what the project already holds. A caller that has a better name --
an imported file, say -- passes it and gets it.
*/
func (a *App) CreateArea(projectID, name, polygonGeoJSON string) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.CreateArea(a.effectiveUserID(), store.Area{
		ProjectID:      projectID,
		Name:           name,
		PolygonGeoJSON: polygonGeoJSON,
	})
}

// GetArea returns one ground.
func (a *App) GetArea(areaID string) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.GetArea(a.effectiveUserID(), areaID)
}

// UpdateArea renames a ground, or replaces the shape of it.
func (a *App) UpdateArea(area store.Area) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.UpdateArea(a.effectiveUserID(), area)
}

/*
DeleteArea removes a ground and every run of it.

Destructive in a way the old catalogue delete was not: removing an entry from a
JSON array left the runs alone, because nothing linked them. The caller is the
one that has to ask first -- the store does what it is told.
*/
func (a *App) DeleteArea(areaID string) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	return st.DeleteArea(a.effectiveUserID(), areaID)
}

// ListAreaRuns returns the runs of one ground, newest first.
func (a *App) ListAreaRuns(areaID string, limit int) ([]store.InferenceRun, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.ListRunsByArea(a.effectiveUserID(), areaID, limit)
}
