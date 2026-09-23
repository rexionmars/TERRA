package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"

	"github.com/google/uuid"
)

// Saving a run, and reading one back.
//
// One shape for every product: saveRun writes the row and the assets, one
// persist* per product maps that product's payload onto it, and LoadAnalysis
// reads the whole thing back for the studio. The row and its assets are all
// that survives a restart, so this is where a result becomes something the
// application still knows about tomorrow.

/*
savedRun is what one product contributes to a run row: the parts the writer
below cannot know.

Every product that persists a run goes through saveRun, and before this type
existed the path was one sequence written once per product, six times over.
That is how it drifted: the "run-" prefix, the trimmed project id and the area
link each had to be added in every copy, and the thumbnail column the
classification path fills never reached any of the others.
*/
type savedRun struct {
	// The discriminator every reader branches on, and what produced the
	// numbers -- for the descriptive products a data source, not a model.
	kind      string
	modelKind string

	// Where the run was made. A polygon, always: the alternative was an
	// embedded example's id, and when a request came that way this wrote
	// `{"area_id":"A"}` into the polygon column -- a geometry field holding
	// something no reader of geometry can parse. The examples are gone and so
	// is the branch.
	polygon *analysis.GeoJSONGeometry

	// What the run is called. aoiLabel names the ground and arrives already
	// resolved, because the summary the caller built carries the same string;
	// runLabel is what the frontend asked for, and is minted from aoiLabel
	// when it asked for nothing.
	aoiLabel string
	runLabel string

	projectID string
	// Which catalogued area this run is OF. The polygon says where it was
	// made; the board needs the area to keep a drawing and its runs as one
	// subject.
	areaID string

	periodStart string
	periodEnd   string
	nDates      int

	// The figures the saved-run list prints. This is the part that is really
	// different between products, which is why it is built at the call site.
	summary map[string]any

	/*
		result yields the payload to store, given the run's asset directory
		and that directory's path relative to the data dir.

		A function rather than a value because the assets have to be written
		out, and their data URIs cleared from the copy being stored, before
		there is anything to marshal: a result JSON still carrying its base64
		would put a second copy of every overlay inside the database.
	*/
	result func(assetsDir, assetsRel string) any

	/*
		Which of the run's files is the one to show, for the products that
		write one.

		EVERY PRODUCT THAT WRITES A RASTER SETS THIS, and the completeness is
		the point rather than a tidiness. At first only two products did: the
		others that wrote a PNG recorded no path to it, so the column was right
		for 5 rows out of 40 on one installation. Nothing reads it today, and
		that is downstream of the same fact -- a reader of a column that is
		right for an eighth of the table is a reader that is wrong for the
		rest, so the run list loads a whole result to find an image it already
		has on disk, and the studio browser draws a colour instead of a
		thumbnail rather than pay for that. Filling it is what makes a cheap
		reader possible; TestEveryRasterRunRecordsItsOverlay is what keeps it
		true.

		Left empty, the column stays NULL rather than naming a file the run
		never produced.
	*/
	overlayFile string
}

/*
saveRun writes one run row and returns its id, empty when nothing was written.

Best effort from end to end: failing to record a run must not discard the
result the user is looking at, so every error along the way is dropped rather
than reported.
*/

func (a *App) saveRun(run savedRun) string {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil {
		return ""
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	assetsDir := st.RunsDir(runID)
	// Each of the three below used to discard its error, and each failure
	// produced the same shape of wreckage: a row that says a run was recorded,
	// pointing at something that is not there.
	//
	// Without the directory, every asset write inside run.result fails and the
	// row still carries assets_relpath and overlay_relpath into a path that
	// does not exist. Without the marshal, result_json is written empty and
	// LoadAnalysis returns a run with nothing in it -- and json.Marshal is not
	// hypothetical here: it refuses NaN and Inf, which a sidecar payload with
	// a missing float reaches the Go side carrying.
	//
	// Not recording the run at all is the better failure. The result still
	// reaches the user, which is what best effort meant; only the claim to
	// have saved it is withdrawn.
	if err := os.MkdirAll(assetsDir, 0o700); err != nil {
		return ""
	}
	resultBytes, err := json.Marshal(run.result(assetsDir, assetsRel))
	if err != nil {
		return ""
	}
	summaryBytes, err := json.Marshal(run.summary)
	if err != nil {
		return ""
	}

	poly := ""
	if run.polygon != nil {
		if b, err := json.Marshal(run.polygon); err == nil {
			poly = string(b)
		}
	}

	runLabel := strings.TrimSpace(run.runLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(run.aoiLabel)
	}
	// What makeRunLabel mints is prefixed already; a label that came in from
	// the frontend need not be, and readers group runs on that prefix.
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}

	overlayRel := ""
	if run.overlayFile != "" {
		overlayRel = filepath.Join(assetsRel, run.overlayFile)
	}

	if _, err := st.SaveRun(store.InferenceRun{
		ID:             runID,
		UserID:         userID,
		Kind:           run.kind,
		ModelKind:      run.modelKind,
		PeriodStart:    run.periodStart,
		PeriodEnd:      run.periodEnd,
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summaryBytes),
		ResultJSON:     string(resultBytes),
		OverlayRelPath: overlayRel,
		AssetsRelPath:  assetsRel,
		NDates:         run.nDates,
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(run.projectID),
		AreaID:         strings.TrimSpace(run.areaID),
	}); err != nil {
		// Best effort means the failure is not reported, not that it is
		// reported as a success. The caller hands this id to the frontend as
		// the run now on screen, and an id no row answers to is an entry that
		// opens empty.
		return ""
	}
	return runID
}

/*
aoiLabel is what a run calls the ground it covers, taken from the first
candidate the request actually filled in.

Resolved in one place because the label reaches two: the run's own name and its
summary. Resolved twice it can differ between them, and a run named for one
area whose summary names another reads as two runs.
*/

func aoiLabel(candidates ...string) string {
	for _, c := range candidates {
		if s := strings.TrimSpace(c); s != "" {
			return s
		}
	}
	return "Custom AOI"
}

/*
persistWaterRun saves a surface-water run so it survives the session and is
listed, opened and exported like a classification.

Returns the row it wrote, empty when nothing was written. Every persist function
here does, and the reason is the same one persistAnalysis gives: the caller has
to be able to tell the frontend which run it is now looking at. Only the
classification did, and everything downstream paid for it -- the studio's live
area reported the sentinel "current" for these products, so a board could not
record the run it was plainly showing, and a composition applied over one was
filed against no run at all.
*/
func (a *App) persistWaterRun(req analysis.WaterRequest, res *analysis.WaterAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	return a.saveRun(savedRun{
		kind: store.RunKindWater,
		// No model produced this: the index name carries the method instead.
		modelKind:   res.Index,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      res.NDates,
		summary: map[string]any{
			"water_index":             res.Index,
			"n_dates":                 res.NDates,
			"date_range":              res.DateRange,
			"peak_date":               res.PeakDate,
			"peak_water_fraction_pct": res.PeakWaterPct,
			"ephemeral_area_ha":       res.EphemeralAreaHa,
			"persistent_area_ha":      res.PersistentAreaHa,
			"aoi_area_ha":             res.AOIAreaHa,
			"aoi_label":               label,
		},
		result: func(assetsDir, _ string) any {
			_ = store.WriteDataURIFile(
				res.OccurrenceURI, filepath.Join(assetsDir, waterOccurrencePNG))
			// Store without the bulky data URI; the asset is restored on load.
			stored := *res
			stored.OccurrenceURI = ""
			return stored
		},
		// The one image this product has, so the column that names a run's
		// representative raster names it. See savedRun.overlayFile.
		overlayFile: waterOccurrencePNG,
	})
}

// waterOccurrencePNG is the occurrence raster's name inside a run's asset
// directory, written here and read back by LoadAnalysis.
const waterOccurrencePNG = "water_occurrence.png"

/*
persistMineralRun saves a mineral map with its class rasters and GeoTIFF.

The summary carries the observed area beside the identified areas: over
vegetated ground most of an area has no mineral answer, and an identified area
printed without the ground it was taken over reads as the whole area.
*/
func (a *App) persistMineralRun(req analysis.MineralRequest, res *analysis.MineralAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	summary := map[string]any{
		"mineral_expert_system":    res.ExpertSystem,
		"mineral_aoi_area_ha":      res.AOIAreaHa,
		"mineral_observed_area_ha": res.ObservedAreaHa,
		"mineral_n_scenes":         len(res.Scenes),
		"aoi_label":                label,
	}
	for _, g := range res.Groups {
		summary[fmt.Sprintf("mineral_group%d_detected_ha", g.Group)] = g.DetectedAreaHa
		if len(g.Classes) > 0 {
			summary[fmt.Sprintf("mineral_group%d_top_class", g.Group)] = g.Classes[0].Class
		}
	}
	// The thumbnail is the 2-2.5 um group's map when there is one, the group
	// that separates the clays; otherwise the first map written.
	overlay := ""
	for _, g := range res.Groups {
		if g.ClassURI == "" && g.ClassPNG == "" {
			continue
		}
		if overlay == "" || g.Group == 2 {
			overlay = mineralGroupPNG(g.Group)
		}
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindMineral,
		modelKind:   res.ExpertSystem,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      len(res.Scenes),
		summary:     summary,
		result: func(assetsDir, assetsRel string) any {
			stored := *res
			stored.Groups = make([]analysis.MineralGroup, len(res.Groups))
			for i, g := range res.Groups {
				src := g.ClassURI
				if src == "" {
					src = g.ClassPNG
				}
				name := mineralGroupPNG(g.Group)
				g.ClassPNG = ""
				if err := store.WriteDataURIFile(src, filepath.Join(assetsDir, name)); err == nil && src != "" {
					g.ClassPNG = filepath.Join(assetsRel, name)
				}
				g.ClassURI = ""
				stored.Groups[i] = g
			}
			stored.GeoTIFF = ""
			if strings.TrimSpace(res.GeoTIFF) != "" {
				if err := store.WriteDataURIFile(res.GeoTIFF, filepath.Join(assetsDir, mineralMapTIF)); err == nil {
					stored.GeoTIFF = filepath.Join(assetsRel, mineralMapTIF)
				}
			}
			return stored
		},
		overlayFile: overlay,
	})
}

func (a *App) persistAnalysis(req analysis.PredictRequest, res *analysis.PredictResult) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	runID := a.saveRun(savedRun{
		kind:        store.RunKindClassification,
		modelKind:   req.ModelKind,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      res.NDates,
		summary: map[string]any{
			"class_stats":     res.ClassStats,
			"date_range":      res.DateRange,
			"n_dates":         res.NDates,
			"mean_confidence": res.MeanConfidence,
			"aoi_label":       label,
			"has_reference":   res.ReferenceURI != "",
			"has_ndvi_mean":   res.NDVIMeanURI != "",
			"has_true_color":  res.TrueColorURI != "",
		},
		// The only path that writes more than one asset, and the reason the
		// stored payload is produced here rather than handed over: the raster
		// records where it landed, and the five images have to be gone from
		// the copy that reaches the database.
		result: func(assetsDir, assetsRel string) any {
			_ = store.WriteDataURIFile(res.OverlayURI, filepath.Join(assetsDir, "overlay.png"))
			_ = store.WriteDataURIFile(res.ConfidenceURI, filepath.Join(assetsDir, "confidence.png"))
			_ = store.WriteDataURIFile(res.NDVIMeanURI, filepath.Join(assetsDir, "ndvi_mean.png"))
			_ = store.WriteDataURIFile(res.TrueColorURI, filepath.Join(assetsDir, "true_color.png"))
			_ = store.WriteDataURIFile(res.ReferenceURI, filepath.Join(assetsDir, "reference.png"))
			if res.LULC != nil && res.LULC.MapURI != "" {
				_ = store.WriteDataURIFile(res.LULC.MapURI, filepath.Join(assetsDir, "lulc_map.png"))
			}
			rasterRel := ""
			if strings.TrimSpace(res.RasterTIF) != "" {
				dest := filepath.Join(assetsDir, "classification.tif")
				if err := store.WriteDataURIFile(res.RasterTIF, dest); err == nil {
					rasterRel = filepath.Join(assetsRel, "classification.tif")
				}
			}

			// Persist result without bulky data URIs; assets restored on load.
			stored := *res
			stored.OverlayURI = ""
			stored.ConfidenceURI = ""
			stored.NDVIMeanURI = ""
			stored.TrueColorURI = ""
			stored.ReferenceURI = ""
			if stored.LULC != nil {
				lulcCopy := *stored.LULC
				lulcCopy.MapURI = ""
				lulcCopy.MapPNG = ""
				stored.LULC = &lulcCopy
			}
			// Empty when the raster was absent or could not be written, so the
			// stored path never points at a file that is not there.
			stored.RasterTIF = rasterRel
			return stored
		},
		overlayFile: "overlay.png",
	})
	if runID != "" && strings.TrimSpace(req.ProjectID) != "" {
		if st := a.currentStore(); st != nil {
			st.TouchProject(req.ProjectID)
		}
	}
	return runID
}

// ListRuns returns recent inference runs (signed-in user, or local guest).
func (a *App) ListRuns(limit int) ([]store.InferenceRun, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	return st.ListRuns(userID, limit)
}

// RunActivity returns the number of runs per calendar day over a trailing
// window, for the activity grid on the settings screen.
//
// Separate from ListRuns because that one caps at 100 rows and carries the full
// result payload on each: a year of activity read through it would show empty
// weeks that are not empty.
func (a *App) RunActivity(days int) ([]store.ActivityDay, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	return st.RunActivity(userID, days)
}

// LoadAnalysis restores a saved PredictResult (with image data URIs) by run id.
func (a *App) LoadAnalysis(runID string) (*analysis.PredictResult, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	run, err := st.GetRun(userID, runID)
	if err != nil {
		// Also try local bucket if signed-in user has no match (legacy local saves).
		if u != nil {
			run, err = st.GetRun(store.LocalUserID, runID)
		}
		if err != nil {
			return nil, mapStoreErr(err)
		}
	}
	assetsDir := st.RunsDir(run.ID)

	// A water run stores a WaterAnalysis, not a PredictResult. It is returned
	// attached to an otherwise empty result so the analysis view and the export
	// see it through the same field a live run uses. The classification fields
	// are deliberately left at zero: no classification was made, and filling
	// n_dates here would make the page present one.
	if run.Kind == store.RunKindWater {
		var water analysis.WaterAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &water)
		}
		if uri, err := store.ReadFileDataURI(
			filepath.Join(assetsDir, "water_occurrence.png"), "image/png",
		); err == nil {
			water.OccurrenceURI = uri
		}
		/*
			Stamped, like the classification branch below it.

			This branch returned without it, so reopening a saved water run
			handed the frontend a result that did not know which run it was --
			the same sentinel the live path suffered from, arriving through the
			other door. A run read back from its own row is the one case where
			the id is never in doubt.
		*/
		water.RunID = run.ID
		return &analysis.PredictResult{Water: &water, RunID: run.ID}, nil
	}

	// A mineral run: every raster path is rewritten to the file in this run's
	// folder, because the sidecar's own paths point into a work directory that
	// is gone by the time a run is reopened, and one that is missing is left
	// empty rather than offered to the export as a file that cannot be read.
	if run.Kind == store.RunKindMineral {
		var mineral analysis.MineralAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &mineral)
		}
		mineral.NormalizeNilSlices()
		for i := range mineral.Groups {
			png := filepath.Join(assetsDir, mineralGroupPNG(mineral.Groups[i].Group))
			mineral.Groups[i].ClassPNG = ""
			if uri, err := store.ReadFileDataURI(png, "image/png"); err == nil {
				mineral.Groups[i].ClassURI = uri
				mineral.Groups[i].ClassPNG = png
			}
		}
		mineral.GeoTIFF = ""
		tif := filepath.Join(assetsDir, mineralMapTIF)
		if _, err := os.Stat(tif); err == nil {
			mineral.GeoTIFF = tif
		}
		mineral.RunID = run.ID
		return &analysis.PredictResult{Mineral: &mineral, RunID: run.ID}, nil
	}

	var res analysis.PredictResult
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &res)
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "overlay.png"), "image/png"); err == nil {
		res.OverlayURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "confidence.png"), "image/png"); err == nil {
		res.ConfidenceURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "ndvi_mean.png"), "image/png"); err == nil {
		res.NDVIMeanURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "true_color.png"), "image/png"); err == nil {
		res.TrueColorURI = uri
	}
	if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "reference.png"), "image/png"); err == nil {
		res.ReferenceURI = uri
	}
	if res.LULC != nil {
		if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "lulc_map.png"), "image/png"); err == nil {
			res.LULC.MapURI = uri
		}
	} else {
		// Older saves may lack lulc block; map alone is optional.
		if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, "lulc_map.png"), "image/png"); err == nil {
			res.LULC = &analysis.LULCAnalysis{MapURI: uri}
		}
	}
	tif := filepath.Join(assetsDir, "classification.tif")
	if _, err := os.Stat(tif); err == nil {
		res.RasterTIF = tif
	}
	if res.DateRange == nil {
		res.DateRange = []string{run.PeriodStart, run.PeriodEnd}
	}
	if res.NDates == 0 {
		res.NDates = run.NDates
	}
	/*
		The run this result IS, stamped on the way out.

		RunID is written by Predict after persisting, so the copy that goes to
		disk does not carry it -- the id did not exist when the result was
		serialised. Reloading therefore handed back a result that could not say
		which run it was, and every surface downstream had to guess. The map
		screen guessed the literal "current", which the board then listed as a
		run named after the AOI label or, failing that, "Analysis": a row that
		looked like a saved analysis, could not be told apart from one, and
		refused every action keyed on its id -- deleting it asked the store for
		a run called "current" and was told, correctly, that there is none.

		Set here rather than at each caller because the id is only knowable
		here, and a caller that forgets is a caller that reintroduces the ghost.
	*/
	res.RunID = run.ID
	return &res, nil
}

// makeRunLabel builds run-<slug>-<yyyyMMdd-HHmmss> from an AOI hint.
func makeRunLabel(aoiHint string) string {
	slug := slugifyRunHint(aoiHint)
	if slug == "" {
		slug = "aoi"
	}
	stamp := time.Now().Format("20060102-150405")
	return fmt.Sprintf("run-%s-%s", slug, stamp)
}

func slugifyRunHint(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 28 {
		out = strings.TrimRight(out[:28], "-")
	}
	return out
}
