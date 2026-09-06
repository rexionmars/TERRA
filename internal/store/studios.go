package store

/*
A studio is a working surface for areas, saved by name.

Two analyses of areas at different points on Earth cannot be placed side by
side on a map: the map puts them where they are, which is hundreds of
kilometres apart. Lifting the rasters off their coordinates is what makes the
studio possible, and the arrangement that results -- which runs, in what
order, named how, sitting where -- is not derivable from anything else. It is a
document, so it is stored as one.

What is NOT stored here is any raster. A member names a run and the run owns
its own files; a studio that copied them would be a second set to keep in
step with the first, and would grow without bound as the same run appeared in
several studios.
*/

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
)

// Studio is several runs placed beside one another on the isolate board.
type Studio struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	/*
		The project this board arranges.

		A board used to belong to the user alone, so the menu offered every
		board ever saved regardless of which project was open, and nothing
		stopped a board mixing runs from several. Under Project > Areas > Runs
		a board is one project's reading of its own work, and SaveStudio
		refuses a member whose run belongs elsewhere.

		Empty on a board saved before this column existed. Those are listed
		with the ones of the open project rather than hidden, because a board
		that cannot be found is indistinguishable from one that was lost.
	*/
	ProjectID string `json:"project_id,omitempty"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	/*
		The board's own settings: separation between layers, and whatever the
		surface adds later.

		Opaque JSON, because its shape belongs to the surface that draws the
		board rather than to the store. A column per setting would make every
		new control a migration, for values nothing here ever reads.
	*/
	ViewJSON string `json:"view_json,omitempty"`
	/** Filled by Get, and by List only as a count -- see MemberCount. */
	Members     []StudioMember `json:"members,omitempty"`
	MemberCount int            `json:"member_count"`
}

// StudioMember is one run's place in a studio.
type StudioMember struct {
	ID       string `json:"id"`
	StudioID string `json:"studio_id"`
	RunID    string `json:"run_id"`
	/** Order on the board, left to right. */
	Position int `json:"position"`
	/*
		The name given on the board, over the one the run carries.

		Empty means the run's own name is used, rather than meaning the member
		has no name: a run renamed later is still followed until someone has
		said otherwise.
	*/
	Name string `json:"name,omitempty"`
	/*
		Where the group sits, and how its planes are set.

		Opaque for the same reason as ViewJSON, and it is the frontend's
		CardPlane vocabulary: offsets in board units, per-layer opacity and
		visibility. None of it means anything to the store.
	*/
	StateJSON string `json:"state_json,omitempty"`
	/*
		The run this member names is gone.

		Reported rather than hidden. Foreign keys are declared in the schema
		but SQLite enforces them only with `PRAGMA foreign_keys = ON`, which
		this connection does not set -- so a deleted run leaves its members
		behind, and always has for project overlays too. Reading them out is a
		choice: a studio that silently lost a side would look like a
		studio of one thing, and the user would have no way to tell that
		from having built it that way.
	*/
	Missing bool `json:"missing,omitempty"`
}

const studioSchema = `
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  view_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_studios_user_updated
  ON studios(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS studio_members (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_studio_members_studio
  ON studio_members(studio_id, position);
`

/*
SaveStudio writes an arrangement whole, creating it if it is new.

Members are replaced rather than merged, because a board is saved as it stands:
a member removed from the board is removed from the studio, and reconciling
two lists would need the caller to say which of the two it meant. The rows are
rewritten in one transaction so a failure halfway does not leave an arrangement
that is half of one save and half of another.
*/
func (s *Store) SaveStudio(c Studio) (*Studio, error) {
	if c.UserID == "" {
		return nil, ErrInvalidInput
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return nil, ErrInvalidInput
	}
	c.ProjectID = strings.TrimSpace(c.ProjectID)
	/*
		An arrangement that is not JSON is stored as no arrangement.

		The same rule SaveRun applies to summary_json and result_json, and for
		the same reason: this column is opaque to the store but not to
		everything -- the frontend parses it to reopen a board, and
		repairStudioViews reads the run ids out of it. A string that neither can
		parse is not a board that was saved, it is a board that was lost on the
		way in, and storing it as `{}` says so once instead of failing at every
		later reader.
	*/
	if c.ViewJSON == "" || !json.Valid([]byte(c.ViewJSON)) {
		c.ViewJSON = "{}"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	ts := nowISO()
	c.UpdatedAt = ts
	if c.ID == "" {
		c.ID = uuid.NewString()
		if c.CreatedAt == "" {
			c.CreatedAt = ts
		}
		if _, err := tx.Exec(
			`INSERT INTO studios
			 (id, user_id, project_id, name, created_at, updated_at, view_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			c.ID, c.UserID, c.ProjectID, c.Name, c.CreatedAt, c.UpdatedAt, c.ViewJSON,
		); err != nil {
			return nil, err
		}
	} else {
		res, err := tx.Exec(
			`UPDATE studios SET project_id = ?, name = ?, updated_at = ?, view_json = ?
			 WHERE id = ? AND user_id = ?`,
			c.ProjectID, c.Name, c.UpdatedAt, c.ViewJSON, c.ID, c.UserID,
		)
		if err != nil {
			return nil, err
		}
		// Scoped by user in the same statement rather than checked first, so
		// there is no window between the check and the write.
		if n, _ := res.RowsAffected(); n == 0 {
			return nil, ErrNotFound
		}
		if err := tx.QueryRow(
			`SELECT created_at FROM studios WHERE id = ?`, c.ID,
		).Scan(&c.CreatedAt); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(
			`DELETE FROM studio_members WHERE studio_id = ?`, c.ID,
		); err != nil {
			return nil, err
		}
	}

	for i := range c.Members {
		m := &c.Members[i]
		m.RunID = strings.TrimSpace(m.RunID)
		if m.RunID == "" {
			return nil, ErrInvalidInput
		}
		/*
			The run must be this user's, and must belong to the project this
			board is of. Without foreign keys enforced, nothing else would stop
			a studio naming a row it has no claim to, and the board would
			then load and draw it.

			The project half is checked only when this board has a project and
			the run has one. A board saved before boards had projects carries
			none, and refusing to re-save it would leave a reader unable to
			touch work they can plainly see.
		*/
		var owner, runProject string
		err := tx.QueryRow(
			`SELECT user_id, COALESCE(project_id,'') FROM inference_runs WHERE id = ?`,
			m.RunID,
		).Scan(&owner, &runProject)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != c.UserID) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		if c.ProjectID != "" && runProject != "" && runProject != c.ProjectID {
			return nil, ErrInvalidInput
		}
		m.ID = uuid.NewString()
		m.StudioID = c.ID
		m.Position = i
		if m.StateJSON == "" {
			m.StateJSON = "{}"
		}
		if _, err := tx.Exec(
			`INSERT INTO studio_members
			 (id, studio_id, run_id, position, name, state_json)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			m.ID, m.StudioID, m.RunID, m.Position, m.Name, m.StateJSON,
		); err != nil {
			return nil, err
		}
	}
	c.MemberCount = len(c.Members)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &c, nil
}

/*
ListStudios returns the arrangements of one project, most recently saved
first.

An empty projectID returns every board the user has, which is what the storage
and backup views want. The board menu passes the open project, because a menu
offering boards belonging to other projects is what let one project's runs be
arranged onto another's board.

Boards carrying no project are returned alongside a project's own. They predate
the column, and a board that cannot be found is indistinguishable from one that
was lost.
*/
func (s *Store) ListStudios(userID, projectID string) ([]Studio, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	where, args := "c.user_id = ?", []any{userID}
	if p := strings.TrimSpace(projectID); p != "" {
		where += " AND (c.project_id = ? OR COALESCE(c.project_id,'') = '')"
		args = append(args, p)
	}
	rows, err := s.db.Query(
		`SELECT c.id, c.user_id, COALESCE(c.project_id,''), c.name, c.created_at,
		        c.updated_at, c.view_json,
		        (SELECT COUNT(1) FROM studio_members m WHERE m.studio_id = c.id)
		 FROM studios c
		 WHERE `+where+`
		 ORDER BY c.updated_at DESC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Never nil: an empty list serialises as [] rather than null, which the
	// frontend would have to guard on every call site.
	out := []Studio{}
	for rows.Next() {
		var c Studio
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.ProjectID, &c.Name, &c.CreatedAt, &c.UpdatedAt,
			&c.ViewJSON, &c.MemberCount,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetStudio returns one arrangement with its members, in board order.
func (s *Store) GetStudio(userID, id string) (*Studio, error) {
	if userID == "" || id == "" {
		return nil, ErrInvalidInput
	}
	var c Studio
	err := s.db.QueryRow(
		`SELECT id, user_id, COALESCE(project_id,''), name, created_at, updated_at, view_json
		 FROM studios WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&c.ID, &c.UserID, &c.ProjectID, &c.Name, &c.CreatedAt, &c.UpdatedAt, &c.ViewJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	/*
		Left join, so a member whose run has been deleted still comes back --
		marked, not dropped. See StudioMember.Missing.
	*/
	rows, err := s.db.Query(
		`SELECT m.id, m.studio_id, m.run_id, m.position, m.name, m.state_json,
		        r.id IS NULL
		 FROM studio_members m
		 LEFT JOIN inference_runs r ON r.id = m.run_id
		 WHERE m.studio_id = ?
		 ORDER BY m.position ASC`,
		c.ID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	c.Members = []StudioMember{}
	for rows.Next() {
		var m StudioMember
		if err := rows.Scan(
			&m.ID, &m.StudioID, &m.RunID, &m.Position, &m.Name,
			&m.StateJSON, &m.Missing,
		); err != nil {
			return nil, err
		}
		c.Members = append(c.Members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	c.MemberCount = len(c.Members)
	return &c, nil
}

// RenameStudio changes the name without reading or rewriting the members.
func (s *Store) RenameStudio(userID, id, name string) error {
	if userID == "" || id == "" {
		return ErrInvalidInput
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidInput
	}
	res, err := s.db.Exec(
		`UPDATE studios SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		name, nowISO(), id, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

/*
DeleteStudio removes an arrangement and its members.

The members are deleted here rather than left to the cascade the schema
declares: this connection does not turn foreign keys on, so that clause never
fires and the rows would stay behind, invisible and attached to an id that no
longer resolves.
*/
func (s *Store) DeleteStudio(userID, id string) error {
	if userID == "" || id == "" {
		return ErrInvalidInput
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(
		`DELETE FROM studios WHERE id = ? AND user_id = ?`, id, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(
		`DELETE FROM studio_members WHERE studio_id = ?`, id,
	); err != nil {
		return err
	}
	return tx.Commit()
}

/*
Taking a run out of the arrangements that name it.

A studio keeps its arrangement in one opaque field, `view_json`, written by the
frontend and meaningless to this package -- except for one thing, which is that
the run ids are in there. Deleting a run used to leave every one of them
behind: the member row went, and the blob went on naming a run nothing could
open. The studio then reported no gap, because the gap is reported from the
member rows and those were the part that had been removed. One installation
carried a studio in exactly that state, referencing two deleted runs and
holding no members at all, which opens as an empty board with nothing to say
why.

FOUR KEY CONVENTIONS, and they are the frontend's, not this package's. See
components/studio/boardMemory.ts, which writes them:

An id on its own keys `added`, `order` and `places`. An id, a NUL and a scene
id key `extraState` and `planePlaces`, and are also what the `removed` and
`flat` lists hold. A row id whose second "::" segment is the run id keys
`names`. And `runIds` is a bare list of them.

Anything else in the object is copied through untouched. That is the point of
walking the shape rather than rewriting it: a field this package has never
heard of belongs to the frontend and survives, and one the frontend adds later
that happens to be keyed by run id will be missed here rather than corrupted --
a gap a test can close, not a loss.
*/
func pruneViewRuns(view string, drop map[string]bool) (string, bool) {
	if len(drop) == 0 || strings.TrimSpace(view) == "" {
		return view, false
	}
	/*
		UseNumber, so a coordinate comes back out as it went in.

		The board writes plane placements as full-precision floats. Decoded
		into float64 and re-encoded they would be rewritten to whatever Go
		prints them as, which is a change to a field this function has no
		business changing.
	*/
	dec := json.NewDecoder(strings.NewReader(view))
	dec.UseNumber()
	var obj map[string]any
	if err := dec.Decode(&obj); err != nil {
		// Not an object this function understands. Left exactly as it is:
		// refusing to rewrite something unparseable is the safe half of a
		// best-effort cleanup.
		return view, false
	}

	changed := false

	// `runIds`: the membership list itself.
	if list, ok := obj["runIds"].([]any); ok {
		kept := make([]any, 0, len(list))
		for _, v := range list {
			if id, ok := v.(string); ok && drop[id] {
				changed = true
				continue
			}
			kept = append(kept, v)
		}
		obj["runIds"] = kept
	}

	// Keyed by the id on its own.
	for _, field := range []string{"added", "order", "places"} {
		m, ok := obj[field].(map[string]any)
		if !ok {
			continue
		}
		for k := range m {
			if drop[k] {
				delete(m, k)
				changed = true
			}
		}
	}

	// Keyed by the id, a NUL, and a scene id.
	for _, field := range []string{"extraState", "planePlaces"} {
		m, ok := obj[field].(map[string]any)
		if !ok {
			continue
		}
		for k := range m {
			if drop[sceneKeyArea(k)] {
				delete(m, k)
				changed = true
			}
		}
	}

	// Lists of those same scene keys.
	for _, field := range []string{"removed", "flat"} {
		list, ok := obj[field].([]any)
		if !ok {
			continue
		}
		kept := make([]any, 0, len(list))
		for _, v := range list {
			if k, ok := v.(string); ok && drop[sceneKeyArea(k)] {
				changed = true
				continue
			}
			kept = append(kept, v)
		}
		obj[field] = kept
	}

	// Row keys, whose second segment is the id.
	if m, ok := obj["names"].(map[string]any); ok {
		for k := range m {
			if parts := strings.Split(k, "::"); len(parts) >= 2 && drop[parts[1]] {
				delete(m, k)
				changed = true
			}
		}
	}

	if !changed {
		return view, false
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return view, false
	}
	return string(out), true
}

// sceneKeyArea is the area half of an `<area>\x00<scene>` key, or the whole
// string when it carries no scene.
func sceneKeyArea(k string) string {
	if i := strings.IndexByte(k, 0); i >= 0 {
		return k[:i]
	}
	return k
}

/*
dropRunsFromViews rewrites every arrangement of one user that names a run in
`drop`, and reports how many it rewrote.

Takes the transaction rather than the store, because the only correct time to
do this is inside the one that removes the run: a studio pointing at a run that
is half deleted is the state this exists to prevent.
*/
func dropRunsFromViews(tx *sql.Tx, userID string, drop map[string]bool) (int, error) {
	if len(drop) == 0 {
		return 0, nil
	}
	writes, err := viewsWithout(tx, userID, drop)
	if err != nil {
		return 0, err
	}
	// After the read, not during it. The reading is a function of its own so
	// its cursor is closed by defer before the first write goes out: this
	// package holds a single connection, and a write issued while a cursor is
	// open on it is a shape worth not depending on.
	for _, w := range writes {
		if _, err := tx.Exec(
			`UPDATE studios SET view_json = ? WHERE id = ?`, w.view, w.id,
		); err != nil {
			return 0, err
		}
	}
	return len(writes), nil
}

// viewRewrite is one arrangement and what it should become.
type viewRewrite struct{ id, view string }

// viewsWithout is the rewrite each of a user's studios needs, for those that
// need one.
func viewsWithout(tx *sql.Tx, userID string, drop map[string]bool) ([]viewRewrite, error) {
	rows, err := tx.Query(
		`SELECT id, view_json FROM studios WHERE user_id = ?`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var writes []viewRewrite
	for rows.Next() {
		var id, view string
		if err := rows.Scan(&id, &view); err != nil {
			return nil, err
		}
		if next, ok := pruneViewRuns(view, drop); ok {
			writes = append(writes, viewRewrite{id, next})
		}
	}
	return writes, rows.Err()
}

/*
repairStudioViews takes deleted runs out of every arrangement still naming one.

For the files that were written before deletion reached the blob. Not gated on
the schema version, for the reason the drops in migrate give: a version number
can be raised without the work behind it, and a file that slipped through such
a window is one no later gate reopens. It is idempotent and it is a single
query over a table holding a handful of rows, so running it at every open costs
the read and nothing else.
*/
func (s *Store) repairStudioViews() error {
	writes, err := s.viewsWithoutDeletedRuns()
	if err != nil {
		return err
	}
	for _, w := range writes {
		if _, err := s.db.Exec(
			`UPDATE studios SET view_json = ? WHERE id = ?`, w.view, w.id,
		); err != nil {
			return err
		}
	}
	return nil
}

// viewsWithoutDeletedRuns is what each arrangement naming a run with no row
// should become. Split from the write for the reason dropRunsFromViews gives.
func (s *Store) viewsWithoutDeletedRuns() ([]viewRewrite, error) {
	/*
		json_valid FIRST, and it is not defensive dressing.

		json_extract raises "malformed JSON" while the statement is stepping,
		not when it is prepared, and one such row aborts the whole query -- so a
		single unparseable arrangement would have taken this repair down, and
		with it migrate, and with it Open. The application would decline to
		start over a field it holds precisely because it does not have to
		understand it. SQLite evaluates the WHERE of the left table before
		expanding the table-valued function, so an invalid row never reaches
		json_extract.
	*/
	rows, err := s.db.Query(`
		SELECT DISTINCT s.id, s.view_json, j.value
		  FROM (SELECT id, view_json FROM studios WHERE json_valid(view_json)) s,
		       json_each(json_extract(s.view_json, '$.runIds')) j
		  LEFT JOIN inference_runs r ON r.id = j.value
		 WHERE r.id IS NULL`)
	if err != nil {
		// json_each is a table-valued function; a build of SQLite without JSON
		// support would fail here, and a repair that cannot run is not a
		// reason to refuse to open the database.
		return nil, nil
	}
	defer func() { _ = rows.Close() }()

	gone := map[string]map[string]bool{}
	views := map[string]string{}
	var order []string
	for rows.Next() {
		var id, view, runID string
		if err := rows.Scan(&id, &view, &runID); err != nil {
			return nil, err
		}
		if gone[id] == nil {
			gone[id] = map[string]bool{}
			order = append(order, id)
		}
		gone[id][runID] = true
		views[id] = view
	}
	if err := rows.Err(); err != nil {
		// Nothing repaired rather than nothing opened, for the reason the
		// query error above gives. The guard makes this unreachable for the
		// case that was found; it stands for the one that has not been.
		return nil, nil
	}

	var writes []viewRewrite
	for _, id := range order {
		if next, ok := pruneViewRuns(views[id], gone[id]); ok {
			writes = append(writes, viewRewrite{id, next})
		}
	}
	return writes, nil
}
