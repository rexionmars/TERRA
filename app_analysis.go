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
