package main

import (
	"errors"

	"geosense-infer/internal/analysis"
)

// The analyses the frontend asks for by name. Each method reads its arguments, calls the runner, and hands back
// what the sidecar returned; persisting what came back is app_runs.go and the
// files it wrote are app_storage.go.

// Predict runs the inference sidecar for the given request.
func (a *App) Predict(req analysis.PredictRequest) (*analysis.PredictResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.Predict(a.ctx, req)
	if err != nil {
		return nil, err
	}
	// Set after persisting, so the stored copy -- marshalled inside -- does not
	// carry a run's own id inside its own row. The frontend needs it to attach
	// compositions made while this run is on screen.
	res.RunID = a.persistAnalysis(req, res)
	return res, nil
}

// AnalyzeLULC runs descriptive MapBiomas land-cover / land-use analysis
// without Sentinel imagery. Embedded areas use local TIFFs; custom AOIs in
// Brazil fetch a MapBiomas Collection 10 COG window on demand.
func (a *App) AnalyzeLULC(req analysis.LULCRequest) (*analysis.LULCAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeLULC(a.ctx, req)
}

// ListDataCube inventories Sentinel-2 L2A scenes for the AOI (before Classify).
func (a *App) ListDataCube(req analysis.DataCubeRequest) (*analysis.DataCubeResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.ListDataCube(a.ctx, req)
}

// RenderComposite builds an RGB / false-color or spectral-index overlay for one scene.
func (a *App) RenderComposite(req analysis.CompositeRequest) (*analysis.CompositeResult, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.RenderComposite(a.ctx, req)
}

// AnalyzeSurfaceModel returns the Copernicus surface over one area.
//
// It does not persist a run. The other products record one because they are
// measurements a reader returns to and compares; this is the ground they were
// measured on, static and reproducible from the polygon alone, so a row would
// record nothing the request does not already say.
func (a *App) AnalyzeSurfaceModel(
	req analysis.SurfaceModelRequest,
) (*analysis.SurfaceModel, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeSurfaceModel(a.ctx, req)
}

// AnalyzeWater maps surface water over a period from spectral water indices.
// Descriptive: a thresholded index, with no model and no trained legend.
func (a *App) AnalyzeWater(req analysis.WaterRequest) (*analysis.WaterAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeWater(a.ctx, req)
	if err != nil {
		return nil, err
	}
	/*
		Stamped here, the way the classification path stamps its own.

		The field has existed on WaterAnalysis since it was written and had no
		writer anywhere, so it read as empty on every run and the frontend
		treated the product as unrecorded. `saveRun` withdraws its claim by
		returning "", which is exactly what the field's own comment says the
		empty value means.
	*/
	res.RunID = a.persistWaterRun(req, res)
	return res, nil
}

/*
savedRun is what one product contributes to a run row: the parts the writer
below cannot know.

Six products persist a run, and apart from these fields the path is one
sequence written six times. That is how it drifted: the "run-" prefix, the
trimmed project id and the area link each had to be added in every copy,
and the thumbnail column the classification path fills never reached any of
the others.
*/

// AnalyzeSolar computes the solar resource and photovoltaic yield at the AOI.
func (a *App) AnalyzeSolar(req analysis.SolarRequest) (*analysis.SolarAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolar(a.ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistSolarRun(req, res)
	return res, nil
}

// AnalyzeDomainShift compares two cached domain fingerprints for shift diagnosis.
func (a *App) AnalyzeDomainShift(req analysis.DomainShiftRequest) (*analysis.DomainShiftReport, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeDomainShift(a.ctx, req)
}

// AnalyzeDomainShiftCohort measures one source AOI against every target at once.
func (a *App) AnalyzeDomainShiftCohort(
	req analysis.DomainShiftCohortRequest,
) (*analysis.DomainShiftCohort, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeDomainShiftCohort(a.ctx, req)
}

// AnalyzeSolarTerrain maps plane-of-array irradiation over the AOI terrain.
func (a *App) AnalyzeSolarTerrain(req analysis.SolarTerrainRequest) (*analysis.SolarTerrainAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolarTerrain(a.ctx, req)
	if err != nil {
		return nil, err
	}
	/*
		The rendering is withheld from the payload that reaches the database.

		persistSolarRaster writes the PNG into the run's asset directory and
		LoadAnalysis reads it back from there, so a data URI left on the stored
		copy is the same image held twice -- once as base64 inside result_json
		and once as the file that base64 was decoded into. The classification
		and flood paths already withhold theirs and say so; these two did not,
		and on one installation the rows they wrote carried 512 KB of base64
		duplicating 452 KB of PNG already on disk.

		A copy rather than clearing the field on res: res is what the frontend
		is about to draw, and it needs the URI.
	*/
	stored := *res
	stored.OverlayURI = ""
	res.RunID = a.persistSolarRaster(req.PolygonGeoJSON, req.Label,
		req.RunLabel, req.ProjectID, req.AreaID, "solar_terrain", res.Season, &stored,
		res.OverlayURI, res.NDates())
	return res, nil
}

// AnalyzeSolarSiting classifies the AOI for fixed-tilt photovoltaic siting.
func (a *App) AnalyzeSolarSiting(req analysis.SolarSitingRequest) (*analysis.SolarSitingAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeSolarSiting(a.ctx, req)
	if err != nil {
		return nil, err
	}
	// Withheld from the stored copy for the reason AnalyzeSolarTerrain states.
	stored := *res
	stored.OverlayURI = ""
	res.RunID = a.persistSolarRaster(req.PolygonGeoJSON, req.Label,
		req.RunLabel, req.ProjectID, req.AreaID, "solar_siting", "siting", &stored,
		res.OverlayURI, 0)
	return res, nil
}

// AnalyzeEnergyModel runs the photovoltaic energy model over the AOI.
func (a *App) AnalyzeEnergyModel(req analysis.EnergyModelRequest) (*analysis.EnergyModelAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeEnergyModel(a.ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistEnergyModelRun(req, res)
	return res, nil
}

// AnalyzeWind screens the wind resource at the AOI.
func (a *App) AnalyzeWind(req analysis.WindRequest) (*analysis.WindAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeWind(a.ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistWindRun(req, res)
	return res, nil
}

func (a *App) AnalyzeFlood(req analysis.FloodRequest) (*analysis.FloodAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeFlood(a.ctx, req)
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistFloodRun(req, res)
	return res, nil
}

/*
AnalyzeFloodRouting routes a flow over the AOI: depth, speed and arrival.

DELIBERATELY NOT PERSISTED, unlike every analysis above it. This is a temporary
module and a run of it is a parameter sweep -- volume, peak, roughness, cell
size -- where the interesting object is the comparison between runs and not any
one of them. Persisting each would fill the run store with sweep members before
anyone has decided what a keepable run of this product even is. The result
lives as long as the panel holds it; that is the whole contract for now, and it
is why this returns no RunID while its neighbours do.
*/
func (a *App) AnalyzeFloodRouting(req analysis.FloodRoutingRequest) (*analysis.FloodRoutingAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.AnalyzeFloodRouting(a.ctx, req)
}

// floodProductIDs lists which DEM products the envelope was measured over, for
// the run row. The envelope is a property of the set, so a range listed without
// the set it spans is not attributable to anything.
func floodProductIDs(products []analysis.FloodProduct) []string {
	ids := make([]string, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.ID)
	}
	return ids
}
