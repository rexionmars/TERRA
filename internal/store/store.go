package store

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrEmailTaken   = errors.New("email already registered")
	ErrInvalidCreds = errors.New("invalid email or password")
	ErrUnauthorized = errors.New("not authenticated")
	ErrInvalidInput = errors.New("invalid input")
)

const sessionTTL = 30 * 24 * time.Hour

// User is the public user profile (no password hash).
type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	AvatarPath  string `json:"avatar_path,omitempty"`
	AvatarURI   string `json:"avatar_uri,omitempty"` // data URI for the WebView
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// Preferences holds per-user UI/inference defaults.
type Preferences struct {
	UserID         string  `json:"user_id"`
	DefaultModel   string  `json:"default_model"`
	OverlayOpacity float64 `json:"overlay_opacity"`
	Theme          string  `json:"theme"`
	ExtrasJSON     string  `json:"extras_json,omitempty"`
}

// InferenceRun is a saved classification run summary.
type InferenceRun struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	CreatedAt      string `json:"created_at"`
	ModelKind      string `json:"model_kind"`
	PeriodStart    string `json:"period_start"`
	PeriodEnd      string `json:"period_end"`
	PolygonGeoJSON string `json:"polygon_geojson"`
	Status         string `json:"status"`
	SummaryJSON    string `json:"summary"`
	ResultJSON     string `json:"result_json,omitempty"`
	OverlayRelPath string `json:"overlay_relpath,omitempty"`
	AssetsRelPath  string `json:"assets_relpath,omitempty"`
	NDates         int    `json:"n_dates"`
	Label          string `json:"label,omitempty"`
	ProjectID      string `json:"project_id,omitempty"`
	// One of the RunKind constants below. Empty on rows written before the
	// column existed, which are all classifications; readers normalise it.
	Kind string `json:"kind,omitempty"`
	/*
		The ground this run was made over: a row in `areas`.

		A run has always carried its polygon, which says WHERE it was made and
		not WHICH area it belongs to. The board needs the second: an area and
		the runs over it are one subject, and without a link between them the
		same ground appears twice -- once as the area and once as each run --
		with nothing saying they are the same place.

		There was a second field beside this one, AoiID, holding the same idea
		against the old catalogue: it named an entry in a JSON array inside
		preferences, so it could name one that had been deleted and no query
		could resolve it. It is gone, and so is its column. Two names for one
		thing is the confusion this change exists to remove.

		Empty is possible -- a run restored from a shape that was never made an
		area -- and a reader that finds it empty falls back to geometry.
	*/
	AreaID string `json:"area_id,omitempty"`
}

// Run kinds. A classification comes from a model; a descriptive product such as
// surface water is a thresholded index with no model and no trained legend.
//
// Adding a value here needs no migration: the kind column was added by an ALTER
// with DEFAULT 'classification' and carries no CHECK constraint, and both
// readers select COALESCE(kind,'classification'), so a database written before
// a kind existed keeps working and rows of the new kind are simply new rows.
// What a new kind does require is that every reader branching on these literals
// gains its case, which is the failure the wind kind was added to avoid: filed
// under RunKindSolar a wind run listed as solar, printed the solar summary line
// and reopened as an empty solar card, with nothing raising an error.
const (
	RunKindClassification = "classification"
	RunKindWater          = "water"
	RunKindSolar          = "solar"
	// Wind screening. Its own kind rather than a product inside RunKindSolar:
	// it comes from a different product on a different grid, its capacity
	// factor is gross and unvalidated, and the solar readers would label it as
	// though it were neither.
	RunKindWind = "wind"
	// A HAND flood envelope: the extent per DEM product and the agreement
	// count raster that says where the products disagree. Its own kind for the
	// same reason wind has one -- it comes from DEM products rather than from a
	// reanalysis or a scene stack, it carries a raster the other descriptive
	// kinds do not, and a run filed under any of them would be listed and
	// reopened as that product.
	RunKindFlood = "flood"
)

// Project groups AOI, analyses, and overlay assets for an agronomist workflow.
type Project struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Name      string `json:"name"`
	Notes     string `json:"notes,omitempty"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	/*
		The ground the reader was last on in this project.

		A CURSOR, NOT A PROPERTY. It says where to resume, and a project whose
		last area has been deleted simply resumes nowhere -- DeleteArea clears
		it rather than leaving it pointing at a row that is gone.

		It replaces three columns that tried to give the project a geometry of
		its own: polygon_geojson, area_id and label. One shape per project
		cannot describe a reader working several fields, and it was written
		from whatever happened to be on the map, so a project holding a dozen
		grounds showed a single line naming one of them. Areas carry the shapes
		now, and this carries only which of them was open.
	*/
	LastAreaID string `json:"last_area_id,omitempty"`
	// How many grounds this project holds, beside the runs and compositions
	// under them. Counted by the listing query, so the hub can size a project
	// without loading its areas one card at a time.
	AreaCount    int `json:"area_count,omitempty"`
	RunCount     int `json:"run_count,omitempty"`
	OverlayCount int `json:"overlay_count,omitempty"`
}

// ProjectOverlay is a persisted composition (or similar) asset under a project.
type ProjectOverlay struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	/*
		The run this composition was made under, when there was one.

		Empty for a composition made with no run open -- browsing scenes needs
		no classification -- and for every row written before the column
		existed. Empty means "belongs to the project", not "belongs to no
		project", so readers scope those by the recorded extent instead.
	*/
	RunID      string `json:"run_id,omitempty"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	MetaJSON   string `json:"meta_json,omitempty"`
	PNGRelPath string `json:"png_relpath,omitempty"`
	TIFRelPath string `json:"tif_relpath,omitempty"`
	CreatedAt  string `json:"created_at"`
	// OverlayURI is hydrated for the UI (data URI); not stored in SQLite.
	OverlayURI string `json:"overlay_uri,omitempty"`
	// RasterTIF is an absolute path when a GeoTIFF exists on disk.
	RasterTIF string `json:"raster_tif,omitempty"`
}

// LocalUserID owns analyses saved when nobody is signed in.
const LocalUserID = "00000000-0000-0000-0000-000000000001"

/*
LocalUserEmail identifies the guest account.

Left at the old domain by the rename, deliberately. It is not an address and is
never shown; it is the key ensureLocalUser matches on. Changed, that lookup
finds nothing on an existing install and inserts a second local account, and
every run and project belonging to the first becomes unreachable -- a rename
that silently orphans a user's work, in exchange for a string nobody reads.
*/
const LocalUserEmail = "local@geosense.local"

// Store is the local SQLite-backed user database.
type Store struct {
	db      *sql.DB
	dataDir string
}

// legacyDirName is where the data lived when the application carried the name
// of the research repository it grew out of.
const legacyDirName = "geosense-infer"

// dataDirName is where it lives now.
const dataDirName = "terra"

/*
dbFileName is the database inside that directory.

Deliberately unchanged by the rename. Moving the directory is one operation
that either works or does not; also renaming the file inside it would add a
second, which has to be applied to a directory that may have been moved by the
step before, may have been restored from an archive written under either name,
or may be a fresh install. Every one of those is a case where getting it wrong
means opening an empty database beside a full one.

The file name is not something a user sees -- the directory is. So the rename
takes the visible half and leaves the half whose only effect would be more ways
to lose data.
*/
const dbFileName = "geosense.db"

/*
adoptLegacyDataDir moves a pre-rename data directory to the current name.

The directory holds every saved analysis, project and image. Renaming the
application without moving it would point a working installation at an empty
directory: nothing is deleted, but the user opens TERRA and finds none of their
work, which is indistinguishable from having lost it.

Moved, not copied. A copy leaves two directories that both look current, and
the next release has to guess which one the user has been adding to since.

Only when the new location does not exist. If both are present the new one
wins, untouched: that is either a restore, a fresh install beside an old one,
or a migration that already happened, and in none of those cases is silently
replacing the current data with older data the right answer.
*/
func adoptLegacyDataDir(cfg, dataDir string) error {
	if _, err := os.Stat(dataDir); err == nil {
		return nil // Already here.
	}
	legacy := filepath.Join(cfg, legacyDirName)
	info, err := os.Stat(legacy)
	if err != nil || !info.IsDir() {
		return nil // Nothing to adopt.
	}
	if err := os.Rename(legacy, dataDir); err != nil {
		return fmt.Errorf("moving %s to %s: %w", legacy, dataDir, err)
	}
	return nil
}

// Open creates (or opens) the app database under UserConfigDir/terra.
func Open() (*Store, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("user config dir: %w", err)
	}
	dataDir := filepath.Join(cfg, dataDirName)
	// Before the directory is created, or the rename below would find the
	// destination already occupied by an empty directory and decline.
	if err := adoptLegacyDataDir(cfg, dataDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}
	dbPath := filepath.Join(dataDir, dbFileName)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, dataDir: dataDir}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) DataDir() string { return s.dataDir }

func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

/*
schemaVersion is the shape this build expects, recorded in the database file as
PRAGMA user_version.

Raise it by one for each step added to migrate, and gate that step on the value
below it. The number says how far migrate has taken a database; it does not by
itself say which columns a table has, and addColumns explains why those two are
not the same question here.
*/
const schemaVersion = 5

// userVersion reads the version SQLite keeps in the database header.
func (s *Store) userVersion() (int, error) {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("read user_version: %w", err)
	}
	return v, nil
}

/*
setUserVersion records how far the steps in migrate have been applied.

Formatted into the statement because PRAGMA accepts no bound parameters. The
value is a constant declared in this file and never arrives from outside, so
there is nothing here to inject.
*/
func (s *Store) setUserVersion(v int) error {
	if _, err := s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, v)); err != nil {
		return fmt.Errorf("set user_version = %d: %w", v, err)
	}
	return nil
}

// columnAdd is one additive column: where it belongs, and the statement that
// puts it there.
type columnAdd struct {
	table  string
	column string
	stmt   string
}

/*
addColumns applies ADD COLUMN statements, skipping those whose column the table
already declares, and returning the error from any that should have succeeded.

The table is asked rather than the version trusted, because on every database
already in the field the two disagree. Idempotence used to come from discarding
the error -- `_, _ = s.db.Exec(stmt)` -- so those files carry every column these
steps add and still report user_version = 0. Driven by the version alone, the
first ALTER against one of them returns "duplicate column name" and Open fails:
the user's work intact on disk, behind a store that will not open it.

Reading the shape also leaves the version free to record what has been
considered rather than to stand as the only evidence of what exists, and leaves
a real failure -- a locked file, a missing table, a full disk -- to propagate
instead of being read as "already applied", which is what the discarded error
made indistinguishable.

Decided per column, not per step: a step interrupted partway leaves some of its
columns added and the rest not, and a step is re-entered whole.
*/
func (s *Store) addColumns(adds []columnAdd) error {
	for _, a := range adds {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(1) FROM pragma_table_info(?) WHERE name = ?`,
			a.table, a.column,
		).Scan(&n); err != nil {
			return fmt.Errorf("inspect %s: %w", a.table, err)
		}
		if n > 0 {
			continue
		}
		if _, err := s.db.Exec(a.stmt); err != nil {
			return fmt.Errorf("add %s.%s: %w", a.table, a.column, err)
		}
	}
	return nil
}

/*
dropColumn removes one column, and says nothing when there is none to remove.

The table is asked rather than the version trusted, for the reason addColumns
gives at length: databases in the field carry columns their recorded version
does not admit to, and the reverse holds too -- a file created fresh by this
build never had aoi_id, so the drop would fail on the only files that are
already correct.

Anything else propagates. A drop that fails for a real reason leaves a column
this build believes is gone, which is the disagreement the drop exists to end.
*/
func (s *Store) dropColumn(table, column string) error {
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info(?) WHERE name = ?`, table, column,
	).Scan(&n); err != nil {
		return fmt.Errorf("inspect %s: %w", table, err)
	}
	if n == 0 {
		return nil
	}
	// Identifiers cannot be bound; both arguments here are literals from this
	// file, never from a caller outside the package.
	if _, err := s.db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, column)); err != nil {
		return fmt.Errorf("drop %s.%s: %w", table, column, err)
	}
	return nil
}

/*
renameTable and renameColumn move a name that has changed, and say nothing when
there is nothing under the old one.

Asked of the schema rather than of the version, for the reason dropColumn and
addColumns both give: a file created fresh by this build already carries the new
names, so an unconditional rename would fail on exactly the files that are
already correct.

A FILE CAN HOLD BOTH, and it is not a hypothetical: every schema block here is
CREATE TABLE IF NOT EXISTS, so any build that ran those before the rename was
written left an empty `studios` beside a populated `whiteboards`. That happened
on this author's own database during the rename.

An EMPTY destination is dropped and the rename proceeds. It was made by a CREATE
and holds nothing, so there is nothing to weigh against the rows in the source;
refusing instead would leave the work unreachable behind a store that will not
open, which is worse than either name.

A destination with ROWS is refused. Two populated tables for one thing is a
question about which is the work, and this cannot answer it -- so it says which
pair is involved and stops, rather than picking one.
*/
func (s *Store) renameTable(from, to string) error {
	var have, want int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name = ?`, from,
	).Scan(&have); err != nil {
		return fmt.Errorf("inspect %s: %w", from, err)
	}
	if have == 0 {
		return nil
	}
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name = ?`, to,
	).Scan(&want); err != nil {
		return fmt.Errorf("inspect %s: %w", to, err)
	}
	if want > 0 {
		var rows int
		if err := s.db.QueryRow(
			fmt.Sprintf("SELECT COUNT(1) FROM %s", to),
		).Scan(&rows); err != nil {
			return fmt.Errorf("inspect %s rows: %w", to, err)
		}
		if rows > 0 {
			/*
				THE MIRROR CASE: an EMPTY SOURCE beside a populated destination.

				An older build opening a migrated database recreates the legacy
				table from its own schema, empty, and leaves it there. The next
				run of a current build then finds both names, refused to choose,
				and the store did not open at all -- so a rename that had
				already succeeded made the whole application unreachable, with
				every row still in place under the new name.

				There is nothing to weigh here. The source holds no work, so
				dropping it loses nothing and is the same judgement the empty
				DESTINATION already gets below. Only two populated tables are a
				question this cannot answer.
			*/
			var carried int
			if err := s.db.QueryRow(
				fmt.Sprintf("SELECT COUNT(1) FROM %s", from),
			).Scan(&carried); err != nil {
				return fmt.Errorf("inspect %s rows: %w", from, err)
			}
			if carried == 0 {
				if _, err := s.db.Exec("DROP TABLE " + from); err != nil {
					return fmt.Errorf("drop empty %s: %w", from, err)
				}
				return nil
			}
			return fmt.Errorf(
				"cannot rename %s to %s: both exist and %s holds %d row(s)", from, to, to, rows)
		}
		if _, err := s.db.Exec("DROP TABLE " + to); err != nil {
			return fmt.Errorf("drop empty %s: %w", to, err)
		}
	}
	// Identifiers cannot be bound; both arguments are literals from this file.
	if _, err := s.db.Exec(fmt.Sprintf("ALTER TABLE %s RENAME TO %s", from, to)); err != nil {
		return fmt.Errorf("rename %s to %s: %w", from, to, err)
	}
	return nil
}

func (s *Store) renameColumn(table, from, to string) error {
	var have, want int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info(?) WHERE name = ?`, table, from,
	).Scan(&have); err != nil {
		return fmt.Errorf("inspect %s: %w", table, err)
	}
	if have == 0 {
		return nil
	}
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM pragma_table_info(?) WHERE name = ?`, table, to,
	).Scan(&want); err != nil {
		return fmt.Errorf("inspect %s: %w", table, err)
	}
	if want > 0 {
		return fmt.Errorf("cannot rename %s.%s to %s: both exist", table, from, to)
	}
	if _, err := s.db.Exec(
		fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", table, from, to),
	); err != nil {
		return fmt.Errorf("rename %s.%s to %s: %w", table, from, to, err)
	}
	return nil
}

/*
discardPreAreaData empties the domain tables once, when a database written
before areas existed is opened by a build that has them.

THIS IS NOT A MIGRATION AND DOES NOT PRETEND TO BE. A run written before this
version names its ground through inference_runs.aoi_id, which pointed into a
JSON array in preferences and was validated by nothing; a project names one
ground of its own; a board names runs and no project. There is no rule that
turns those into a project holding areas holding runs without inventing which
area a run was of, and a wrong answer there is worse than an empty database,
because it reads as work rather than as absence.

What survives is the account: users, sessions and preferences. Losing a theme
and a window layout would be a second, unnecessary loss, and none of that is
domain data.

THE COPY IS TAKEN BEFORE THE FIRST DELETE, and the order is the whole safety
property. VACUUM INTO is the same mechanism the backup path already trusts, and
it cannot run inside a transaction -- which is also why the deletes come after
it rather than sharing one. The asset directories are moved aside rather than
removed, following the convention RestoreBackup uses for the same reason: the
way back from an irreversible step should be a rename, not a restore.

An ExportBackup archive was the alternative and is the wrong tool: it strips
password hashes and session tokens, which is right for a file a user mails
themselves and wrong for a rollback the application takes on its own, and it
re-compresses every asset when the assets are exactly what the renames keep.
*/
func (s *Store) discardPreAreaData() error {
	/*
		Nothing to discard is the common case, and it must cost nothing.

		Every fresh install reaches this step -- a database created a moment ago
		reports version 0 -- and so does every launch after a user has emptied
		their own work. Without this the first of those would leave a snapshot
		file and a runs.replaced-* directory beside a database that never held a
		row, which reads as damage where there was none.
	*/
	var rows int
	if err := s.db.QueryRow(
		`SELECT (SELECT COUNT(1) FROM inference_runs) + (SELECT COUNT(1) FROM projects)`,
	).Scan(&rows); err != nil {
		return fmt.Errorf("count what would be discarded: %w", err)
	}
	if rows == 0 {
		return nil
	}

	stamp := time.Now().UTC().Format("20060102-150405")

	snapshot := filepath.Join(s.dataDir, dbFileName+".replaced-"+stamp)
	if _, err := s.db.Exec(`VACUUM INTO ?`, snapshot); err != nil {
		return fmt.Errorf("copy the database before discarding it: %w", err)
	}

	// Moved, not deleted, and a failure here stops the discard: assets whose
	// rows are about to go are unreachable afterwards, so losing the move means
	// losing them for good.
	for _, dir := range []string{"runs", "projects"} {
		src := filepath.Join(s.dataDir, dir)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if err := os.Rename(src, src+".replaced-"+stamp); err != nil {
			return fmt.Errorf("set aside %s: %w", dir, err)
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Children first, so a failure part way leaves no row pointing at one that
	// is already gone.
	for _, stmt := range []string{
		`DELETE FROM studio_members`,
		`DELETE FROM studios`,
		`DELETE FROM project_overlays`,
		`DELETE FROM inference_runs`,
		`DELETE FROM areas`,
		`DELETE FROM projects`,
		// The catalogue that is becoming a table. Left in place it would keep
		// handing parsePreferenceExtras a list of areas that reference nothing.
		`UPDATE preferences SET extras_json =
		   COALESCE(json_remove(extras_json, '$.saved_aois', '$.active_aoi_id',
		                        '$.active_project_id', '$.aoi_label'), '{}')`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("discard pre-area data: %w", err)
		}
	}
	return tx.Commit()
}

/*
migrate brings the database up to schemaVersion.

The CREATE TABLE IF NOT EXISTS blocks run every time. Each states what it wants
and can be applied to any database, so a file that predates a whole table gains
it whatever its version says. Only the statements that cannot be repeated --
the ADD COLUMNs -- are gated on the version, and those check the table first.
*/
func (s *Store) migrate() error {
	at, err := s.userVersion()
	if err != nil {
		return err
	}
	/*
		THE NAME THIS THING IS CALLED. `whiteboard` became `studio`.

		FIRST, BEFORE ANY CREATE TABLE. The schema blocks below are
		`CREATE TABLE IF NOT EXISTS studios`, so running them against a file
		that still holds `whiteboards` would make an empty table beside the
		populated one -- and the rename would then fail with "both exist",
		correctly, having been made impossible a few lines earlier. Every
		reader would find the empty one.

		Not gated on the version, like the drops below and for the same reason:
		a number can be raised without the work, and a file that slipped through
		such a window is one no later gate reopens. The helpers ask the schema,
		so on a database already renamed this is three queries and nothing else.

		The index names go untouched. An index is not addressed by name from
		anywhere in this package, so renaming them would be churn with no
		reader; the CREATE INDEX IF NOT EXISTS statements below add the new
		names, and the old ones are dropped here so a file does not carry two
		indexes over one column.
	*/
	if err := s.renameTable("whiteboards", "studios"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.renameTable("whiteboard_members", "studio_members"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.renameColumn("studio_members", "whiteboard_id", "studio_id"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	for _, idx := range []string{
		"idx_whiteboards_user_updated",
		"idx_whiteboard_members_whiteboard",
		"idx_whiteboards_project",
	} {
		if _, err := s.db.Exec("DROP INDEX IF EXISTS " + idx); err != nil {
			return fmt.Errorf("migrate: drop index %s: %w", idx, err)
		}
	}
	schema := `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_model TEXT NOT NULL DEFAULT 'spectral',
  overlay_opacity REAL NOT NULL DEFAULT 0.75,
  theme TEXT NOT NULL DEFAULT 'dark',
  extras_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS inference_runs (
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
);
CREATE INDEX IF NOT EXISTS idx_runs_user_created ON inference_runs(user_id, created_at DESC);
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// Additive columns for full analysis persistence.
	if at < 1 {
		if err := s.addColumns([]columnAdd{
			{"inference_runs", "result_json",
				`ALTER TABLE inference_runs ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'`},
			{"inference_runs", "assets_relpath",
				`ALTER TABLE inference_runs ADD COLUMN assets_relpath TEXT`},
			{"inference_runs", "label",
				`ALTER TABLE inference_runs ADD COLUMN label TEXT NOT NULL DEFAULT ''`},
			{"inference_runs", "project_id",
				`ALTER TABLE inference_runs ADD COLUMN project_id TEXT`},
			// Distinguishes a classification from a descriptive product such as
			// surface water, which has no model and no trained legend. Existing
			// rows predate water and are all classifications.
			{"inference_runs", "kind",
				`ALTER TABLE inference_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'classification'`},
			/*
				The catalogued area a run belonged to, against the JSON-array
				catalogue that preceded the `areas` table.

				ADDED HERE AND DROPPED AT VERSION 4, which reads as pointless
				and is not: a database at version 0 has to pass through the
				statements of every version between, and version 2 wrote this
				column. Removing this line would leave the drop below with
				nothing to drop on exactly the files that need it most.
			*/
			{"inference_runs", "aoi_id",
				`ALTER TABLE inference_runs ADD COLUMN aoi_id TEXT NOT NULL DEFAULT ''`},
		}); err != nil {
			return fmt.Errorf("migrate runs: %w", err)
		}
	}
	projectSchema := `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  polygon_geojson TEXT NOT NULL DEFAULT '',
  area_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS project_overlays (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'composition',
  title TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL DEFAULT '{}',
  png_relpath TEXT,
  tif_relpath TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_overlays_project ON project_overlays(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_created ON inference_runs(project_id, created_at DESC);
`
	if _, err := s.db.Exec(projectSchema); err != nil {
		return fmt.Errorf("migrate projects: %w", err)
	}
	// After projects, because an area references one. Unconditional like its
	// neighbours; see areas.go for what the table is and why it exists.
	if _, err := s.db.Exec(areaSchema); err != nil {
		return fmt.Errorf("migrate areas: %w", err)
	}
	/*
		Which run a composition was made under.

		Compositions were scoped to the project alone, and a project accumulates
		runs across separate fields: one here held 57 runs and 13 compositions
		spread over three locations up to 100 km apart, all listed together
		whichever run was open. Applying one put a raster off the edge of the
		area being looked at.

		Nullable, and it will stay nullable: a composition can be made with no
		run open at all -- browsing scenes on the map needs no classification --
		and those belong to the project rather than to any run. Rows written
		before this column exists are in the same position, and readers fall
		back to comparing the recorded extent against the current area.
	*/
	if at < 2 {
		if err := s.addColumns([]columnAdd{
			{"project_overlays", "run_id",
				`ALTER TABLE project_overlays ADD COLUMN run_id TEXT`},
		}); err != nil {
			return fmt.Errorf("migrate overlay run link: %w", err)
		}
		if _, err := s.db.Exec(
			`CREATE INDEX IF NOT EXISTS idx_project_overlays_run ON project_overlays(run_id)`,
		); err != nil {
			return fmt.Errorf("migrate overlay run index: %w", err)
		}
	}
	if _, err := s.db.Exec(studioSchema); err != nil {
		return fmt.Errorf("migrate studios: %w", err)
	}
	/*
		Ownership becomes a chain: a project holds areas, an area holds runs, and
		a board is the runs of one project arranged.

		The discard comes FIRST, and not only for safety. These columns are added
		NOT NULL DEFAULT '' because SQLite refuses ADD COLUMN NOT NULL without a
		default; the empty string is then unreachable only because no row that
		could carry it survives the line above. Written the other way round, every
		pre-existing run would report itself as belonging to an area with no id.

		This block ALTERs studios, so it sits after the CREATE that
		guarantees the table -- the same order the gated blocks above keep.
	*/
	if at < 3 {
		if err := s.discardPreAreaData(); err != nil {
			return fmt.Errorf("migrate to areas: %w", err)
		}
		if err := s.addColumns([]columnAdd{
			{"inference_runs", "area_id",
				`ALTER TABLE inference_runs ADD COLUMN area_id TEXT NOT NULL DEFAULT ''`},
			{"project_overlays", "area_id",
				`ALTER TABLE project_overlays ADD COLUMN area_id TEXT NOT NULL DEFAULT ''`},
			{"studios", "project_id",
				`ALTER TABLE studios ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`},
			// Which ground the reader was last on in this project. Per-project
			// state, so it belongs on the project rather than growing the
			// preferences blob this change exists to shrink.
			{"projects", "last_area_id",
				`ALTER TABLE projects ADD COLUMN last_area_id TEXT NOT NULL DEFAULT ''`},
		}); err != nil {
			return fmt.Errorf("migrate area links: %w", err)
		}
		for _, stmt := range []string{
			`CREATE INDEX IF NOT EXISTS idx_runs_area_created ON inference_runs(area_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_project_overlays_area ON project_overlays(area_id)`,
			`CREATE INDEX IF NOT EXISTS idx_studios_project ON studios(project_id, updated_at DESC)`,
		} {
			if _, err := s.db.Exec(stmt); err != nil {
				return fmt.Errorf("migrate area indexes: %w", err)
			}
		}
	}
	/*
		THE COLUMNS THIS BUILD HAS REMOVED. Not gated on the version, and that
		is the point.

		WHAT GATING THEM COST, observed rather than imagined. `schemaVersion`
		was raised to 5 in one edit and the drop it stood for written in the
		next; a dev build compiled in between, opened the database, found
		at = 4 < 5, had no step to run, and recorded 5. The gate then closed
		over three columns that had never been dropped and could never be
		dropped again -- the file said the work was done and nothing would
		reconsider it. That is not a mistake in the drops. It is what a gate on
		a number does when the number can be raised without the work.

		addColumns already argues this for the other direction: "the table is
		asked rather than the version trusted, because on every database
		already in the field the two disagree." dropColumn asks the table too,
		so running these every time is a handful of pragma_table_info queries
		at Open and a file that ends in the shape this build believes it has,
		whatever its version says.

		WHAT EACH DROP IS FOR:

		inference_runs.aoi_id named an entry in the JSON-array catalogue that
		preceded the `areas` table. area_id replaced it.

		projects.polygon_geojson, .area_id and .label gave a project a geometry
		of its own, written from whatever was on the map while it was open and
		read back as the project's "AOI" -- one shape for a workspace holding
		as many grounds as a reader draws. last_area_id replaced all three with
		the only question they were still answering: which ground to resume on.

		Dropped rather than left unwritten, because a column nothing writes
		always reads its default and will disagree with the table one day --
		the same argument areas.go makes for having no position column. SQLite
		has dropped columns since 3.35 and refuses on an indexed one; none of
		these four is indexed. The failure is not swallowed: a build that
		believes a column is gone while it is still there is exactly the
		disagreement being removed.
	*/
	for _, c := range []struct{ table, column string }{
		{"inference_runs", "aoi_id"},
		{"projects", "polygon_geojson"},
		{"projects", "area_id"},
		{"projects", "label"},
	} {
		if err := s.dropColumn(c.table, c.column); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	/*
		Written last, so a failure anywhere above leaves the version where it
		was and the next Open retries the same steps.

		Only ever raised. A file opened by a newer build carries that build's
		number and the steps that go with it; writing this build's number over
		it would erase the record of work this build knows nothing about.
	*/
	if at < schemaVersion {
		if err := s.setUserVersion(schemaVersion); err != nil {
			return err
		}
	}
	if err := s.ensureLocalUser(); err != nil {
		return err
	}
	if err := s.repairStudioViews(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureLocalUser() error {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM users WHERE id = ?`, LocalUserID).Scan(&n)
	if n > 0 {
		return nil
	}
	ts := nowISO()
	hash, err := bcrypt.GenerateFromPassword([]byte(uuid.NewString()), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at, updated_at)
		 VALUES (?, ?, 'Local', ?, ?, ?)`,
		LocalUserID, LocalUserEmail, string(hash), ts, ts,
	)
	return err
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func normalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

/*
isUniqueViolation reports whether SQLite refused the row for a UNIQUE
constraint.

This used to look for "unique" inside the driver's message text. That sentence
is the driver's own wording, not part of any contract, so a rewrite of it in
some patch release would have turned a duplicate registration into a raw driver
error shown in the sign-up form, with nothing failing to say so. The result code
is the part SQLite itself defines.

The extended code, not the SQLITE_CONSTRAINT class that covers every constraint
at once: the driver turns extended result codes on when it opens a connection,
and a collision on users.id would arrive as SQLITE_CONSTRAINT_PRIMARYKEY -- a
generated UUID that already exists, which is a different fault and must not be
reported to the user as a taken email.
*/
func isUniqueViolation(err error) bool {
	var serr *sqlite.Error
	return errors.As(err, &serr) && serr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// Register creates a user and default preferences; returns the user + session token.
func (s *Store) Register(email, password, displayName string) (*User, string, error) {
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if email == "" || len(password) < 6 || displayName == "" {
		return nil, "", ErrInvalidInput
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}
	id := uuid.NewString()
	ts := nowISO()
	_, err = s.db.Exec(
		`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, email, displayName, string(hash), ts, ts,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, "", ErrEmailTaken
		}
		return nil, "", err
	}
	_, _ = s.db.Exec(
		`INSERT INTO preferences (user_id, default_model, overlay_opacity, theme, extras_json)
		 VALUES (?, 'spectral', 0.75, 'dark', '{}')`,
		id,
	)
	token, err := s.createSession(id)
	if err != nil {
		return nil, "", err
	}
	u := &User{ID: id, Email: email, DisplayName: displayName, CreatedAt: ts, UpdatedAt: ts}
	s.hydrateAvatarURI(u)
	if err := s.writeSessionFile(token); err != nil {
		return u, token, nil // user created; session file is best-effort
	}
	return u, token, nil
}

// Login validates credentials and returns user + session token.
func (s *Store) Login(email, password string) (*User, string, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return nil, "", ErrInvalidInput
	}
	var (
		u    User
		hash string
	)
	err := s.db.QueryRow(
		`SELECT id, email, display_name, COALESCE(avatar_path,''), password_hash, created_at, updated_at
		 FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarPath, &hash, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrInvalidCreds
	}
	if err != nil {
		return nil, "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, "", ErrInvalidCreds
	}
	token, err := s.createSession(u.ID)
	if err != nil {
		return nil, "", err
	}
	_ = s.writeSessionFile(token)
	s.hydrateAvatarURI(&u)
	return &u, token, nil
}

func (s *Store) createSession(userID string) (string, error) {
	token := uuid.NewString()
	exp := time.Now().UTC().Add(sessionTTL).Format(time.RFC3339)
	_, err := s.db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, exp,
	)
	return token, err
}

func (s *Store) sessionFilePath() string {
	return filepath.Join(s.dataDir, "session.token")
}

func (s *Store) writeSessionFile(token string) error {
	return os.WriteFile(s.sessionFilePath(), []byte(token), 0o600)
}

func (s *Store) clearSessionFile() {
	_ = os.Remove(s.sessionFilePath())
}

// Logout invalidates the given session token (or the on-disk token if empty).
func (s *Store) Logout(token string) error {
	if token == "" {
		b, err := os.ReadFile(s.sessionFilePath())
		if err == nil {
			token = strings.TrimSpace(string(b))
		}
	}
	if token != "" {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	}
	s.clearSessionFile()
	return nil
}

// UserFromSession resolves a session token to a user.
func (s *Store) UserFromSession(token string) (*User, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}
	var (
		u       User
		expires string
	)
	err := s.db.QueryRow(
		`SELECT u.id, u.email, u.display_name, COALESCE(u.avatar_path,''), u.created_at, u.updated_at, s.expires_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token = ?`, token,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarPath, &u.CreatedAt, &u.UpdatedAt, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	exp, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().UTC().After(exp) {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
		return nil, ErrUnauthorized
	}
	s.hydrateAvatarURI(&u)
	return &u, nil
}

// RestoreSession reads the on-disk token and returns the user if still valid.
func (s *Store) RestoreSession() (*User, string, error) {
	b, err := os.ReadFile(s.sessionFilePath())
	if err != nil {
		return nil, "", ErrUnauthorized
	}
	token := strings.TrimSpace(string(b))
	u, err := s.UserFromSession(token)
	if err != nil {
		s.clearSessionFile()
		return nil, "", err
	}
	return u, token, nil
}

// UpdateProfile updates the display name only (avatar via SetAvatar/ClearAvatar).
func (s *Store) UpdateProfile(userID, displayName string) (*User, error) {
	displayName = strings.TrimSpace(displayName)
	if userID == "" || displayName == "" {
		return nil, ErrInvalidInput
	}
	ts := nowISO()
	_, err := s.db.Exec(
		`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`,
		displayName, ts, userID,
	)
	if err != nil {
		return nil, err
	}
	return s.GetUser(userID)
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func (s *Store) avatarDir() string {
	return filepath.Join(s.dataDir, "avatars")
}

func (s *Store) hydrateAvatarURI(u *User) {
	if u == nil || u.AvatarPath == "" {
		return
	}
	path := u.AvatarPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(s.dataDir, path)
	}
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return
	}
	mime := "image/jpeg"
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		mime = "image/png"
	case ".webp":
		mime = "image/webp"
	case ".gif":
		mime = "image/gif"
	}
	u.AvatarURI = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b)
}

// SetAvatarFromDataURI saves a profile photo from a browser data URI.
func (s *Store) SetAvatarFromDataURI(userID, dataURI string) (*User, error) {
	if userID == "" || !strings.HasPrefix(dataURI, "data:image/") {
		return nil, ErrInvalidInput
	}
	comma := strings.Index(dataURI, ",")
	if comma < 0 {
		return nil, ErrInvalidInput
	}
	meta := dataURI[5:comma] // image/png;base64
	payload := dataURI[comma+1:]
	if !strings.Contains(meta, "base64") {
		return nil, ErrInvalidInput
	}
	mime := strings.Split(meta, ";")[0]
	// Declared without a value on purpose. Every arm below either assigns one
	// or returns, so an initialiser here would be a default that can never be
	// read -- and one that reads as the fallback for an unrecognised type,
	// which is the opposite of what the default arm does.
	var ext string
	switch mime {
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	case "image/jpeg", "image/jpg":
		ext = ".jpg"
	default:
		return nil, ErrInvalidInput
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, ErrInvalidInput
	}
	// Cap at ~2.5 MiB decoded.
	if len(raw) == 0 || len(raw) > 2_500_000 {
		return nil, ErrInvalidInput
	}
	if err := os.MkdirAll(s.avatarDir(), 0o700); err != nil {
		return nil, err
	}
	rel := filepath.Join("avatars", userID+ext)
	abs := filepath.Join(s.dataDir, rel)
	// Remove previous avatar files for this user (any extension).
	if matches, _ := filepath.Glob(filepath.Join(s.avatarDir(), userID+".*")); len(matches) > 0 {
		for _, m := range matches {
			_ = os.Remove(m)
		}
	}
	if err := os.WriteFile(abs, raw, 0o600); err != nil {
		return nil, err
	}
	ts := nowISO()
	_, err = s.db.Exec(
		`UPDATE users SET avatar_path = ?, updated_at = ? WHERE id = ?`,
		rel, ts, userID,
	)
	if err != nil {
		return nil, err
	}
	return s.GetUser(userID)
}

// ClearAvatar removes the profile photo.
func (s *Store) ClearAvatar(userID string) (*User, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	u, err := s.GetUser(userID)
	if err != nil {
		return nil, err
	}
	if u.AvatarPath != "" {
		path := u.AvatarPath
		if !filepath.IsAbs(path) {
			path = filepath.Join(s.dataDir, path)
		}
		_ = os.Remove(path)
	}
	if matches, _ := filepath.Glob(filepath.Join(s.avatarDir(), userID+".*")); len(matches) > 0 {
		for _, m := range matches {
			_ = os.Remove(m)
		}
	}
	ts := nowISO()
	_, err = s.db.Exec(
		`UPDATE users SET avatar_path = NULL, updated_at = ? WHERE id = ?`,
		ts, userID,
	)
	if err != nil {
		return nil, err
	}
	return s.GetUser(userID)
}

func (s *Store) GetUser(id string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, email, display_name, COALESCE(avatar_path,''), created_at, updated_at
		 FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarPath, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.hydrateAvatarURI(&u)
	return &u, nil
}

func (s *Store) GetPreferences(userID string) (*Preferences, error) {
	var p Preferences
	err := s.db.QueryRow(
		`SELECT user_id, default_model, overlay_opacity, theme, extras_json
		 FROM preferences WHERE user_id = ?`, userID,
	).Scan(&p.UserID, &p.DefaultModel, &p.OverlayOpacity, &p.Theme, &p.ExtrasJSON)
	if errors.Is(err, sql.ErrNoRows) {
		p = Preferences{
			UserID: userID, DefaultModel: "spectral", OverlayOpacity: 0.75,
			Theme: "dark", ExtrasJSON: "{}",
		}
		_, _ = s.db.Exec(
			`INSERT INTO preferences (user_id, default_model, overlay_opacity, theme, extras_json)
			 VALUES (?, ?, ?, ?, ?)`,
			p.UserID, p.DefaultModel, p.OverlayOpacity, p.Theme, p.ExtrasJSON,
		)
		return &p, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) SavePreferences(p Preferences) error {
	if p.UserID == "" {
		return ErrInvalidInput
	}
	if p.DefaultModel == "" {
		p.DefaultModel = "spectral"
	}
	if p.Theme == "" {
		p.Theme = "dark"
	}
	if p.ExtrasJSON == "" {
		p.ExtrasJSON = "{}"
	}
	if p.OverlayOpacity <= 0 || p.OverlayOpacity > 1 {
		p.OverlayOpacity = 0.75
	}
	_, err := s.db.Exec(
		`INSERT INTO preferences (user_id, default_model, overlay_opacity, theme, extras_json)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   default_model = excluded.default_model,
		   overlay_opacity = excluded.overlay_opacity,
		   theme = excluded.theme,
		   extras_json = excluded.extras_json`,
		p.UserID, p.DefaultModel, p.OverlayOpacity, p.Theme, p.ExtrasJSON,
	)
	return err
}

// SaveRun inserts an inference run for the user.
func (s *Store) SaveRun(run InferenceRun) (*InferenceRun, error) {
	if run.UserID == "" {
		return nil, ErrInvalidInput
	}
	if run.ID == "" {
		run.ID = uuid.NewString()
	}
	if run.CreatedAt == "" {
		run.CreatedAt = nowISO()
	}
	if run.Status == "" {
		run.Status = "ok"
	}
	if run.SummaryJSON == "" {
		run.SummaryJSON = "{}"
	}
	if !json.Valid([]byte(run.SummaryJSON)) {
		run.SummaryJSON = "{}"
	}
	if run.ResultJSON == "" {
		run.ResultJSON = "{}"
	}
	if !json.Valid([]byte(run.ResultJSON)) {
		run.ResultJSON = "{}"
	}
	if run.Kind == "" {
		run.Kind = RunKindClassification
	}
	_, err := s.db.Exec(
		`INSERT INTO inference_runs
		 (id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson, status,
		  summary_json, overlay_relpath, n_dates, result_json, assets_relpath, label, project_id,
		  kind, area_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.UserID, run.CreatedAt, run.ModelKind, run.PeriodStart, run.PeriodEnd,
		run.PolygonGeoJSON, run.Status, run.SummaryJSON, nullIfEmpty(run.OverlayRelPath), run.NDates,
		run.ResultJSON, nullIfEmpty(run.AssetsRelPath), run.Label, nullIfEmpty(run.ProjectID),
		run.Kind, run.AreaID,
	)
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (s *Store) ListRuns(userID string, limit int) ([]InferenceRun, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.Query(
		`SELECT id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
		        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
		        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
		        COALESCE(project_id,''), COALESCE(kind,'classification'),
		        COALESCE(area_id,'')
		 FROM inference_runs WHERE user_id = ?
		 ORDER BY created_at DESC LIMIT ?`,
		userID, limit,
	)
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
			&r.ResultJSON, &r.AssetsRelPath, &r.Label, &r.ProjectID, &r.Kind, &r.AreaID,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ActivityDay is one calendar day with the number of runs made on it.
type ActivityDay struct {
	// Local calendar date, YYYY-MM-DD.
	Day   string `json:"day"`
	Count int    `json:"count"`
}

// RunActivity counts runs per day over a trailing window.
//
// Counted here rather than derived from ListRuns, which caps at 100 rows and
// carries result_json on every one of them. A year of activity read that way
// would be both truncated -- showing empty weeks that are not empty -- and
// wasteful, since the caller needs a number per day and not the runs.
//
// created_at is written as RFC3339 in UTC, and localtime converts it to the
// day the user actually worked; grouped in UTC, an evening run west of
// Greenwich lands on tomorrow's square.
func (s *Store) RunActivity(userID string, days int) ([]ActivityDay, error) {
	if userID == "" {
		userID = LocalUserID
	}
	if days <= 0 || days > 1100 {
		days = 366
	}
	rows, err := s.db.Query(
		`SELECT date(created_at, 'localtime') AS d, COUNT(*)
		 FROM inference_runs
		 WHERE user_id = ?
		   AND date(created_at, 'localtime') >= date('now', 'localtime', ?)
		 GROUP BY d
		 ORDER BY d`,
		userID, fmt.Sprintf("-%d days", days),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Never nil: a user with no runs marshals to [] rather than null, so the
	// caller renders an empty year instead of failing on a missing list.
	out := []ActivityDay{}
	for rows.Next() {
		var a ActivityDay
		if err := rows.Scan(&a.Day, &a.Count); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) GetRun(userID, runID string) (*InferenceRun, error) {
	if userID == "" {
		userID = LocalUserID
	}
	var r InferenceRun
	err := s.db.QueryRow(
		`SELECT id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson,
		        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
		        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
		        COALESCE(project_id,''), COALESCE(kind,'classification'),
		        COALESCE(area_id,'')
		 FROM inference_runs WHERE id = ? AND user_id = ?`,
		runID, userID,
	).Scan(
		&r.ID, &r.UserID, &r.CreatedAt, &r.ModelKind, &r.PeriodStart, &r.PeriodEnd,
		&r.PolygonGeoJSON, &r.Status, &r.SummaryJSON, &r.OverlayRelPath, &r.NDates,
		&r.ResultJSON, &r.AssetsRelPath, &r.Label, &r.ProjectID, &r.Kind, &r.AreaID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) RunsDir(runID string) string {
	return filepath.Join(s.dataDir, "runs", runID)
}

// DeleteRun removes a run row and its on-disk assets.
func (s *Store) DeleteRun(userID, runID string) error {
	if userID == "" {
		userID = LocalUserID
	}
	if strings.TrimSpace(runID) == "" {
		return ErrInvalidInput
	}
	run, err := s.GetRun(userID, runID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(`DELETE FROM inference_runs WHERE id = ? AND user_id = ?`, runID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	/*
		The references this row leaves behind, which it used to leave dangling.

		A board member naming a deleted run survived as a row pointing at
		nothing. GetStudio compensates -- it LEFT JOINs and reports the gap
		as Missing -- and that reporting stays, because a board saved with a run
		that is later deleted genuinely has a gap and a reader should be told.
		What does not need to stay is the row: the member is removed here, so the
		gap is reported once, on the board that was saved with it, rather than
		accumulating in a table nothing prunes.

		An overlay's run_id is CLEARED rather than the overlay deleted. The
		composition is still a real raster of real ground; what it loses is the
		run it was made under, and its own comment already defines empty as
		"belongs to the project" rather than "belongs to nothing".
	*/
	if _, err := tx.Exec(`DELETE FROM studio_members WHERE run_id = ?`, runID); err != nil {
		return err
	}
	/*
		AND THE ARRANGEMENT ITSELF, which the member row is only half of.

		A studio keeps what it looks like in `view_json`, and that field names
		its runs too. Removing the member and leaving the blob produced the one
		state the Missing flag above cannot report: the row that would have
		carried the flag is the row that was just deleted, so the studio opens
		with a run's worth of arrangement pointing at nothing and says nothing
		about it. See dropRunsFromViews.
	*/
	if _, err := dropRunsFromViews(tx, userID, map[string]bool{runID: true}); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE project_overlays SET run_id = NULL WHERE run_id = ?`, runID,
	); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = os.RemoveAll(s.RunsDir(runID))
	if run.ProjectID != "" {
		s.TouchProject(run.ProjectID)
	}
	return nil
}

// WriteDataURIFile decodes a data URI (or copies a filesystem path) into dest.
func WriteDataURIFile(src, dest string) error {
	if strings.TrimSpace(src) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	if strings.HasPrefix(src, "data:") {
		idx := strings.Index(src, ",")
		if idx < 0 {
			return fmt.Errorf("invalid data uri")
		}
		raw, err := base64.StdEncoding.DecodeString(src[idx+1:])
		if err != nil {
			return err
		}
		return os.WriteFile(dest, raw, 0o600)
	}
	// Treat as filesystem path.
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, in, 0o600)
}

// ReadFileDataURI reads a file and returns a PNG/TIFF-agnostic data URI (image/png default).
func ReadFileDataURI(path, mime string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if mime == "" {
		mime = "image/png"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
