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
	if c.ViewJSON == "" {
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
