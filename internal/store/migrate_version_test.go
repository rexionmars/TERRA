package store

/*
The two databases migrate has to bring to the same place: one that does not
exist yet, and one written by the build that had no version at all.

The second is the one worth a test. Every install in the field carries every
additive column and still reports user_version = 0, because idempotence used to
come from discarding the error from the ALTER. A migration that trusted the
version alone would run those ALTERs again, take "duplicate column name" for a
failure, and refuse to open a database that is in fact current -- with the
user's analyses sitting in it.
*/

import (
	"database/sql"
	"path/filepath"
	"testing"
)

/*
openStoreOnFile opens a Store over one database file, without migrating it.

openStoreIn migrates on the way in and fails the test if that returns an error,
which is the wrong shape for the legacy case: the file has to be written by
hand first and then migrated deliberately, because whether migrate returns an
error is the thing being asserted.
*/
func openStoreOnFile(t *testing.T, dbPath string) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, dataDir: filepath.Dir(dbPath)}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func hasTable(t *testing.T, s *Store, name string) bool {
	t.Helper()
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`,
		name,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}

func hasColumn(t *testing.T, s *Store, table, column string) bool {
	t.Helper()
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info(?) WHERE name = ?`, table, column,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}

// The shape the readers in this package select from, table by table. Listed
// here rather than derived from the schema string, so that a column dropped
// from migrate fails this test instead of agreeing with itself.
var expectedColumns = map[string][]string{
	"users":              {"id", "email", "display_name", "password_hash", "avatar_path", "created_at", "updated_at"},
	"sessions":           {"token", "user_id", "expires_at"},
	"preferences":        {"user_id", "default_model", "overlay_opacity", "theme", "extras_json"},
	"inference_runs":     {"id", "user_id", "created_at", "model_kind", "period_start", "period_end", "polygon_geojson", "status", "summary_json", "overlay_relpath", "n_dates", "result_json", "assets_relpath", "label", "project_id", "kind", "aoi_id"},
	"projects":           {"id", "user_id", "name", "notes", "created_at", "updated_at", "polygon_geojson", "area_id", "label"},
	"project_overlays":   {"id", "project_id", "kind", "title", "meta_json", "png_relpath", "tif_relpath", "created_at", "run_id"},
	"whiteboards":        {"id", "user_id", "name", "created_at", "updated_at", "view_json"},
	"whiteboard_members": {"id", "whiteboard_id", "run_id", "position", "name", "state_json"},
}

func assertCurrentShape(t *testing.T, s *Store) {
	t.Helper()
	at, err := s.userVersion()
	if err != nil {
		t.Fatal(err)
	}
	if at != schemaVersion {
		t.Errorf("user_version is %d after migrate, want %d", at, schemaVersion)
	}
	for table, columns := range expectedColumns {
		if !hasTable(t, s, table) {
			t.Errorf("table %s is missing", table)
			continue
		}
		for _, c := range columns {
			if !hasColumn(t, s, table, c) {
				t.Errorf("%s.%s is missing", table, c)
			}
		}
	}
}

// A database that did not exist a moment ago ends at the current version with
// every table and column the readers select from, and migrating it a second
// time changes nothing -- the path an ordinary launch takes on every run after
// the first.
func TestFreshDatabaseReachesCurrentVersion(t *testing.T) {
	s := openStoreOnFile(t, filepath.Join(t.TempDir(), dbFileName))
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	assertCurrentShape(t, s)
	if err := s.migrate(); err != nil {
		t.Fatalf("migrating an up-to-date database: %v", err)
	}
	assertCurrentShape(t, s)
}

/*
A database as the version-less build left it: every additive column applied,
user_version never written, whiteboards not yet invented.

Built statement by statement rather than by calling migrate and then resetting
the version, because what has to be reproduced is the old file, not this build's
idea of it.
*/
func buildLegacyDatabase(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)

	legacy := []string{
		`CREATE TABLE users (
		  id TEXT PRIMARY KEY,
		  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
		  display_name TEXT NOT NULL,
		  password_hash TEXT NOT NULL,
		  avatar_path TEXT,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE sessions (
		  token TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		  expires_at TEXT NOT NULL
		)`,
		`CREATE TABLE preferences (
		  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		  default_model TEXT NOT NULL DEFAULT 'spectral',
		  overlay_opacity REAL NOT NULL DEFAULT 0.75,
		  theme TEXT NOT NULL DEFAULT 'dark',
		  extras_json TEXT NOT NULL DEFAULT '{}'
		)`,
		`CREATE TABLE inference_runs (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		  created_at TEXT NOT NULL,
		  model_kind TEXT NOT NULL,
		  period_start TEXT NOT NULL,
		  period_end TEXT NOT NULL,
		  polygon_geojson TEXT NOT NULL,
		  status TEXT NOT NULL,
		  summary_json TEXT NOT NULL DEFAULT '{}',
		  overlay_relpath TEXT,
		  n_dates INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE projects (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		  name TEXT NOT NULL,
		  notes TEXT NOT NULL DEFAULT '',
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  polygon_geojson TEXT NOT NULL DEFAULT '',
		  area_id TEXT NOT NULL DEFAULT '',
		  label TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE project_overlays (
		  id TEXT PRIMARY KEY,
		  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		  kind TEXT NOT NULL DEFAULT 'composition',
		  title TEXT NOT NULL DEFAULT '',
		  meta_json TEXT NOT NULL DEFAULT '{}',
		  png_relpath TEXT,
		  tif_relpath TEXT,
		  created_at TEXT NOT NULL
		)`,
		// The additive columns, applied then as they are applied now.
		`ALTER TABLE inference_runs ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE inference_runs ADD COLUMN assets_relpath TEXT`,
		`ALTER TABLE inference_runs ADD COLUMN label TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE inference_runs ADD COLUMN project_id TEXT`,
		`ALTER TABLE inference_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'classification'`,
		`ALTER TABLE inference_runs ADD COLUMN aoi_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE project_overlays ADD COLUMN run_id TEXT`,
	}
	for _, stmt := range legacy {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("building the legacy database: %v", err)
		}
	}

	// The work that must survive: an account, a project, a run of a kind added
	// by one of those ALTERs, and a composition pointing at it.
	seed := [][]any{
		{`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
		  VALUES (?, ?, ?, ?, ?, ?)`,
			"user-legacy", "keeper@example.test", "Keeper", "not-a-real-hash", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"},
		{`INSERT INTO projects (id, user_id, name, created_at, updated_at)
		  VALUES (?, ?, ?, ?, ?)`,
			"project-legacy", "user-legacy", "Field", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"},
		{`INSERT INTO inference_runs
		  (id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
		   status, summary_json, n_dates, result_json, label, project_id, kind, aoi_id)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"run-legacy", "user-legacy", "2024-02-03T10:00:00Z", "spectral", "2024-01-01", "2024-01-31",
			`{"type":"Polygon"}`, "ok", `{"n":1}`, 4, `{"classes":[]}`, "Soy, south block",
			"project-legacy", RunKindWater, "aoi-legacy"},
		{`INSERT INTO project_overlays (id, project_id, kind, title, meta_json, created_at, run_id)
		  VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"overlay-legacy", "project-legacy", "composition", "False colour", "{}",
			"2024-02-03T11:00:00Z", "run-legacy"},
	}
	for _, row := range seed {
		if _, err := db.Exec(row[0].(string), row[1:]...); err != nil {
			t.Fatalf("seeding the legacy database: %v", err)
		}
	}

	var at int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&at); err != nil {
		t.Fatal(err)
	}
	if at != 0 {
		t.Fatalf("the legacy database reports user_version %d, want 0", at)
	}
}

// The case the version alone cannot decide: a database carrying every column
// and no version at all. Migrating it must succeed, must leave its rows where
// they are, and must add what it genuinely lacks -- the whiteboard tables,
// which did not exist when it was written.
func TestLegacyDatabaseWithoutAVersionMigrates(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), dbFileName)
	buildLegacyDatabase(t, dbPath)

	s := openStoreOnFile(t, dbPath)
	if err := s.migrate(); err != nil {
		t.Fatalf("migrating a database that already has every column: %v", err)
	}
	assertCurrentShape(t, s)

	run, err := s.GetRun("user-legacy", "run-legacy")
	if err != nil {
		t.Fatalf("reading the run written before the version existed: %v", err)
	}
	if run.Label != "Soy, south block" {
		t.Errorf("run label is %q, want %q", run.Label, "Soy, south block")
	}
	if run.Kind != RunKindWater {
		t.Errorf("run kind is %q, want %q", run.Kind, RunKindWater)
	}
	if run.AoiID != "aoi-legacy" {
		t.Errorf("run aoi_id is %q, want %q", run.AoiID, "aoi-legacy")
	}
	if run.ProjectID != "project-legacy" {
		t.Errorf("run project_id is %q, want %q", run.ProjectID, "project-legacy")
	}

	for _, c := range []struct {
		query string
		want  int
		what  string
	}{
		{`SELECT COUNT(1) FROM users WHERE id = 'user-legacy'`, 1, "the account"},
		{`SELECT COUNT(1) FROM projects WHERE id = 'project-legacy'`, 1, "the project"},
		{`SELECT COUNT(1) FROM inference_runs WHERE id = 'run-legacy'`, 1, "the run"},
		{`SELECT COUNT(1) FROM project_overlays WHERE run_id = 'run-legacy'`, 1, "the composition"},
	} {
		var n int
		if err := s.db.QueryRow(c.query).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != c.want {
			t.Errorf("%s: %d rows after migrating, want %d", c.what, n, c.want)
		}
	}
}
