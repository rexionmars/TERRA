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

type savedRun struct {
	// The discriminator every reader branches on, and what produced the
	// numbers -- for the descriptive products a data source, not a model.
	kind      string
	modelKind string

	// Where the run was made. The polygon wins; the area id is recorded as a
	// reference when the request named a catalogued area instead of drawing
	// a shape.
	areaID  string
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
	aoiID string

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

	// The file in that directory the run list paints its thumbnail from, for
	// the products that write one.
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
	} else if run.areaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, run.areaID)
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
		AoiID:          strings.TrimSpace(run.aoiID),
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
		areaID:      req.AreaID,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		aoiID:       req.AoiID,
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
				res.OccurrenceURI, filepath.Join(assetsDir, "water_occurrence.png"))
			// Store without the bulky data URI; the asset is restored on load.
			stored := *res
			stored.OccurrenceURI = ""
			return stored
		},
	})
}

// persistSolarRun saves a solar resource run so it survives the session and is
// listed, opened and exported like the other analyses. Returns the row it
// wrote; see persistWaterRun for why every one of these does.
func (a *App) persistSolarRun(req analysis.SolarRequest, res *analysis.SolarAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	return a.saveRun(savedRun{
		kind: store.RunKindSolar,
		// No model produced this; the source is the method that did.
		modelKind: "NASA POWER",
		areaID:    req.AreaID,
		polygon:   req.PolygonGeoJSON,
		aoiLabel:  label,
		runLabel:  req.RunLabel,
		projectID: req.ProjectID,
		aoiID:     req.AoiID,
		nDates:    res.Resource.NYears,
		summary: map[string]any{
			"ghi_annual_kwh_m2":       res.Resource.GHIAnnualKWhM2,
			"optimal_tilt_deg":        res.Geometry.OptimalTiltDeg,
			"specific_yield":          res.PV.SpecificYieldKWhKWpYear,
			"performance_ratio":       res.PV.PerformanceRatio,
			"performance_ratio_model": res.PV.PerformanceRatioModelled,
			"n_years":                 res.Resource.NYears,
			"aoi_label":               label,
			"grid_note":               res.GridNote,
		},
		result: func(string, string) any { return res },
	})
}

// persistSolarRaster saves a solar map run and writes its overlay to disk, so
// reopening the run puts the raster back rather than only its numbers.
func (a *App) persistSolarRaster(
	areaID string, poly *analysis.GeoJSONGeometry,
	label, runLabel, projectID, aoiID, kindTag, variant string,
	payload any, overlayURI string, nDates int,
) string {
	if payload == nil {
		return ""
	}
	l := aoiLabel(label)
	return a.saveRun(savedRun{
		kind:      store.RunKindSolar,
		modelKind: "NASA POWER",
		areaID:    areaID,
		polygon:   poly,
		aoiLabel:  l,
		runLabel:  runLabel,
		projectID: projectID,
		aoiID:     aoiID,
		nDates:    nDates,
		summary: map[string]any{
			"solar_product": kindTag,
			"variant":       variant,
			"aoi_label":     l,
		},
		result: func(assetsDir, _ string) any {
			_ = store.WriteDataURIFile(overlayURI, filepath.Join(assetsDir, kindTag+".png"))
			return payload
		},
	})
}

// persistEnergyModelRun saves an energy model run so it survives the session
// and is listed, opened and exported like the other analyses.
//
// Filed under RunKindSolar with solar_product "energy_model", which is the
// discriminator the solar products already use. It is a solar product: same
// radiation chain, same grid, same optimum.
func (a *App) persistEnergyModelRun(req analysis.EnergyModelRequest, res *analysis.EnergyModelAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	return a.saveRun(savedRun{
		kind: store.RunKindSolar,
		// No model produced this; the source is the method that did.
		modelKind: "NASA POWER",
		areaID:    req.AreaID,
		polygon:   req.PolygonGeoJSON,
		aoiLabel:  label,
		runLabel:  req.RunLabel,
		projectID: req.ProjectID,
		aoiID:     req.AoiID,
		nDates:    res.NDates(),
		// ghi_annual_kwh_m2, optimal_tilt_deg and specific_yield are the keys
		// the saved-run list already reads for a solar row, so the row says
		// something without a client change. Everything else states the basis,
		// because a yield without its performance ratio and reporting basis is
		// not a figure.
		summary: map[string]any{
			"solar_product":            "energy_model",
			"variant":                  res.ReportingBasis,
			"ghi_annual_kwh_m2":        res.LossWaterfall.Base.GHIClimatologyKWhM2Year,
			"optimal_tilt_deg":         res.Geometry.OptimalTiltDeg,
			"specific_yield":           res.LossWaterfall.Delivered.AppliedKWhKWpYear,
			"performance_ratio":        res.PerformanceRatio.Applied,
			"performance_ratio_source": res.PerformanceRatio.AppliedSource,
			"performance_ratio_model":  res.PerformanceRatio.Modelled,
			"reporting_basis":          res.ReportingBasis,
			"capacity_density_basis":   res.CapacityDensity.Basis,
			"suitable_area_ha":         res.Plant.Suitable.AreaHa,
			"suitable_capacity_dc_mw":  res.Plant.Suitable.CapacityDCMW,
			"n_years":                  res.HourlyYears,
			"aoi_label":                label,
			"grid_note":                res.GridNote,
		},
		result: func(string, string) any { return res },
	})
}

// persistWindRun saves a wind screening run under its own kind. Returns the row
// it wrote; see persistWaterRun for why every one of these does.
func (a *App) persistWindRun(req analysis.WindRequest, res *analysis.WindAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	return a.saveRun(savedRun{
		kind: store.RunKindWind,
		// No model produced this; the source is the product that did.
		modelKind: "NASA POWER MERRA-2",
		areaID:    req.AreaID,
		polygon:   req.PolygonGeoJSON,
		aoiLabel:  label,
		runLabel:  req.RunLabel,
		projectID: req.ProjectID,
		aoiID:     req.AoiID,
		nDates:    res.NDates(),
		// The qualifier and the check outcome travel with the capacity factor.
		// A gross, unvalidated figure listed beside a benchmarked photovoltaic
		// one reads as the same kind of number unless the row says otherwise.
		summary: map[string]any{
			"wind_hub_height_m":              res.HubHeightM,
			"wind_mean_speed_50m_ms":         res.Measured.MeanSpeed50mMS,
			"wind_hub_mean_speed_ms":         res.Hub.MeanSpeedMS,
			"wind_gross_capacity_factor_pct": res.Hub.GrossCapacityFactorPct,
			"wind_annual_energy_mwh":         res.Hub.GrossAnnualEnergyMWhPerTurbine,
			"wind_turbine":                   res.Turbine.Name,
			"wind_all_checks_passed":         res.DataQuality.AllChecksPassed,
			"wind_flag_count":                len(res.DataQuality.Flags),
			"record_window":                  res.RecordWindow,
			"qualifier":                      res.Qualifier,
			"aoi_label":                      label,
			"grid_note":                      res.GridNote,
		},
		result: func(string, string) any { return res },
	})
}

/*
AnalyzeFlood measures the HAND flood extent over the AOI and how much of that
extent the choice of DEM product decides rather than the terrain.

There is no call that returns one mask. What comes back is the agreement count
raster -- per cell, how many products call it flooded at the reference
threshold -- with the pairwise envelope around it, because an extent shipped
alone is a shape produced by a DEM the user never chose and is never shown.
*/

// persistFloodRun saves a flood envelope run under its own kind, with its two
// rasters copied out of the sidecar's work directory and the bounds that place
// the displayed one stored beside them.
//
// The copy is the point. AnalyzeFlood deliberately leaves the work directory in
// place because the returned paths point into it, but that directory is under
// the system temporary root and is removed on a schedule nobody here controls.
// A run whose stored paths still named it would list, reopen, and hand the
// reader a GeoTIFF path that resolves to nothing -- and the GeoTIFF is the
// product, not an illustration of it.
func (a *App) persistFloodRun(req analysis.FloodRequest, res *analysis.FloodAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	// The envelope row at the reference threshold: the narrowest and widest
	// pairwise agreement where the agreement raster was built. Absent when the
	// reference threshold produced no defined pair, in which case the summary
	// carries no range rather than a zero one.
	var refRow *analysis.FloodEnvelopeRow
	for i := range res.Envelope {
		if res.Envelope[i].ThresholdM == res.ReferenceThresholdM {
			refRow = &res.Envelope[i]
			break
		}
	}
	summary := map[string]any{
		"flood_reference_threshold_m": res.ReferenceThresholdM,
		"flood_drainage_km2":          res.DrainageKm2,
		"flood_n_products":            len(res.Products),
		"flood_products":              floodProductIDs(res.Products),
		/*
			The AOI area, beside the two areas measured inside it.

			The agreement figures below are now taken over the AOI polygon
			rather than over the buffered window the terrain chain ran on, and
			a row listing a contested area with no denominator cannot be told
			apart from one that was taken over the window -- the difference on
			the recorded payload is 4.5 km2 against 37.5. Listed here so the
			run row carries the ground its own numbers are of.
		*/
		"flood_aoi_area_km2":      res.AOI.AreaKm2,
		"flood_unanimous_wet_km2": res.Agreement.UnanimousWetKm2,
		"flood_contested_km2":     res.Agreement.ContestedKm2,
		// Null when no product calls anything wet. Zero would read as four
		// products agreeing on an extent, which is the opposite of the fact.
		"flood_contested_frac_of_wet": res.Agreement.ContestedFracOfWet,
		/*
			The qualifier is a listed field and not a detail of the open card.

			Every figure above is a measurement over TERRA's own DEM set and
			none of them is a flood depth, an extent or a probability. A row
			printing a contested area with nothing beside it is exactly the
			reading the qualifier exists to prevent, and the run list is where
			these figures are read most often and explained least.
		*/
		"qualifier": res.Qualifier,
		"aoi_label": label,
	}
	if refRow != nil {
		summary["flood_iou_min"] = refRow.IoUMin
		summary["flood_iou_max"] = refRow.IoUMax
	}
	// The thumbnail is claimed only when there is a rendering to write. Named
	// unconditionally, the row would carry an overlay path into a file the
	// result closure never produced, which is the shape saveRun refuses to
	// write a row for elsewhere.
	overlay := ""
	if res.AgreementURI != "" || res.AgreementPNG != "" {
		overlay = floodAgreementPNG
	}
	return a.saveRun(savedRun{
		kind: store.RunKindFlood,
		// No model produced this; the terrain index and the catalogue the DEMs
		// were read from are the method.
		modelKind: "HAND over Planetary Computer DEM",
		areaID:    req.AreaID,
		polygon:   req.PolygonGeoJSON,
		aoiLabel:  label,
		runLabel:  req.RunLabel,
		projectID: req.ProjectID,
		aoiID:     req.AoiID,
		// Zero, and not unfilled: HAND is a static terrain index with no
		// observation dates to count. See FloodAnalysis.NDates.
		nDates:  res.NDates(),
		summary: summary,
		result: func(assetsDir, assetsRel string) any {
			stored := *res
			// The rendering, written from the data URI when there is one and
			// from the sidecar's path when the URI could not be read.
			pngSrc := res.AgreementURI
			if pngSrc == "" {
				pngSrc = res.AgreementPNG
			}
			stored.AgreementPNG = ""
			if err := store.WriteDataURIFile(
				pngSrc, filepath.Join(assetsDir, floodAgreementPNG),
			); err == nil && pngSrc != "" {
				stored.AgreementPNG = filepath.Join(assetsRel, floodAgreementPNG)
			}
			stored.AgreementTIF = ""
			if strings.TrimSpace(res.AgreementTIF) != "" {
				if err := store.WriteDataURIFile(
					res.AgreementTIF, filepath.Join(assetsDir, floodAgreementTIF),
				); err == nil {
					stored.AgreementTIF = filepath.Join(assetsRel, floodAgreementTIF)
				}
			}
			// The base64 stays out of the database; LoadAnalysis reads it back
			// from the file written above.
			stored.AgreementURI = ""
			return stored
		},
		// The run list paints its thumbnail from the agreement raster, which is
		// the one image this product has.
		overlayFile: overlay,
	})
}

// persistRunIfLoggedIn saves the run and returns its id, so the caller can tell
// the frontend which run it is now looking at. Empty when nothing was saved.
func (a *App) persistRunIfLoggedIn(req analysis.PredictRequest, res *analysis.PredictResult) string {
	return a.persistAnalysis(req, res)
}

func (a *App) persistAnalysis(req analysis.PredictRequest, res *analysis.PredictResult) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label, req.AreaID)
	runID := a.saveRun(savedRun{
		kind:        store.RunKindClassification,
		modelKind:   req.ModelKind,
		areaID:      req.AreaID,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		aoiID:       req.AoiID,
		periodStart: req.Start,
		periodEnd:   req.End,
		nDates:      res.NDates,
		summary: map[string]any{
			"class_stats":     res.ClassStats,
			"date_range":      res.DateRange,
			"n_dates":         res.NDates,
			"mean_confidence": res.MeanConfidence,
			"area_id":         req.AreaID,
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
	if run.Kind == store.RunKindSolar {
		// One kind covers four products; the summary says which one was saved.
		var meta struct {
			Product string `json:"solar_product"`
		}
		_ = json.Unmarshal([]byte(run.SummaryJSON), &meta)
		out := &analysis.PredictResult{}
		switch meta.Product {
		case "solar_terrain":
			var t analysis.SolarTerrainAnalysis
			_ = json.Unmarshal([]byte(run.ResultJSON), &t)
			if uri, err := store.ReadFileDataURI(
				filepath.Join(assetsDir, "solar_terrain.png"), "image/png",
			); err == nil {
				t.OverlayURI = uri
			}
			out.SolarTerrain = &t
		case "solar_siting":
			var st analysis.SolarSitingAnalysis
			_ = json.Unmarshal([]byte(run.ResultJSON), &st)
			if uri, err := store.ReadFileDataURI(
				filepath.Join(assetsDir, "solar_siting.png"), "image/png",
			); err == nil {
				st.OverlayURI = uri
			}
			out.SolarSiting = &st
		// "energy_advanced" is the tag this product was written under before it
		// was renamed. It is read and never written. Runs saved under the old
		// tag would otherwise fall to the default branch, which decodes an
		// energy payload into a SolarAnalysis and reopens as an empty solar
		// card with nothing raising an error; a rename that makes a saved run
		// unopenable is a worse defect than the name it fixes. The real store
		// held no such row when the rename was made, so nothing was migrated
		// and no write path can produce the old tag again.
		case "energy_model", "energy_advanced":
			// No raster: the whole run is in result_json. Without this case the
			// run saves and lists correctly and reopens as an empty solar card,
			// with nothing raising an error.
			var e analysis.EnergyModelAnalysis
			if run.ResultJSON != "" && run.ResultJSON != "{}" {
				_ = json.Unmarshal([]byte(run.ResultJSON), &e)
			}
			e.NormalizeNilSlices()
			out.EnergyModel = &e
		default:
			var solar analysis.SolarAnalysis
			if run.ResultJSON != "" && run.ResultJSON != "{}" {
				_ = json.Unmarshal([]byte(run.ResultJSON), &solar)
			}
			out.Solar = &solar
		}
		out.RunID = run.ID
		return out, nil
	}

	// A wind run stores a WindAnalysis and no raster. Returned attached to an
	// otherwise empty result, the way a water run is, so the analysis view and
	// the export see it through the field a live run uses.
	if run.Kind == store.RunKindWind {
		var wind analysis.WindAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &wind)
		}
		wind.NormalizeNilSlices()
		/*
			Stamped, like the solar, flood and classification branches around it.

			This branch and the water one below returned without it, so reopening
			a saved wind or water run handed the frontend a result that did not
			know which run it was -- the same sentinel the live path suffered
			from, arriving through the other door. A run read back from its own
			row is the one case where the id is never in doubt.
		*/
		wind.RunID = run.ID
		return &analysis.PredictResult{Wind: &wind, RunID: run.ID}, nil
	}

	/*
		A flood run stores a FloodAnalysis and two rasters.

		Without this branch the run falls through to the classification path,
		which decodes the flood payload into a PredictResult where nothing binds
		and returns it: the run lists correctly, reopens as an empty card, and
		reports nothing, with no error raised anywhere. That is the defect the
		wind and energy branches above were each written for.

		Both raster paths are rewritten to where the files actually are. What
		was stored is relative to the data directory, and the sidecar's own
		paths -- into a temporary work directory -- are long gone by the time a
		run is reopened. A path that resolves to nothing is worse than none: the
		export would offer a GeoTIFF that cannot be produced.
	*/
	if run.Kind == store.RunKindFlood {
		var flood analysis.FloodAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &flood)
		}
		flood.NormalizeNilSlices()
		/*
			Extent comes back with the rest of the payload and is not rebuilt
			here. It is the bounds of the AOI clip alone; Grid.Bounds is the
			buffered window the chain ran on, several times that ground, so a
			restore that filled the missing field from the grid would place the
			overlay stretched over the buffer -- the same misreading in pixels
			that reporting over the window was in numbers. A run stored before
			the field existed therefore restores with a zero extent and no
			overlay, which the map can detect; a plausible wrong one it cannot.
		*/
		png := filepath.Join(assetsDir, floodAgreementPNG)
		flood.AgreementPNG = ""
		if uri, err := store.ReadFileDataURI(png, "image/png"); err == nil {
			flood.AgreementURI = uri
			flood.AgreementPNG = png
		}
		flood.AgreementTIF = ""
		tif := filepath.Join(assetsDir, floodAgreementTIF)
		if _, err := os.Stat(tif); err == nil {
			flood.AgreementTIF = tif
		}
		return &analysis.PredictResult{Flood: &flood, RunID: run.ID}, nil
	}

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
		// Stamped for the reason the wind branch above states.
		water.RunID = run.ID
		return &analysis.PredictResult{Water: &water, RunID: run.ID}, nil
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
