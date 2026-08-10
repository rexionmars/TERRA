package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"geosense-infer/backend"
	"geosense-infer/backend/store"

	"github.com/google/uuid"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the application struct bound to the frontend.
type App struct {
	ctx    context.Context
	runner *backend.Runner
	store  *store.Store

	mu           sync.RWMutex
	sessionToken string
	currentUser  *store.User

	envBuilder  backend.EnvBuilder
	bootMu      sync.Mutex
	bootLogs    []string
	bootStarted time.Time
}

// NewApp creates a new App.
func NewApp() *App {
	return &App{}
}

/*
currentRunner is the runner as it stands right now.

Every read of a.runner goes through here because the field is no longer written
once at startup and left alone: choosing an interpreter rebuilds it, and each
method bound to the frontend runs on its own goroutine. A bare read racing that
write is a data race on a pointer -- the kind that survives every test and
appears once, in a build nobody can reproduce.

Returning the pointer rather than holding the lock for the call is deliberate.
An analysis runs for minutes; holding the lock across it would make choosing an
interpreter wait for the run to finish. A run that started on the previous
interpreter finishes on it, which is the honest outcome: it is the one it
loaded its model into.
*/
func (a *App) currentRunner() *backend.Runner {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.runner
}

func (a *App) bootLog(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	a.bootMu.Lock()
	a.bootLogs = append(a.bootLogs, msg)
	if len(a.bootLogs) > 64 {
		a.bootLogs = a.bootLogs[len(a.bootLogs)-64:]
	}
	a.bootMu.Unlock()
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "boot:log", msg)
	}
}

// GetBootLogs returns buffered startup lines for the splash screen.
func (a *App) GetBootLogs() []string {
	a.bootMu.Lock()
	defer a.bootMu.Unlock()
	out := make([]string, len(a.bootLogs))
	copy(out, a.bootLogs)
	return out
}

// RevealMainWindow expands from the splash size into the main app chrome
// and forces the window to the front (macOS otherwise keeps the previous app focused).
func (a *App) RevealMainWindow() {
	if a.ctx == nil {
		return
	}
	// Stay floating while we expand so another app cannot cover us mid-transition.
	wruntime.WindowSetAlwaysOnTop(a.ctx, true)
	wruntime.WindowSetMinSize(a.ctx, 1000, 700)
	wruntime.WindowSetMaxSize(a.ctx, 0, 0)
	wruntime.WindowUnminimise(a.ctx)
	wruntime.WindowMaximise(a.ctx)
	// WindowShow → makeKeyAndOrderFront + activateIgnoringOtherApps on Darwin.
	wruntime.WindowShow(a.ctx)
	focusApp()

	ctx := a.ctx
	go func() {
		time.Sleep(250 * time.Millisecond)
		if ctx == nil {
			return
		}
		wruntime.WindowSetAlwaysOnTop(ctx, false)
		wruntime.WindowShow(ctx)
		focusApp()
	}()
}

// startup is called when the app starts; it saves the context and builds the runner.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	wruntime.WindowCenter(ctx)
	a.bootLog("splash ready")

	appDir, err := os.Getwd()
	if err != nil {
		appDir = "."
	}

	// The store opens BEFORE the runner, which is the reverse of what it was.
	// The interpreter chosen in the UI lives in a file beside the database, so
	// the runner cannot be built until that directory is known -- built first,
	// it could only ever guess, which is what left the choice to an environment
	// variable a desktop launch never sees.
	a.bootLog("opening local store…")
	st, err := store.Open()
	if err != nil {
		a.bootLog("store open failed: " + err.Error())
		wruntime.LogError(ctx, "failed to open user store: "+err.Error())
		return
	}
	a.store = st
	a.bootLog("store ready")

	cfg := backend.LoadAppConfig(st.DataDir())
	a.bootLog("resolving sidecar paths…")
	runner, err := backend.NewRunner(appDir, cfg.PythonPath)
	if err != nil {
		a.bootLog("runner init failed: " + err.Error())
		wruntime.LogError(ctx, "failed to init runner: "+err.Error())
	} else {
		// Written under the lock like every other assignment to it. Startup runs
		// before the frontend can call anything, so nothing races this one today
		// -- but a field that is guarded in one place and bare in another is
		// read as safe to touch bare, which is how the guarding gets lost.
		a.mu.Lock()
		a.runner = runner
		a.mu.Unlock()
		a.bootLog("python · " + filepath.Base(runner.PythonPath()))
		a.bootLog("model · " + filepath.Base(runner.ModelDir()))
	}

	if u, token, err := st.RestoreSession(); err == nil {
		a.mu.Lock()
		a.currentUser = u
		a.sessionToken = token
		a.mu.Unlock()
		a.bootLog("session restored")
	} else {
		a.bootLog("local guest session")
	}
}

// domReady runs after the frontend can receive events — re-emit boot lines and probe sidecar.
func (a *App) domReady(ctx context.Context) {
	a.ctx = ctx
	a.bootStarted = time.Now()
	wruntime.WindowCenter(ctx)
	a.bootMu.Lock()
	lines := append([]string{}, a.bootLogs...)
	a.bootMu.Unlock()
	for _, msg := range lines {
		wruntime.EventsEmit(ctx, "boot:log", msg)
	}
	go a.probeSidecar(ctx)
}

func (a *App) probeSidecar(ctx context.Context) {
	a.bootLog("probing sidecar…")
	ok := true
	runner := a.currentRunner()
	if runner == nil {
		a.bootLog("sidecar unavailable")
		ok = false
	} else {
		probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		line, err := runner.Probe(probeCtx)
		if err != nil {
			a.bootLog("sidecar probe: " + err.Error())
			ok = false
		} else {
			a.bootLog(line)
		}
	}

	// Keep the splash visible for at least 5s so it reads as a real boot screen.
	const minSplash = 5 * time.Second
	if a.bootStarted.IsZero() {
		a.bootStarted = time.Now()
	}
	if wait := minSplash - time.Since(a.bootStarted); wait > 0 {
		a.bootLog("warming up…")
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
		}
	}
	a.bootLog("ready")
	// Frontend fades the splash out, then calls RevealMainWindow.
	wruntime.EventsEmit(ctx, "boot:ready", ok)
}

// ListEmbeddedAreas returns the embedded study areas (A/B/C).
func (a *App) ListEmbeddedAreas() []backend.Area {
	runner := a.currentRunner()
	if runner == nil {
		return []backend.Area{}
	}
	return runner.ListAreas()
}

// Predict runs the inference sidecar for the given request.
func (a *App) Predict(req backend.PredictRequest) (*backend.PredictResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.Predict(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistRunIfLoggedIn(req, res)
	return res, nil
}

// AnalyzeLULC runs descriptive MapBiomas land-cover / land-use analysis
// without Sentinel imagery. Embedded areas use local TIFFs; custom AOIs in
// Brazil fetch a MapBiomas Collection 10 COG window on demand.
func (a *App) AnalyzeLULC(req backend.LULCRequest) (*backend.LULCAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeLULC(a.ctx, req)
}

// ListDataCube inventories Sentinel-2 L2A scenes for the AOI (before Classify).
func (a *App) ListDataCube(req backend.DataCubeRequest) (*backend.DataCubeResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.ListDataCube(a.ctx, req)
}

// RenderComposite builds an RGB / false-color or spectral-index overlay for one scene.
func (a *App) RenderComposite(req backend.CompositeRequest) (*backend.CompositeResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.RenderComposite(a.ctx, req)
}

// AnalyzeWater maps surface water over a period from spectral water indices.
// Descriptive: a thresholded index, with no model and no trained legend.
func (a *App) AnalyzeWater(req backend.WaterRequest) (*backend.WaterAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeWater(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistWaterRun(req, res)
	return res, nil
}

// persistWaterRun saves a surface-water run so it survives the session and is
// listed, opened and exported like a classification. Best effort: failing to
// record a run must not discard the result the user is looking at.
func (a *App) persistWaterRun(req backend.WaterRequest, res *backend.WaterAnalysis) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || res == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	assetsDir := st.RunsDir(runID)
	_ = os.MkdirAll(assetsDir, 0o700)
	_ = store.WriteDataURIFile(res.OccurrenceURI, filepath.Join(assetsDir, "water_occurrence.png"))

	// Store without the bulky data URI; the asset is restored on load.
	stored := *res
	stored.OccurrenceURI = ""
	resultBytes, _ := json.Marshal(stored)

	poly := ""
	if req.PolygonGeoJSON != nil {
		if b, err := json.Marshal(req.PolygonGeoJSON); err == nil {
			poly = string(b)
		}
	} else if req.AreaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, req.AreaID)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "Custom AOI"
	}
	runLabel := strings.TrimSpace(req.RunLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(label)
	}
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}

	summary, _ := json.Marshal(map[string]any{
		"water_index":             res.Index,
		"n_dates":                 res.NDates,
		"date_range":              res.DateRange,
		"peak_date":               res.PeakDate,
		"peak_water_fraction_pct": res.PeakWaterPct,
		"ephemeral_area_ha":       res.EphemeralAreaHa,
		"persistent_area_ha":      res.PersistentAreaHa,
		"aoi_area_ha":             res.AOIAreaHa,
		"aoi_label":               label,
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:     runID,
		UserID: userID,
		Kind:   store.RunKindWater,
		// No model produced this: the index name carries the method instead.
		ModelKind:      res.Index,
		PeriodStart:    req.Start,
		PeriodEnd:      req.End,
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		AssetsRelPath:  assetsRel,
		NDates:         res.NDates,
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(req.ProjectID),
	})
}

// AnalyzeSolar computes the solar resource and photovoltaic yield at the AOI.
func (a *App) AnalyzeSolar(req backend.SolarRequest) (*backend.SolarAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolar(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistSolarRun(req, res)
	return res, nil
}

// persistSolarRun saves a solar resource run so it survives the session and is
// listed, opened and exported like the other analyses. Best effort: failing to
// record a run must not discard the result the user is looking at.
func (a *App) persistSolarRun(req backend.SolarRequest, res *backend.SolarAnalysis) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || res == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	_ = os.MkdirAll(st.RunsDir(runID), 0o700)

	resultBytes, _ := json.Marshal(res)

	poly := ""
	if req.PolygonGeoJSON != nil {
		if b, err := json.Marshal(req.PolygonGeoJSON); err == nil {
			poly = string(b)
		}
	} else if req.AreaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, req.AreaID)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "Custom AOI"
	}
	runLabel := strings.TrimSpace(req.RunLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(label)
	}
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}

	summary, _ := json.Marshal(map[string]any{
		"ghi_annual_kwh_m2":       res.Resource.GHIAnnualKWhM2,
		"optimal_tilt_deg":        res.Geometry.OptimalTiltDeg,
		"specific_yield":          res.PV.SpecificYieldKWhKWpYear,
		"performance_ratio":       res.PV.PerformanceRatio,
		"performance_ratio_model": res.PV.PerformanceRatioModelled,
		"n_years":                 res.Resource.NYears,
		"aoi_label":               label,
		"grid_note":               res.GridNote,
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:     runID,
		UserID: userID,
		Kind:   store.RunKindSolar,
		// No model produced this; the source is the method that did.
		ModelKind:      "NASA POWER",
		PeriodStart:    "",
		PeriodEnd:      "",
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		AssetsRelPath:  assetsRel,
		NDates:         res.Resource.NYears,
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(req.ProjectID),
	})
}

// AnalyzeSolarTerrain maps plane-of-array irradiation over the AOI terrain.
func (a *App) AnalyzeSolarTerrain(req backend.SolarTerrainRequest) (*backend.SolarTerrainAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolarTerrain(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistSolarRaster(req.AreaID, req.PolygonGeoJSON, req.Label, req.RunLabel,
		req.ProjectID, "solar_terrain", res.Season, res, res.OverlayURI, res.NDates())
	return res, nil
}

// AnalyzeSolarSiting classifies the AOI for fixed-tilt photovoltaic siting.
func (a *App) AnalyzeSolarSiting(req backend.SolarSitingRequest) (*backend.SolarSitingAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolarSiting(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistSolarRaster(req.AreaID, req.PolygonGeoJSON, req.Label, req.RunLabel,
		req.ProjectID, "solar_siting", "siting", res, res.OverlayURI, 0)
	return res, nil
}

// persistSolarRaster saves a solar map run and writes its overlay to disk, so
// reopening the run puts the raster back rather than only its numbers.
func (a *App) persistSolarRaster(
	areaID string, poly *backend.GeoJSONGeometry,
	label, runLabel, projectID, kindTag, variant string,
	payload any, overlayURI string, nDates int,
) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || payload == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	assetsDir := st.RunsDir(runID)
	_ = os.MkdirAll(assetsDir, 0o700)
	_ = store.WriteDataURIFile(overlayURI, filepath.Join(assetsDir, kindTag+".png"))

	resultBytes, _ := json.Marshal(payload)

	polyJSON := ""
	if poly != nil {
		if b, err := json.Marshal(poly); err == nil {
			polyJSON = string(b)
		}
	} else if areaID != "" {
		polyJSON = fmt.Sprintf(`{"area_id":%q}`, areaID)
	}

	l := strings.TrimSpace(label)
	if l == "" {
		l = "Custom AOI"
	}
	rl := strings.TrimSpace(runLabel)
	if rl == "" {
		rl = makeRunLabel(l)
	}
	if !strings.HasPrefix(strings.ToLower(rl), "run-") {
		rl = "run-" + rl
	}

	summary, _ := json.Marshal(map[string]any{
		"solar_product": kindTag,
		"variant":       variant,
		"aoi_label":     l,
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:             runID,
		UserID:         userID,
		Kind:           store.RunKindSolar,
		ModelKind:      "NASA POWER",
		PolygonGeoJSON: polyJSON,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		AssetsRelPath:  assetsRel,
		NDates:         nDates,
		Label:          rl,
		ProjectID:      strings.TrimSpace(projectID),
	})
}

// AnalyzeEnergyModel runs the photovoltaic energy model over the AOI.
func (a *App) AnalyzeEnergyModel(req backend.EnergyModelRequest) (*backend.EnergyModelAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeEnergyModel(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistEnergyModelRun(req, res)
	return res, nil
}

// persistEnergyModelRun saves an energy model run so it survives the session
// and is listed, opened and exported like the other analyses. Best effort:
// failing to record a run must not discard the result the user is looking at.
//
// Filed under RunKindSolar with solar_product "energy_model", which is the
// discriminator the solar products already use. It is a solar product: same
// radiation chain, same grid, same optimum.
func (a *App) persistEnergyModelRun(req backend.EnergyModelRequest, res *backend.EnergyModelAnalysis) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || res == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	_ = os.MkdirAll(st.RunsDir(runID), 0o700)

	resultBytes, _ := json.Marshal(res)

	poly := ""
	if req.PolygonGeoJSON != nil {
		if b, err := json.Marshal(req.PolygonGeoJSON); err == nil {
			poly = string(b)
		}
	} else if req.AreaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, req.AreaID)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "Custom AOI"
	}
	runLabel := strings.TrimSpace(req.RunLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(label)
	}
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}

	// ghi_annual_kwh_m2, optimal_tilt_deg and specific_yield are the keys the
	// saved-run list already reads for a solar row, so the row says something
	// without a client change. Everything else states the basis, because a
	// yield without its performance ratio and reporting basis is not a figure.
	summary, _ := json.Marshal(map[string]any{
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
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:     runID,
		UserID: userID,
		Kind:   store.RunKindSolar,
		// No model produced this; the source is the method that did.
		ModelKind:      "NASA POWER",
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		AssetsRelPath:  assetsRel,
		NDates:         res.NDates(),
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(req.ProjectID),
	})
}

// AnalyzeWind screens the wind resource at the AOI.
func (a *App) AnalyzeWind(req backend.WindRequest) (*backend.WindAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeWind(a.ctx, req)
	if err != nil {
		return nil, err
	}
	a.persistWindRun(req, res)
	return res, nil
}

// persistWindRun saves a wind screening run under its own kind. Best effort:
// failing to record a run must not discard the result the user is looking at.
func (a *App) persistWindRun(req backend.WindRequest, res *backend.WindAnalysis) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || res == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	_ = os.MkdirAll(st.RunsDir(runID), 0o700)

	resultBytes, _ := json.Marshal(res)

	poly := ""
	if req.PolygonGeoJSON != nil {
		if b, err := json.Marshal(req.PolygonGeoJSON); err == nil {
			poly = string(b)
		}
	} else if req.AreaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, req.AreaID)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "Custom AOI"
	}
	runLabel := strings.TrimSpace(req.RunLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(label)
	}
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}

	// The qualifier and the check outcome travel with the capacity factor. A
	// gross, unvalidated figure listed beside a benchmarked photovoltaic one
	// reads as the same kind of number unless the row says otherwise.
	summary, _ := json.Marshal(map[string]any{
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
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:     runID,
		UserID: userID,
		Kind:   store.RunKindWind,
		// No model produced this; the source is the product that did.
		ModelKind:      "NASA POWER MERRA-2",
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		AssetsRelPath:  assetsRel,
		NDates:         res.NDates(),
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(req.ProjectID),
	})
}

// ExportClassification copies the classification GeoTIFF to a user-chosen path.
func (a *App) ExportClassification(rasterPath string) (string, error) {
	return a.ExportOverlayFile(rasterPath, "terra_classification.tif")
}

// ExportResearchPack writes a ZIP of tabular CSVs (+ AOI / optional GeoTIFF)
// for use in an external training or study workspace.
func (a *App) ExportResearchPack(meta backend.ResearchExportMeta, result *backend.PredictResult) (string, error) {
	if result == nil {
		return "", errors.New("no analysis result to export")
	}
	dataDir := ""
	if a.store != nil {
		dataDir = a.store.DataDir()
	}
	zipBytes, err := backend.BuildResearchPackZIP(meta, result, dataDir)
	if err != nil {
		return "", err
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export research pack",
		DefaultFilename: backend.DefaultResearchPackFilename(meta.AoiLabel),
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".zip") {
		dest += ".zip"
	}
	if err := os.WriteFile(dest, zipBytes, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}

/*
ExportBackup writes the local database and its files to a ZIP the user places.

Everything this application saves lives in one directory on one machine: there
is no server and no account holding a second copy, so a reinstalled laptop
takes every analysis and project with it. This is the only way out.

Password hashes and session tokens are left out of the archive. A backup is a
file people mail to themselves and attach to support threads, and any of those
turns a stored credential into one that has left the machine. Restoring returns
the analyses and projects and asks for a new password; the archive says so in
its README, and so does the button that makes it.

Returns the path written, or an empty string when the user cancels the dialog.
*/
func (a *App) ExportBackup() (string, error) {
	a.mu.RLock()
	st := a.store
	a.mu.RUnlock()
	if st == nil {
		return "", errors.New("the local store is not open")
	}

	// Built before the dialog opens. A large history takes a moment to archive,
	// and doing it after would leave the user looking at a chosen filename with
	// nothing happening, unable to tell a slow write from a stuck one.
	zipBytes, err := st.ExportBackup(a.GetAppVersion())
	if err != nil {
		return "", err
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export backup",
		DefaultFilename: store.DefaultBackupFilename(time.Now()),
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".zip") {
		dest += ".zip"
	}
	if err := os.WriteFile(dest, zipBytes, 0o600); err != nil {
		return "", err
	}
	return dest, nil
}

// ChooseBackupArchive opens a file dialog and describes the archive picked,
// without changing anything.
//
// Separate from RestoreBackup so the user is told what they are about to get
// and what it will displace before it happens. A restore replaces everything;
// an operation of that weight should not be one click from a file dialog.
func (a *App) ChooseBackupArchive() (*store.RestorePreview, error) {
	a.mu.RLock()
	st := a.store
	a.mu.RUnlock()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}

	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose a TERRA backup",
		Filters: []wruntime.FileFilter{
			{DisplayName: "ZIP archive", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // Cancelled.
	}

	preview, err := st.InspectBackup(path)
	if err != nil {
		return nil, err
	}
	preview.ArchivePath = path
	return preview, nil
}

/*
RestoreBackup replaces the local data with the archive at the given path.

The path comes from ChooseBackupArchive rather than from the frontend picking a
file itself, so the thing restored is the thing that was described.

The store is closed, replaced and reopened here. The database file is swapped
underneath the connection, and a connection held across that points at a file
that no longer exists -- so every later query would fail in a way that looks
like corruption rather than like a restore.
*/
func (a *App) RestoreBackup(archivePath string) (*store.RestoreResult, error) {
	if strings.TrimSpace(archivePath) == "" {
		return nil, errors.New("no backup was chosen")
	}

	a.mu.RLock()
	st := a.store
	a.mu.RUnlock()
	if st == nil {
		return nil, errors.New("the local store is not open")
	}

	// Checked again here, not only in the preview: the file may have been
	// replaced between describing it and restoring it, and this is the last
	// point at which refusing costs nothing.
	preview, err := st.InspectBackup(archivePath)
	if err != nil {
		return nil, err
	}
	if preview.Problem != "" {
		return nil, errors.New(preview.Problem)
	}

	// Closed before the swap. RestoreBackup renames the directory this
	// connection's file lives in.
	if err := st.Close(); err != nil {
		return nil, fmt.Errorf("closing the local store: %w", err)
	}

	result, restoreErr := st.RestoreBackup(archivePath)

	// Reopened whether or not the restore worked. A failed restore leaves the
	// previous data in place, and leaving the application with a closed store
	// would turn a recoverable failure into one that needs a relaunch.
	reopened, openErr := store.Open()
	if openErr != nil {
		if restoreErr != nil {
			return nil, restoreErr
		}
		return nil, fmt.Errorf("the data was restored but could not be reopened: %w", openErr)
	}
	a.mu.Lock()
	a.store = reopened
	// The session belonged to the replaced database. Restored accounts carry no
	// password hash, so there is nothing to be signed in as.
	a.currentUser = nil
	a.sessionToken = ""
	a.mu.Unlock()

	if restoreErr != nil {
		return nil, restoreErr
	}
	return result, nil
}

// ExportOverlayFile saves an overlay asset via SaveFileDialog.
// src may be a filesystem path or a data:image/png;base64,... URI.
func (a *App) ExportOverlayFile(src string, defaultFilename string) (string, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return "", errors.New("no overlay to export")
	}
	if strings.TrimSpace(defaultFilename) == "" {
		defaultFilename = "terra_overlay.png"
	}

	ext := strings.ToLower(filepath.Ext(defaultFilename))
	filters := []wruntime.FileFilter{
		{DisplayName: "PNG", Pattern: "*.png"},
		{DisplayName: "GeoTIFF", Pattern: "*.tif;*.tiff"},
	}
	switch ext {
	case ".tif", ".tiff":
		filters = []wruntime.FileFilter{
			{DisplayName: "GeoTIFF", Pattern: "*.tif;*.tiff"},
		}
	case ".png":
		filters = []wruntime.FileFilter{
			{DisplayName: "PNG", Pattern: "*.png"},
		}
	}

	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export overlay",
		DefaultFilename: defaultFilename,
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}

	if strings.HasPrefix(src, "data:") {
		raw, err := decodeDataURI(src)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(dest, raw, 0o644); err != nil {
			return "", err
		}
		return dest, nil
	}

	if _, err := os.Stat(src); err != nil {
		return "", fmt.Errorf("overlay file not found (re-apply or re-run to regenerate): %s", src)
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return "", err
	}
	return dest, nil
}

func decodeDataURI(uri string) ([]byte, error) {
	const marker = "base64,"
	i := strings.Index(uri, marker)
	if i < 0 {
		return nil, errors.New("unsupported data URI")
	}
	return base64.StdEncoding.DecodeString(uri[i+len(marker):])
}

func (a *App) persistRunIfLoggedIn(req backend.PredictRequest, res *backend.PredictResult) {
	a.persistAnalysis(req, res)
}

func (a *App) persistAnalysis(req backend.PredictRequest, res *backend.PredictResult) {
	a.mu.RLock()
	user := a.currentUser
	st := a.store
	a.mu.RUnlock()
	if st == nil || res == nil {
		return
	}
	userID := store.LocalUserID
	if user != nil {
		userID = user.ID
	}

	runID := uuid.NewString()
	assetsRel := filepath.Join("runs", runID)
	assetsDir := st.RunsDir(runID)
	_ = os.MkdirAll(assetsDir, 0o700)

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
	if rasterRel != "" {
		stored.RasterTIF = rasterRel
	} else {
		stored.RasterTIF = ""
	}
	resultBytes, _ := json.Marshal(stored)

	poly := ""
	if req.PolygonGeoJSON != nil {
		if b, err := json.Marshal(req.PolygonGeoJSON); err == nil {
			poly = string(b)
		}
	} else if req.AreaID != "" {
		poly = fmt.Sprintf(`{"area_id":%q}`, req.AreaID)
	}
	aoiLabel := strings.TrimSpace(req.Label)
	if aoiLabel == "" {
		aoiLabel = strings.TrimSpace(req.AreaID)
	}
	if aoiLabel == "" {
		aoiLabel = "Custom AOI"
	}
	runLabel := strings.TrimSpace(req.RunLabel)
	if runLabel == "" {
		runLabel = makeRunLabel(aoiLabel)
	}
	if !strings.HasPrefix(strings.ToLower(runLabel), "run-") {
		runLabel = "run-" + runLabel
	}
	summary, _ := json.Marshal(map[string]any{
		"class_stats":     res.ClassStats,
		"date_range":      res.DateRange,
		"n_dates":         res.NDates,
		"mean_confidence": res.MeanConfidence,
		"area_id":         req.AreaID,
		"aoi_label":       aoiLabel,
		"has_reference":   res.ReferenceURI != "",
		"has_ndvi_mean":   res.NDVIMeanURI != "",
		"has_true_color":  res.TrueColorURI != "",
	})

	_, _ = st.SaveRun(store.InferenceRun{
		ID:             runID,
		UserID:         userID,
		ModelKind:      req.ModelKind,
		PeriodStart:    req.Start,
		PeriodEnd:      req.End,
		PolygonGeoJSON: poly,
		Status:         "ok",
		SummaryJSON:    string(summary),
		ResultJSON:     string(resultBytes),
		OverlayRelPath: filepath.Join(assetsRel, "overlay.png"),
		AssetsRelPath:  assetsRel,
		NDates:         res.NDates,
		Label:          runLabel,
		ProjectID:      strings.TrimSpace(req.ProjectID),
	})
	if strings.TrimSpace(req.ProjectID) != "" {
		st.TouchProject(req.ProjectID)
	}
}

// ListRuns returns recent inference runs (signed-in user, or local guest).
func (a *App) ListRuns(limit int) ([]store.InferenceRun, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	return a.store.ListRuns(userID, limit)
}

// RunActivity returns the number of runs per calendar day over a trailing
// window, for the activity grid on the settings screen.
//
// Separate from ListRuns because that one caps at 100 rows and carries the full
// result payload on each: a year of activity read through it would show empty
// weeks that are not empty.
func (a *App) RunActivity(days int) ([]store.ActivityDay, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	return a.store.RunActivity(userID, days)
}

// LoadAnalysis restores a saved PredictResult (with image data URIs) by run id.
func (a *App) LoadAnalysis(runID string) (*backend.PredictResult, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	userID := store.LocalUserID
	if u != nil {
		userID = u.ID
	}
	run, err := a.store.GetRun(userID, runID)
	if err != nil {
		// Also try local bucket if signed-in user has no match (legacy local saves).
		if u != nil {
			run, err = a.store.GetRun(store.LocalUserID, runID)
		}
		if err != nil {
			return nil, mapStoreErr(err)
		}
	}
	assetsDir := a.store.RunsDir(run.ID)

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
		out := &backend.PredictResult{}
		switch meta.Product {
		case "solar_terrain":
			var t backend.SolarTerrainAnalysis
			_ = json.Unmarshal([]byte(run.ResultJSON), &t)
			if uri, err := store.ReadFileDataURI(
				filepath.Join(assetsDir, "solar_terrain.png"), "image/png",
			); err == nil {
				t.OverlayURI = uri
			}
			out.SolarTerrain = &t
		case "solar_siting":
			var st backend.SolarSitingAnalysis
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
			var e backend.EnergyModelAnalysis
			if run.ResultJSON != "" && run.ResultJSON != "{}" {
				_ = json.Unmarshal([]byte(run.ResultJSON), &e)
			}
			e.NormalizeNilSlices()
			out.EnergyModel = &e
		default:
			var solar backend.SolarAnalysis
			if run.ResultJSON != "" && run.ResultJSON != "{}" {
				_ = json.Unmarshal([]byte(run.ResultJSON), &solar)
			}
			out.Solar = &solar
		}
		return out, nil
	}

	// A wind run stores a WindAnalysis and no raster. Returned attached to an
	// otherwise empty result, the way a water run is, so the analysis view and
	// the export see it through the field a live run uses.
	if run.Kind == store.RunKindWind {
		var wind backend.WindAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &wind)
		}
		wind.NormalizeNilSlices()
		return &backend.PredictResult{Wind: &wind}, nil
	}

	if run.Kind == store.RunKindWater {
		var water backend.WaterAnalysis
		if run.ResultJSON != "" && run.ResultJSON != "{}" {
			_ = json.Unmarshal([]byte(run.ResultJSON), &water)
		}
		if uri, err := store.ReadFileDataURI(
			filepath.Join(assetsDir, "water_occurrence.png"), "image/png",
		); err == nil {
			water.OccurrenceURI = uri
		}
		return &backend.PredictResult{Water: &water}, nil
	}

	var res backend.PredictResult
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
			res.LULC = &backend.LULCAnalysis{MapURI: uri}
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
	return &res, nil
}

// GeocodeSearch resolves a place name to candidate locations (OSM Nominatim).
func (a *App) GeocodeSearch(query string) ([]backend.GeocodeResult, error) {
	return backend.Geocode(a.ctx, query)
}

// OpenExternal opens a URL in the system browser.
func (a *App) OpenExternal(url string) {
	wruntime.BrowserOpenURL(a.ctx, url)
}

// --- Auth / profile ---

func (a *App) requireStore() error {
	if a.store == nil {
		return errors.New("user store not available")
	}
	return nil
}

func (a *App) setSession(u *store.User, token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.currentUser = u
	a.sessionToken = token
}

func (a *App) clearSession() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.currentUser = nil
	a.sessionToken = ""
}

// Register creates a local account and starts a session.
func (a *App) Register(email, password, displayName string) (*store.User, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	u, token, err := a.store.Register(email, password, displayName)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.setSession(u, token)
	return u, nil
}

// Login authenticates and starts a session.
func (a *App) Login(email, password string) (*store.User, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	u, token, err := a.store.Login(email, password)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.setSession(u, token)
	return u, nil
}

// Logout ends the current session.
func (a *App) Logout() error {
	if a.store == nil {
		a.clearSession()
		return nil
	}
	a.mu.RLock()
	token := a.sessionToken
	a.mu.RUnlock()
	_ = a.store.Logout(token)
	a.clearSession()
	return nil
}

// CurrentUser returns the logged-in user, or nil.
func (a *App) CurrentUser() *store.User {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.currentUser
}

// UpdateProfile updates the display name.
func (a *App) UpdateProfile(displayName string) (*store.User, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	if u == nil {
		return nil, store.ErrUnauthorized
	}
	updated, err := a.store.UpdateProfile(u.ID, displayName)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// SetAvatar saves a profile photo from a browser data URI (data:image/...;base64,...).
func (a *App) SetAvatar(dataURI string) (*store.User, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	if u == nil {
		return nil, store.ErrUnauthorized
	}
	updated, err := a.store.SetAvatarFromDataURI(u.ID, dataURI)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// ClearAvatar removes the current user's profile photo.
func (a *App) ClearAvatar() (*store.User, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	if u == nil {
		return nil, store.ErrUnauthorized
	}
	updated, err := a.store.ClearAvatar(u.ID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// GetPreferences returns preferences for the logged-in user (or local guest).
func (a *App) GetPreferences() (*store.Preferences, error) {
	if err := a.requireStore(); err != nil {
		return nil, err
	}
	return a.store.GetPreferences(a.effectiveUserID())
}

// SavePreferences persists preferences for the logged-in user (or local guest).
func (a *App) SavePreferences(prefs store.Preferences) error {
	if err := a.requireStore(); err != nil {
		return err
	}
	prefs.UserID = a.effectiveUserID()
	return a.store.SavePreferences(prefs)
}

func mapStoreErr(err error) error {
	switch {
	case errors.Is(err, store.ErrEmailTaken):
		return errors.New("email already registered")
	case errors.Is(err, store.ErrInvalidCreds):
		return errors.New("invalid email or password")
	case errors.Is(err, store.ErrUnauthorized):
		return errors.New("not authenticated")
	case errors.Is(err, store.ErrInvalidInput):
		return errors.New("invalid input")
	case errors.Is(err, store.ErrNotFound):
		return errors.New("not found")
	default:
		return err
	}
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
