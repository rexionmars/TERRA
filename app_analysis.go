package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/pyenv"

	"github.com/google/uuid"
)

// The analyses the frontend asks for by name, and the mesh route one of them
// serves. Each method reads its arguments, calls the runner, and hands back
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
	res.RunID = a.persistRunIfLoggedIn(req, res)
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

// BuildCanopyField returns the leaf-area-density field of one orchard module,
// together with the transmittances the GLSL march has to reproduce.
//
// Not persisted as a run: the field is a function of its parameters and costs
// under a second to rebuild, so storing it would keep a copy that the next
// change of spacing invalidates. The analyses that do get saved are the ones
// carrying a satellite acquisition nobody can reproduce on demand.
func (a *App) BuildCanopyField(req analysis.CanopyFieldRequest) (*analysis.CanopyField, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.BuildCanopyField(a.ctx, req)
}

// BuildCanopyFromAOI reads an AOI's own vegetation-index series as a canopy:
// LAI by date, the Helios age that carries it, and -- given a location -- what
// that canopy intercepts under the sun the cell actually received.
//
// Not persisted, for the reason the other two canopy calls give: it is a
// function of a saved run plus a sowing, and both are already recorded.
func (a *App) BuildCanopyFromAOI(req analysis.CanopyFromAOIRequest) (*analysis.CanopyFromAOI, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	return runner.BuildCanopyFromAOI(a.ctx, req)
}

// BuildCanopyMesh grows a stand of plants and returns it as glTF, for a reader
// who wants to see the canopy rather than a density that stands for it.
//
// Not persisted, for the reason BuildCanopyField gives, and for one more: the
// stand is deterministic in its seed, so the parameters are a smaller and more
// durable record of it than the megabytes of triangles they produce.
func (a *App) BuildCanopyMesh(req analysis.CanopyMeshRequest) (*analysis.CanopyMesh, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	mesh, err := runner.BuildCanopyMesh(a.ctx, req)
	if err != nil {
		return nil, err
	}

	/*
		The bytes are held here and the reply carries a URL instead.

		Returning them would put a base64 string of the whole mesh through the
		Wails bridge, which marshals every bound result to JSON. On WKWebView
		that is where "Maximum call stack size exceeded" is thrown -- inside the
		bridge, before any application JavaScript runs, which is why it survived
		being verified everywhere outside the webview.

		The id changes per build so the webview cannot serve a previous stand
		from cache, and each build is held under its own id rather than
		replacing the last -- see the field's comment for the race that made a
		single slot wrong.
	*/
	id := uuid.NewString()

	a.meshMu.Lock()
	if a.meshes == nil {
		a.meshes = make(map[string][]byte)
	}
	a.meshes[id] = mesh.Data
	a.meshOrder = append(a.meshOrder, id)
	for len(a.meshOrder) > maxHeldMeshes {
		delete(a.meshes, a.meshOrder[0])
		a.meshOrder = a.meshOrder[1:]
	}
	a.meshMu.Unlock()

	mesh.Data = nil
	mesh.URL = meshURLPrefix + id
	return mesh, nil
}

// The path the grown stand is served from. A prefix rather than a fixed name
// because the id changes per build, which is what keeps the webview from
// answering a fetch out of its cache with the previous canopy.
const meshURLPrefix = "/canopy-mesh/"

/*
meshMiddleware serves the last grown stand as bytes.

AssetServer middleware rather than its Handler, and the distinction is the whole
reason this works: Handler is consulted only when Assets reports the file
missing, and a single-page front end answers any unknown path with index.html
instead. A mesh request therefore came back as HTML and the loader reported
"Unrecognized token '<'". Middleware sits ahead of Assets, so this decides its
own route and passes everything else through untouched.
*/

func (a *App) meshMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, meshURLPrefix) {
			next.ServeHTTP(w, r)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, meshURLPrefix)

		a.meshMu.RLock()
		data, held := a.meshes[id]
		a.meshMu.RUnlock()

		// An id nobody is holding is one that has aged out, or one that was
		// never issued. Either way this must answer rather than fall through:
		// the asset server behind it replies to unknown paths with index.html,
		// and a loader handed HTML reports "Unrecognized token '<'".
		if id == "" || !held || len(data) == 0 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "model/gltf-binary")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		// The id is unique per build, so the bytes behind a URL never change.
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	})
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
	res.RunID = a.persistSolarRaster(req.PolygonGeoJSON, req.Label,
		req.RunLabel, req.ProjectID, req.AreaID, "solar_terrain", res.Season, res,
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
	res.RunID = a.persistSolarRaster(req.PolygonGeoJSON, req.Label,
		req.RunLabel, req.ProjectID, req.AreaID, "solar_siting", "siting", res,
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

/*
AnalyzeGridCurtailment reads the operational record over an area.

THE CONNECTION IS RESOLVED HERE AND NOT IN THE RUNNER. analysis.Runner holds
paths and nothing else -- it knows no data directory and no AppConfig -- and
keeping it that way means the DSN is decided in one place. gridDSN also encodes
the precedence the sidecar cannot: store.connect reads the request key BEFORE
the environment, so an unconditional send would make TERRA_BR_DSN dead.

NOT PERSISTED YET. Every other analysis here files a run row; this one does not,
because RunKindGrid and its summary do not exist. A row written under a kind no
reader branches on would list, summarise and reopen as a classification.
*/
func (a *App) AnalyzeGridCurtailment(
	req analysis.GridCurtailmentRequest,
) (*analysis.GridCurtailmentAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	if data := a.dataDir(); data != "" {
		req.StoreDSN = gridDSN(pyenv.LoadAppConfig(data))
	}
	return runner.AnalyzeGridCurtailment(a.ctx, req)
}

/*
AnalyzeGridCongestion reads the network an area could reach.

Sibling of AnalyzeGridCurtailment and resolves its connection the same way, for
the same reason: analysis.Runner holds paths and nothing else, so the DSN is
decided in one place and gridDSN encodes the precedence the sidecar cannot.
*/
func (a *App) AnalyzeGridCongestion(
	req analysis.GridCongestionRequest,
) (*analysis.GridCongestionAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	if data := a.dataDir(); data != "" {
		req.StoreDSN = gridDSN(pyenv.LoadAppConfig(data))
	}
	return runner.AnalyzeGridCongestion(a.ctx, req)
}

// AnalyzeGridFigure computes one analysis of the published research series.
//
// The connection is resolved here rather than in the runner, for the reason
// AnalyzeGridCurtailment gives: analysis.Runner holds paths and knows no
// AppConfig, and gridDSN encodes a precedence the sidecar cannot -- it reads
// the request key before the environment, so an unconditional send would make
// TERRA_BR_DSN dead.
func (a *App) AnalyzeGridFigure(
	req analysis.GridFigureRequest,
) (*analysis.GridFigureAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	if data := a.dataDir(); data != "" {
		req.StoreDSN = gridDSN(pyenv.LoadAppConfig(data))
	}
	return runner.AnalyzeGridFigure(a.ctx, req)
}
