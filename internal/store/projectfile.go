package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

/*
A project as a file of its own: `name.terra`, and beside it `name.terra-data`.

The database stays the working copy. Every run, area and studio is written
there the moment it exists, as it always was, and nothing here changes that.
The file is the project's document: what a reader saves, carries to another
machine, attaches to a message and opens again. Saving writes the project out
of the database; opening reads one into it.

TWO THINGS ON DISK, AS SOLARA KEEPS ITS PROJECTS. The document is JSON and
small -- the rows -- and is rewritten whole on every save. The rasters a run
produced are megabytes each and never change once written, so they go into
the data folder beside the document and are copied only when they are not
there yet. A single archive would be one file to carry, and would rewrite
every raster of every run on every save.

OPENING IS AN IMPORT, AND NEVER DESTRUCTIVE. Rows keep their ids, so opening a
file saved from this machine, or the same file twice, updates what is there
rather than making a copy of it. What the file holds replaces the same rows
here; what is here and not in the file is left alone -- opening a document is
not a way to delete work.

WHAT IS LEFT OUT: user ids, which belong to whoever opens the file, and every
other project. Credentials were never anywhere near a project.
*/

const (
	// ProjectFileExt is the extension a project file carries.
	ProjectFileExt = ".terra"
	// ProjectFileFormat names the document, so a JSON file that is something
	// else is refused by name rather than half read.
	ProjectFileFormat = "terra-project"

	projectFileVersion = 1
	projectDataSuffix  = ".terra-data"
	/*
		Solara shares the extension -- it is the energy half of the same
		studio -- and writes this format. Named so that opening one says what
		it is, rather than that the file is not a project.
	*/
	solaraProjectFormat = "terra-energy-project"
	// The document holds rows, not rasters; past this it is not one.
	maxProjectFileBytes = 256 << 20
)

var (
	// ErrNotAProjectFile is a file that is not a TERRA project document.
	ErrNotAProjectFile = errors.New("not a TERRA project file")
	// ErrProjectFileNewer is a document from a later format than this build reads.
	ErrProjectFileNewer = errors.New("written by a newer TERRA")
	// ErrProjectOwnedElsewhere is a project whose rows belong to another account here.
	ErrProjectOwnedElsewhere = errors.New("the project belongs to another account on this machine")
)

// ProjectDocument is a project as its file holds it.
type ProjectDocument struct {
	Format     string           `json:"format"`
	Version    int              `json:"version"`
	AppVersion string           `json:"app_version"`
	SavedAt    string           `json:"saved_at"`
	Project    Project          `json:"project"`
	Areas      []Area           `json:"areas"`
	Runs       []InferenceRun   `json:"runs"`
	Overlays   []ProjectOverlay `json:"overlays"`
	Studios    []Studio         `json:"studios"`
}

// ProjectFileSummary is what a save or an open did, for the interface to say.
type ProjectFileSummary struct {
	Path        string `json:"path"`
	ProjectID   string `json:"project_id"`
	ProjectName string `json:"project_name"`
	Areas       int    `json:"areas"`
	Runs        int    `json:"runs"`
	Overlays    int    `json:"overlays"`
	Studios     int    `json:"studios"`
	/*
		Files the rows name that were not found to copy: on save, missing from
		this machine's data; on open, missing from the data folder beside the
		document. The rows still go through -- a run whose rasters are gone is
		still a record of what was run -- and the count says so.
	*/
	MissingAssets int `json:"missing_assets"`
}

// ProjectFilePath is path with the project extension, added unless present in
// any case: a file named Site.TERRA is not renamed Site.TERRA.terra.
func ProjectFilePath(path string) string {
	if strings.EqualFold(filepath.Ext(path), ProjectFileExt) {
		return path
	}
	return path + ProjectFileExt
}

// projectDataDir is the data folder of the project file at path.
func projectDataDir(path string) string {
	return strings.TrimSuffix(path, filepath.Ext(path)) + projectDataSuffix
}

// The directories of the data directory a project's files live in: a run's
// folder, and a project's compositions. Nothing else is ever copied.
var projectAssetRoots = map[string]bool{"runs": true, "projects": true}

/*
projectAssetPath checks a path a row names and returns it in this system's form.

The document is a file anyone can hand over, and the paths in it are joined to
the data directory: one that climbs out of it, or names the database, would
make opening a project a way to write anywhere. Only a path inside runs/ or
projects/ is accepted.
*/
func projectAssetPath(rel string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(rel)))
	root := strings.SplitN(filepath.ToSlash(clean), "/", 2)[0]
	if !filepath.IsLocal(clean) || !projectAssetRoots[root] || clean == root {
		return "", fmt.Errorf("%w: it names a file outside a project, %q", ErrNotAProjectFile, rel)
	}
	return clean, nil
}

/*
assetPaths lists the files and folders the document's rows name, each once.

A run names its folder and, inside it, its overlay; the folder carries the
overlay, so a path inside a listed folder is dropped rather than copied twice.
*/
func (d *ProjectDocument) assetPaths() ([]string, error) {
	var all []string
	seen := map[string]bool{}
	add := func(rel string) error {
		if strings.TrimSpace(rel) == "" {
			return nil
		}
		p, err := projectAssetPath(rel)
		if err != nil {
			return err
		}
		if !seen[p] {
			seen[p] = true
			all = append(all, p)
		}
		return nil
	}
	for _, r := range d.Runs {
		if err := add(r.AssetsRelPath); err != nil {
			return nil, err
		}
		if err := add(r.OverlayRelPath); err != nil {
			return nil, err
		}
	}
	for _, o := range d.Overlays {
		if err := add(o.PNGRelPath); err != nil {
			return nil, err
		}
		if err := add(o.TIFRelPath); err != nil {
			return nil, err
		}
	}
	out := all[:0:0]
	for _, p := range all {
		if !insideAny(p, all) {
			out = append(out, p)
		}
	}
	return out, nil
}

// insideAny reports whether p lies inside another path of the list.
func insideAny(p string, list []string) bool {
	for _, q := range list {
		if q != p && strings.HasPrefix(p, q+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (d *ProjectDocument) summary(path string) *ProjectFileSummary {
	return &ProjectFileSummary{
		Path:        path,
		ProjectID:   d.Project.ID,
		ProjectName: d.Project.Name,
		Areas:       len(d.Areas),
		Runs:        len(d.Runs),
		Overlays:    len(d.Overlays),
		Studios:     len(d.Studios),
	}
}

// ---- Saving ------------------------------------------------------------------

/*
SaveProjectFile writes one of the user's projects to path and its files beside it.

The order is chosen so that a failure part way leaves a usable project: the
files the rows name are copied first, then the document is replaced in one
rename, and only after that are the files the new document no longer names
removed. A copy that fails leaves the previous document standing; a removal
that fails leaves a file too many, never one too few.
*/
func (s *Store) SaveProjectFile(userID, projectID, path, appVersion string) (*ProjectFileSummary, error) {
	path = ProjectFilePath(path)
	doc, err := s.projectDocument(userID, projectID, appVersion)
	if err != nil {
		return nil, err
	}
	assets, err := doc.assetPaths()
	if err != nil {
		return nil, err
	}
	data := projectDataDir(path)
	sum := doc.summary(path)
	for _, rel := range assets {
		/*
			Present means current: a run's folder and a composition's files are
			written once, when they are made, and never again. So a save after
			the first copies only what is new, which is what keeps it fast.
		*/
		dst := filepath.Join(data, rel)
		if exists(dst) {
			continue
		}
		src := filepath.Join(s.dataDir, rel)
		if !exists(src) {
			sum.MissingAssets++
			continue
		}
		if err := copyPathStaged(src, dst); err != nil {
			return nil, fmt.Errorf("copying %s into the project: %w", rel, err)
		}
	}
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(path, append(raw, '\n')); err != nil {
		return nil, fmt.Errorf("writing the project file: %w", err)
	}
	if err := pruneProjectData(data, assets); err != nil {
		return nil, fmt.Errorf("tidying the project's data folder: %w", err)
	}
	return sum, nil
}

// projectDocument reads one project, and everything filed under it, out of the database.
func (s *Store) projectDocument(userID, projectID, appVersion string) (*ProjectDocument, error) {
	if userID == "" {
		userID = LocalUserID
	}
	d := &ProjectDocument{
		Format:     ProjectFileFormat,
		Version:    projectFileVersion,
		AppVersion: appVersion,
		SavedAt:    nowISO(),
		Areas:      []Area{},
		Runs:       []InferenceRun{},
		Overlays:   []ProjectOverlay{},
		Studios:    []Studio{},
	}
	p := &d.Project
	err := s.db.QueryRow(
		`SELECT id, name, COALESCE(notes,''), created_at, updated_at, COALESCE(last_area_id,'')
		 FROM projects WHERE id = ? AND user_id = ?`,
		projectID, userID,
	).Scan(&p.ID, &p.Name, &p.Notes, &p.CreatedAt, &p.UpdatedAt, &p.LastAreaID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	/*
		Each list is read to the end and closed before the next query: the
		store runs on one connection, and a second query issued while a result
		set is still open waits for it forever.
	*/
	err = s.eachRow(
		`SELECT id, name, polygon_geojson, COALESCE(notes,''), created_at, updated_at
		 FROM areas WHERE project_id = ? AND user_id = ? ORDER BY created_at, id`,
		[]any{p.ID, userID},
		func(rows *sql.Rows) error {
			a := Area{ProjectID: p.ID}
			if err := rows.Scan(&a.ID, &a.Name, &a.PolygonGeoJSON, &a.Notes, &a.CreatedAt, &a.UpdatedAt); err != nil {
				return err
			}
			d.Areas = append(d.Areas, a)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	err = s.eachRow(
		`SELECT id, created_at, model_kind, period_start, period_end, polygon_geojson,
		        status, summary_json, COALESCE(overlay_relpath,''), n_dates,
		        COALESCE(result_json,'{}'), COALESCE(assets_relpath,''), COALESCE(label,''),
		        COALESCE(kind,'classification'), COALESCE(area_id,'')
		 FROM inference_runs WHERE project_id = ? AND user_id = ? ORDER BY created_at, id`,
		[]any{p.ID, userID},
		func(rows *sql.Rows) error {
			r := InferenceRun{ProjectID: p.ID}
			if err := rows.Scan(
				&r.ID, &r.CreatedAt, &r.ModelKind, &r.PeriodStart, &r.PeriodEnd, &r.PolygonGeoJSON,
				&r.Status, &r.SummaryJSON, &r.OverlayRelPath, &r.NDates,
				&r.ResultJSON, &r.AssetsRelPath, &r.Label, &r.Kind, &r.AreaID,
			); err != nil {
				return err
			}
			d.Runs = append(d.Runs, r)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	err = s.eachRow(
		`SELECT id, COALESCE(run_id,''), COALESCE(area_id,''), kind, title, meta_json,
		        COALESCE(png_relpath,''), COALESCE(tif_relpath,''), created_at
		 FROM project_overlays WHERE project_id = ? ORDER BY created_at, id`,
		[]any{p.ID},
		func(rows *sql.Rows) error {
			o := ProjectOverlay{ProjectID: p.ID}
			if err := rows.Scan(
				&o.ID, &o.RunID, &o.AreaID, &o.Kind, &o.Title, &o.MetaJSON,
				&o.PNGRelPath, &o.TIFRelPath, &o.CreatedAt,
			); err != nil {
				return err
			}
			d.Overlays = append(d.Overlays, o)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	/*
		Only the boards filed under this project. A board saved before boards
		had projects is listed with every project in the menu, so that it is not
		lost, but it belongs to none of them and goes into no file.
	*/
	err = s.eachRow(
		`SELECT id, name, created_at, updated_at, COALESCE(view_json,'{}')
		 FROM studios WHERE project_id = ? AND user_id = ? ORDER BY created_at, id`,
		[]any{p.ID, userID},
		func(rows *sql.Rows) error {
			c := Studio{ProjectID: p.ID}
			if err := rows.Scan(&c.ID, &c.Name, &c.CreatedAt, &c.UpdatedAt, &c.ViewJSON); err != nil {
				return err
			}
			d.Studios = append(d.Studios, c)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	for i := range d.Studios {
		c := &d.Studios[i]
		c.Members = []StudioMember{}
		err = s.eachRow(
			`SELECT run_id, position FROM studio_members WHERE studio_id = ? ORDER BY position, id`,
			[]any{c.ID},
			func(rows *sql.Rows) error {
				var m StudioMember
				if err := rows.Scan(&m.RunID, &m.Position); err != nil {
					return err
				}
				c.Members = append(c.Members, m)
				return nil
			},
		)
		if err != nil {
			return nil, err
		}
		c.MemberCount = len(c.Members)
	}
	return d, nil
}

// eachRow runs a query and hands every row to fn, closing the result set before it returns.
func (s *Store) eachRow(query string, args []any, fn func(*sql.Rows) error) error {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

/*
pruneProjectData removes from the data folder what the document no longer names.

Only inside runs/ and projects/, which are the only places a save writes; a
folder that holds something kept is walked into, and one that holds nothing
kept goes whole -- a deleted run's folder, or a copy a crash left half made.
*/
func pruneProjectData(data string, keep []string) error {
	kept := map[string]bool{}
	for _, k := range keep {
		kept[k] = true
	}
	for root := range projectAssetRoots {
		base := filepath.Join(data, root)
		if !isDir(base) {
			continue
		}
		err := filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if p == base {
				return nil
			}
			rel, err := filepath.Rel(data, p)
			if err != nil {
				return err
			}
			if kept[rel] {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if holdsKept(rel, keep) {
					return nil
				}
				if err := os.RemoveAll(p); err != nil {
					return err
				}
				return filepath.SkipDir
			}
			return os.Remove(p)
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func holdsKept(dir string, keep []string) bool {
	prefix := dir + string(filepath.Separator)
	for _, k := range keep {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

// ---- Opening -----------------------------------------------------------------

/*
OpenProjectFile reads the project file at path into the user's projects.

Checked before anything is written: the document's format and version, every
path it names, and that none of its rows belongs to another account here. Then
the files, so that no row ever points at a raster that has not arrived; then
the rows, in one transaction.
*/
func (s *Store) OpenProjectFile(userID, path string) (*ProjectFileSummary, error) {
	if userID == "" {
		userID = LocalUserID
	}
	doc, err := readProjectDocument(path)
	if err != nil {
		return nil, err
	}
	assets, err := doc.assetPaths()
	if err != nil {
		return nil, err
	}
	if err := s.checkProjectOwnership(s.db, userID, doc); err != nil {
		return nil, err
	}
	data := projectDataDir(path)
	sum := doc.summary(path)
	for _, rel := range assets {
		// Present here means current here, for the reason a save gives.
		dst := filepath.Join(s.dataDir, rel)
		if exists(dst) {
			continue
		}
		src := filepath.Join(data, rel)
		if !exists(src) {
			sum.MissingAssets++
			continue
		}
		if err := copyPathStaged(src, dst); err != nil {
			return nil, fmt.Errorf("copying %s out of the project: %w", rel, err)
		}
	}
	if err := s.importProjectDocument(userID, doc); err != nil {
		return nil, err
	}
	return sum, nil
}

// readProjectDocument reads and checks a project file, without touching the store.
func readProjectDocument(path string) (*ProjectDocument, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	// Read only: a failed close loses nothing.
	defer func() { _ = f.Close() }()
	raw, err := io.ReadAll(io.LimitReader(f, maxProjectFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxProjectFileBytes {
		return nil, fmt.Errorf("%w: it is larger than a project document can be", ErrNotAProjectFile)
	}
	var probe struct {
		Format  string `json:"format"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotAProjectFile, err)
	}
	switch probe.Format {
	case ProjectFileFormat:
	case solaraProjectFormat:
		return nil, fmt.Errorf("%w: it is a Solara project, which Solara opens", ErrNotAProjectFile)
	default:
		return nil, ErrNotAProjectFile
	}
	if probe.Version > projectFileVersion {
		return nil, fmt.Errorf("%w (format %d; this build reads up to %d)",
			ErrProjectFileNewer, probe.Version, projectFileVersion)
	}
	var d ProjectDocument
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotAProjectFile, err)
	}
	if err := d.validate(); err != nil {
		return nil, err
	}
	return &d, nil
}

/*
validate holds the document to the one shape the import can write: every row
named, every row filed under the document's own project. A row claiming
another project would be written under that project's id -- into someone
else's work if the id exists here.
*/
func (d *ProjectDocument) validate() error {
	bad := func(what string) error { return fmt.Errorf("%w: %s", ErrNotAProjectFile, what) }
	pid := strings.TrimSpace(d.Project.ID)
	if pid == "" || strings.TrimSpace(d.Project.Name) == "" {
		return bad("the project has no id or no name")
	}
	own := func(id, projectID, kind string) error {
		if strings.TrimSpace(id) == "" {
			return bad(kind + " without an id")
		}
		if projectID != "" && projectID != pid {
			return bad(kind + " " + id + " is filed under another project")
		}
		return nil
	}
	for i := range d.Areas {
		if err := own(d.Areas[i].ID, d.Areas[i].ProjectID, "an area"); err != nil {
			return err
		}
		d.Areas[i].ProjectID = pid
	}
	for i := range d.Runs {
		if err := own(d.Runs[i].ID, d.Runs[i].ProjectID, "a run"); err != nil {
			return err
		}
		d.Runs[i].ProjectID = pid
	}
	for i := range d.Overlays {
		if err := own(d.Overlays[i].ID, d.Overlays[i].ProjectID, "a composition"); err != nil {
			return err
		}
		d.Overlays[i].ProjectID = pid
	}
	for i := range d.Studios {
		if err := own(d.Studios[i].ID, d.Studios[i].ProjectID, "a studio"); err != nil {
			return err
		}
		d.Studios[i].ProjectID = pid
	}
	return nil
}

// querier is what the ownership check needs of a database or a transaction.
type querier interface {
	QueryRow(query string, args ...any) *sql.Row
}

/*
checkProjectOwnership refuses a document whose rows exist here under another
account, or whose compositions exist here under another project. Ids are kept
on open, so those rows would be overwritten -- another account's work
replaced by a file. Rows that do not exist yet are simply new.
*/
func (s *Store) checkProjectOwnership(q querier, userID string, d *ProjectDocument) error {
	owned := func(table, id string) error {
		var owner string
		err := q.QueryRow(`SELECT user_id FROM `+table+` WHERE id = ?`, id).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if owner != userID {
			return ErrProjectOwnedElsewhere
		}
		return nil
	}
	if err := owned("projects", d.Project.ID); err != nil {
		return err
	}
	for _, a := range d.Areas {
		if err := owned("areas", a.ID); err != nil {
			return err
		}
	}
	for _, r := range d.Runs {
		if err := owned("inference_runs", r.ID); err != nil {
			return err
		}
	}
	for _, c := range d.Studios {
		if err := owned("studios", c.ID); err != nil {
			return err
		}
	}
	for _, o := range d.Overlays {
		var project string
		err := q.QueryRow(`SELECT project_id FROM project_overlays WHERE id = ?`, o.ID).Scan(&project)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if project != d.Project.ID {
			return ErrProjectOwnedElsewhere
		}
	}
	return nil
}

// importProjectDocument writes the document's rows, in one transaction.
func (s *Store) importProjectDocument(userID string, d *ProjectDocument) (err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	// Again, inside the transaction: the check before the files were copied
	// is what kept them from being copied for nothing, this one is the guard.
	if err = s.checkProjectOwnership(tx, userID, d); err != nil {
		return err
	}

	p := d.Project
	if _, err = tx.Exec(
		`INSERT INTO projects (id, user_id, name, notes, created_at, updated_at, last_area_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   name = excluded.name, notes = excluded.notes,
		   updated_at = excluded.updated_at, last_area_id = excluded.last_area_id`,
		p.ID, userID, p.Name, p.Notes, p.CreatedAt, p.UpdatedAt, p.LastAreaID,
	); err != nil {
		return fmt.Errorf("writing the project: %w", err)
	}

	for _, a := range d.Areas {
		if _, err = tx.Exec(
			`INSERT INTO areas (id, project_id, user_id, name, polygon_geojson, notes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   name = excluded.name, polygon_geojson = excluded.polygon_geojson,
			   notes = excluded.notes, updated_at = excluded.updated_at`,
			a.ID, p.ID, userID, a.Name, a.PolygonGeoJSON, a.Notes, a.CreatedAt, a.UpdatedAt,
		); err != nil {
			return fmt.Errorf("writing area %s: %w", a.ID, err)
		}
	}

	for _, r := range d.Runs {
		if r.Kind == "" {
			r.Kind = RunKindClassification
		}
		if r.ResultJSON == "" {
			r.ResultJSON = "{}"
		}
		if r.SummaryJSON == "" {
			r.SummaryJSON = "{}"
		}
		if _, err = tx.Exec(
			`INSERT INTO inference_runs
			 (id, user_id, created_at, model_kind, period_start, period_end, polygon_geojson, status,
			  summary_json, overlay_relpath, n_dates, result_json, assets_relpath, label, project_id,
			  kind, area_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   created_at = excluded.created_at, model_kind = excluded.model_kind,
			   period_start = excluded.period_start, period_end = excluded.period_end,
			   polygon_geojson = excluded.polygon_geojson, status = excluded.status,
			   summary_json = excluded.summary_json, overlay_relpath = excluded.overlay_relpath,
			   n_dates = excluded.n_dates, result_json = excluded.result_json,
			   assets_relpath = excluded.assets_relpath, label = excluded.label,
			   project_id = excluded.project_id, kind = excluded.kind, area_id = excluded.area_id`,
			r.ID, userID, r.CreatedAt, r.ModelKind, r.PeriodStart, r.PeriodEnd, r.PolygonGeoJSON,
			r.Status, r.SummaryJSON, nullIfEmpty(r.OverlayRelPath), r.NDates, r.ResultJSON,
			nullIfEmpty(r.AssetsRelPath), r.Label, p.ID, r.Kind, r.AreaID,
		); err != nil {
			return fmt.Errorf("writing run %s: %w", r.ID, err)
		}
	}

	for _, o := range d.Overlays {
		if o.MetaJSON == "" || !json.Valid([]byte(o.MetaJSON)) {
			o.MetaJSON = "{}"
		}
		if _, err = tx.Exec(
			`INSERT INTO project_overlays
			 (id, project_id, run_id, area_id, kind, title, meta_json, png_relpath, tif_relpath, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   run_id = excluded.run_id, area_id = excluded.area_id, kind = excluded.kind,
			   title = excluded.title, meta_json = excluded.meta_json,
			   png_relpath = excluded.png_relpath, tif_relpath = excluded.tif_relpath`,
			o.ID, p.ID, nullIfEmpty(o.RunID), o.AreaID, o.Kind, o.Title, o.MetaJSON,
			nullIfEmpty(o.PNGRelPath), nullIfEmpty(o.TIFRelPath), o.CreatedAt,
		); err != nil {
			return fmt.Errorf("writing composition %s: %w", o.ID, err)
		}
	}

	for _, c := range d.Studios {
		if c.ViewJSON == "" {
			c.ViewJSON = "{}"
		}
		if _, err = tx.Exec(
			`INSERT INTO studios (id, user_id, project_id, name, created_at, updated_at, view_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   project_id = excluded.project_id, name = excluded.name,
			   updated_at = excluded.updated_at, view_json = excluded.view_json`,
			c.ID, userID, p.ID, c.Name, c.CreatedAt, c.UpdatedAt, c.ViewJSON,
		); err != nil {
			return fmt.Errorf("writing studio %s: %w", c.ID, err)
		}
		// Replaced whole, as SaveStudio does: a board is what it holds now.
		if _, err = tx.Exec(`DELETE FROM studio_members WHERE studio_id = ?`, c.ID); err != nil {
			return err
		}
		for _, m := range c.Members {
			// New member ids: nothing refers to one, and reusing the file's
			// would collide the second time the same file is opened elsewhere.
			if _, err = tx.Exec(
				`INSERT INTO studio_members (id, studio_id, run_id, position) VALUES (?, ?, ?, ?)`,
				uuid.NewString(), c.ID, m.RunID, m.Position,
			); err != nil {
				return fmt.Errorf("writing studio %s: %w", c.ID, err)
			}
		}
	}
	return tx.Commit()
}

// ---- Files -------------------------------------------------------------------

func writeFileAtomic(path string, b []byte) error {
	return writeAtomic(path, func(w io.Writer) error {
		_, err := w.Write(b)
		return err
	})
}

/*
writeAtomic writes through a temporary file in the destination's directory and
renames it over the destination, so a reader, or the user after a crash, finds
either the old file or the whole new one and never a truncated one. The same
directory, because a rename across file systems is a copy and not atomic.
*/
func writeAtomic(path string, write func(io.Writer) error) (err error) {
	dir, base := filepath.Split(path)
	if dir == "" {
		dir = "."
	}
	tmp, err := os.CreateTemp(dir, "."+base+".*.tmp")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if err = write(tmp); err != nil {
		return err
	}
	// Flushed before the rename: without it a crash can leave the new name
	// pointing at a file whose contents never reached the disk.
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	// CreateTemp makes the file 0600; a saved document is an ordinary user file.
	if err = os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

/*
copyPathStaged copies a file or a folder to dst through a hidden staging name
beside it, renamed into place when complete. A copy that fails part way never
leaves a dst that looks whole, which matters because presence is what both
directions read as "already copied". Only folders and regular files are
copied; the analyses write nothing else, and following a link would copy
whatever it points at.
*/
func copyPathStaged(src, dst string) (err error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		if !info.Mode().IsRegular() {
			return nil
		}
		return writeAtomic(dst, func(w io.Writer) error {
			in, err := os.Open(src)
			if err != nil {
				return err
			}
			defer in.Close()
			_, err = io.Copy(w, in)
			return err
		})
	}
	stage, err := os.MkdirTemp(filepath.Dir(dst), "."+filepath.Base(dst)+".partial-")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(stage)
		}
	}()
	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(stage, rel)
		switch {
		case d.IsDir():
			if rel == "." {
				return nil
			}
			return os.Mkdir(target, 0o700)
		case d.Type().IsRegular():
			return copyFile(p, target)
		default:
			return nil
		}
	})
	if err != nil {
		return err
	}
	return os.Rename(stage, dst)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
