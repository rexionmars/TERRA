package store

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

The schema lives here rather than in store.go for the reason whiteboardSchema
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
