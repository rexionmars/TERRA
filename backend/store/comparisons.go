package store

/*
A comparison is a board arrangement, saved by name.

Two analyses of areas at different points on Earth cannot be placed side by
side on a map: the map puts them where they are, which is hundreds of
kilometres apart. Lifting the rasters off their coordinates is what makes the
comparison possible, and the arrangement that results -- which runs, in what
order, named how, sitting where -- is not derivable from anything else. It is a
document, so it is stored as one.

What is NOT stored here is any raster. A member names a run and the run owns
its own files; a comparison that copied them would be a second set to keep in
step with the first, and would grow without bound as the same run appeared in
several comparisons.
*/

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"
)

// Comparison is several runs placed beside one another on the isolate board.
type Comparison struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
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
	Members     []ComparisonMember `json:"members,omitempty"`
	MemberCount int                `json:"member_count"`
}

// ComparisonMember is one run's place in a comparison.
type ComparisonMember struct {
	ID           string `json:"id"`
	ComparisonID string `json:"comparison_id"`
	RunID        string `json:"run_id"`
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
		choice: a comparison that silently lost a side would look like a
		comparison of one thing, and the user would have no way to tell that
		from having built it that way.
	*/
	Missing bool `json:"missing,omitempty"`
}

const comparisonSchema = `
CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  view_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_comparisons_user_updated
  ON comparisons(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS comparison_members (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_comparison_members_comparison
  ON comparison_members(comparison_id, position);
`

/*
SaveComparison writes an arrangement whole, creating it if it is new.

Members are replaced rather than merged, because a board is saved as it stands:
a member removed from the board is removed from the comparison, and reconciling
two lists would need the caller to say which of the two it meant. The rows are
rewritten in one transaction so a failure halfway does not leave an arrangement
that is half of one save and half of another.
*/
func (s *Store) SaveComparison(c Comparison) (*Comparison, error) {
	if c.UserID == "" {
		return nil, ErrInvalidInput
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return nil, ErrInvalidInput
	}
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
			`INSERT INTO comparisons (id, user_id, name, created_at, updated_at, view_json)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			c.ID, c.UserID, c.Name, c.CreatedAt, c.UpdatedAt, c.ViewJSON,
		); err != nil {
			return nil, err
		}
	} else {
		res, err := tx.Exec(
			`UPDATE comparisons SET name = ?, updated_at = ?, view_json = ?
			 WHERE id = ? AND user_id = ?`,
			c.Name, c.UpdatedAt, c.ViewJSON, c.ID, c.UserID,
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
			`SELECT created_at FROM comparisons WHERE id = ?`, c.ID,
		).Scan(&c.CreatedAt); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(
			`DELETE FROM comparison_members WHERE comparison_id = ?`, c.ID,
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
			The run must be this user's. Without foreign keys enforced, nothing
			else would stop a comparison naming a row it has no claim to, and
			the board would then load and draw it.
		*/
		var owner string
		err := tx.QueryRow(
			`SELECT user_id FROM inference_runs WHERE id = ?`, m.RunID,
		).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != c.UserID) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		m.ID = uuid.NewString()
		m.ComparisonID = c.ID
		m.Position = i
		if m.StateJSON == "" {
			m.StateJSON = "{}"
		}
		if _, err := tx.Exec(
			`INSERT INTO comparison_members
			 (id, comparison_id, run_id, position, name, state_json)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			m.ID, m.ComparisonID, m.RunID, m.Position, m.Name, m.StateJSON,
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

// ListComparisons returns the user's arrangements, most recently saved first.
func (s *Store) ListComparisons(userID string) ([]Comparison, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	rows, err := s.db.Query(
		`SELECT c.id, c.user_id, c.name, c.created_at, c.updated_at, c.view_json,
		        (SELECT COUNT(1) FROM comparison_members m WHERE m.comparison_id = c.id)
		 FROM comparisons c
		 WHERE c.user_id = ?
		 ORDER BY c.updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Never nil: an empty list serialises as [] rather than null, which the
	// frontend would have to guard on every call site.
	out := []Comparison{}
	for rows.Next() {
		var c Comparison
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.Name, &c.CreatedAt, &c.UpdatedAt,
			&c.ViewJSON, &c.MemberCount,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetComparison returns one arrangement with its members, in board order.
func (s *Store) GetComparison(userID, id string) (*Comparison, error) {
	if userID == "" || id == "" {
		return nil, ErrInvalidInput
	}
	var c Comparison
	err := s.db.QueryRow(
		`SELECT id, user_id, name, created_at, updated_at, view_json
		 FROM comparisons WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&c.ID, &c.UserID, &c.Name, &c.CreatedAt, &c.UpdatedAt, &c.ViewJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	/*
		Left join, so a member whose run has been deleted still comes back --
		marked, not dropped. See ComparisonMember.Missing.
	*/
	rows, err := s.db.Query(
		`SELECT m.id, m.comparison_id, m.run_id, m.position, m.name, m.state_json,
		        r.id IS NULL
		 FROM comparison_members m
		 LEFT JOIN inference_runs r ON r.id = m.run_id
		 WHERE m.comparison_id = ?
		 ORDER BY m.position ASC`,
		c.ID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	c.Members = []ComparisonMember{}
	for rows.Next() {
		var m ComparisonMember
		if err := rows.Scan(
			&m.ID, &m.ComparisonID, &m.RunID, &m.Position, &m.Name,
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

// RenameComparison changes the name without reading or rewriting the members.
func (s *Store) RenameComparison(userID, id, name string) error {
	if userID == "" || id == "" {
		return ErrInvalidInput
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidInput
	}
	res, err := s.db.Exec(
		`UPDATE comparisons SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
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
DeleteComparison removes an arrangement and its members.

The members are deleted here rather than left to the cascade the schema
declares: this connection does not turn foreign keys on, so that clause never
fires and the rows would stay behind, invisible and attached to an id that no
longer resolves.
*/
func (s *Store) DeleteComparison(userID, id string) error {
	if userID == "" || id == "" {
		return ErrInvalidInput
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(
		`DELETE FROM comparisons WHERE id = ? AND user_id = ?`, id, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(
		`DELETE FROM comparison_members WHERE comparison_id = ?`, id,
	); err != nil {
		return err
	}
	return tx.Commit()
}
