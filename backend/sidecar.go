package backend

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Runner locates the repo, the Python interpreter, the model and the sidecar
// script, and runs inference requests.
type Runner struct {
	repoRoot   string // GeoSense repository root
	pythonPath string // Python interpreter (.venv/bin/python or GEOSENSE_PYTHON)
	sidecar    string // path to sidecar/infer.py
	modelDir   string // path to the trained model directory
	areasDir   string // path to embedded area GeoJSONs
}

func hasSidecar(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "sidecar", "infer.py"))
	return err == nil
}

// resolveAppDir finds the directory that contains sidecar/, areas/, and model/.
// Order: GEOSENSE_APP_DIR, provided appDir, macOS Contents/Resources, then
// parents of the executable.
func resolveAppDir(appDir string) string {
	if env := os.Getenv("GEOSENSE_APP_DIR"); env != "" {
		return env
	}
	if hasSidecar(appDir) {
		return appDir
	}
	exe, err := os.Executable()
	if err != nil {
		return appDir
	}
	dir := filepath.Dir(exe)
	// Packaged macOS: …/Contents/MacOS/Terra → …/Contents/Resources
	if filepath.Base(dir) == "MacOS" {
		res := filepath.Join(filepath.Dir(dir), "Resources")
		if hasSidecar(res) {
			return res
		}
	}
	for i := 0; i < 8; i++ {
		if hasSidecar(dir) {
			return dir
		}
		if filepath.Base(dir) == "Contents" {
			res := filepath.Join(dir, "Resources")
			if hasSidecar(res) {
				return res
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return appDir
}

// resolvePython picks the interpreter: GEOSENSE_PYTHON, bundled python/,
// repo .venv, then PATH.
func resolvePython(appDir, repoRoot string) string {
	if env := os.Getenv("GEOSENSE_PYTHON"); env != "" {
		return env
	}
	bundled := []string{
		filepath.Join(appDir, "python", "bin", "python3"),
		filepath.Join(appDir, "python", "bin", "python"),
		filepath.Join(appDir, "python", "python.exe"),
		filepath.Join(appDir, "python", "python"),
	}
	for _, c := range bundled {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	venvUnix := filepath.Join(repoRoot, ".venv", "bin", "python")
	venvWin := filepath.Join(repoRoot, ".venv", "Scripts", "python.exe")
	if runtime.GOOS == "windows" {
		if _, err := os.Stat(venvWin); err == nil {
			return venvWin
		}
		return "python"
	}
	if _, err := os.Stat(venvUnix); err == nil {
		return venvUnix
	}
	return "python3"
}

// NewRunner resolves all required paths. appDir is the directory of the running
// geosense-infer project (where sidecar/ and areas/ live). It is resolved from
// (in order): GEOSENSE_APP_DIR, a candidate that actually contains sidecar/, or
// the provided appDir.
func NewRunner(appDir string) (*Runner, error) {
	appDir = resolveAppDir(appDir)

	repoRoot := filepath.Dir(appDir) // geosense-infer sits inside the repo
	// Packaged apps keep assets under Resources; treat that as the app root.
	if filepath.Base(appDir) == "Resources" {
		// …/TERRA.app/Contents/Resources → repoRoot stays Contents (unused for models)
		repoRoot = filepath.Dir(filepath.Dir(appDir))
	}
	if env := os.Getenv("GEOSENSE_ROOT"); env != "" {
		repoRoot = env
	}

	python := resolvePython(appDir, repoRoot)

	sidecar := filepath.Join(appDir, "sidecar", "infer.py")
	areasDir := filepath.Join(appDir, "areas")

	// Model directory resolution (in order): GEOSENSE_MODEL_DIR, the bundled
	// model/ directory inside the app (self-contained repo), or the legacy
	// training-output path in the research repo.
	modelDir := os.Getenv("GEOSENSE_MODEL_DIR")
	if modelDir == "" {
		local := filepath.Join(appDir, "model")
		if _, err := os.Stat(filepath.Join(local, "rf_classifier.joblib")); err == nil {
			modelDir = local
		} else {
			modelDir = filepath.Join(repoRoot, "022026", "experiments", "output_mapbiomas", "model")
		}
	}

	r := &Runner{
		repoRoot:   repoRoot,
		pythonPath: python,
		sidecar:    sidecar,
		modelDir:   modelDir,
		areasDir:   areasDir,
	}
	return r, nil
}

// Probe checks that the Python interpreter runs and the sidecar script exists.
// Intentionally avoids importing infer.py (heavy deps) so boot stays fast.
func (r *Runner) Probe(ctx context.Context) (string, error) {
	if r == nil {
		return "", fmt.Errorf("runner not initialized")
	}
	if _, err := os.Stat(r.sidecar); err != nil {
		return "", fmt.Errorf("sidecar missing: %s", r.sidecar)
	}
	cmd := exec.CommandContext(ctx, r.pythonPath, "-c", "import sys; print(sys.version.split()[0], flush=True)")
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			return "", fmt.Errorf("%s", strings.TrimSpace(string(ee.Stderr)))
		}
		return "", err
	}
	ver := strings.TrimSpace(string(out))
	if ver == "" {
		return "", fmt.Errorf("empty python version")
	}
	src := "system"
	if strings.Contains(r.pythonPath, string(filepath.Separator)+"python"+string(filepath.Separator)) ||
		strings.HasSuffix(filepath.Dir(filepath.Dir(r.pythonPath)), "python") ||
		filepath.Base(filepath.Dir(r.pythonPath)) == "python" {
		src = "bundled"
	}
	if os.Getenv("GEOSENSE_PYTHON") != "" {
		src = "GEOSENSE_PYTHON"
	}
	return fmt.Sprintf("sidecar ready · python %s (%s) · %s", ver, src, filepath.Base(r.sidecar)), nil
}

// PythonPath returns the resolved interpreter path (for boot logs).
func (r *Runner) PythonPath() string {
	if r == nil {
		return ""
	}
	return r.pythonPath
}

// ModelDir returns the resolved model directory (for boot logs).
func (r *Runner) ModelDir() string {
	if r == nil {
		return ""
	}
	return r.modelDir
}

// ListAreas loads the embedded area GeoJSONs (A/B/C).
func (r *Runner) ListAreas() []Area {
	areas := []Area{}
	for _, id := range []string{"A", "B", "C"} {
		path := filepath.Join(r.areasDir, id+".geojson")
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var a Area
		if err := json.Unmarshal(data, &a); err != nil {
			continue
		}
		areas = append(areas, a)
	}
	return areas
}

// loadArea returns the embedded area by id, or false if missing.
func (r *Runner) loadArea(id string) (Area, bool) {
	for _, a := range r.ListAreas() {
		if a.ID == id {
			return a, true
		}
	}
	return Area{}, false
}

// mapbiomasPath returns the absolute path to a MapBiomas raster by file name.
func (r *Runner) mapbiomasPath(name string) string {
	if name == "" {
		return ""
	}
	p := filepath.Join(r.repoRoot, "global", "data", "mapbiomas", name)
	if _, err := os.Stat(p); err != nil {
		return ""
	}
	return p
}

// Predict runs the sidecar for the given request, emitting progress events.
func (r *Runner) Predict(ctx context.Context, req PredictRequest) (*PredictResult, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if _, err := os.Stat(r.modelDir); err != nil {
		return nil, fmt.Errorf("model directory not found at %s", r.modelDir)
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, fmt.Errorf("set the acquisition period (start and end dates)")
	}

	mode := req.Mode
	if mode == "" {
		mode = "single"
	}
	maxCloud := req.MaxCloud
	if maxCloud <= 0 {
		maxCloud = 100
	}
	modelKind := req.ModelKind
	if modelKind == "" {
		modelKind = "spectral"
	}
	prithviMode := req.PrithviMode
	if prithviMode == "" {
		prithviMode = "pixel"
	}

	// Resolve polygon and MapBiomas path. Embedded areas (A/B/C) use the
	// validated PR tiles and their MapBiomas reference; custom polygons leave the
	// tile filter empty so the STAC catalog returns whichever tile covers the
	// area, and have no MapBiomas reference (soja retention unavailable).
	var polygon *GeoJSONGeometry
	var mbPath string
	tiles := req.Tiles
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
		mbPath = r.mapbiomasPath(area.MapBiomas)
		if len(tiles) == 0 {
			tiles = []string{"T22JBT", "T21JZN"}
		}
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
		// tiles stays empty -> automatic tile selection in the sidecar.
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	workDir, err := os.MkdirTemp("", "geosense-run-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	sReq := sidecarRequest{
		ModelDir:       r.modelDir,
		Source:         "stac",
		Start:          req.Start,
		End:            req.End,
		MaxCloud:       maxCloud,
		MonthlyBest:    req.MonthlyBest,
		Tiles:          tiles,
		PolygonGeoJSON: polygon,
		MapBiomasPath:  mbPath,
		Mode:           mode,
		ModelKind:      modelKind,
		PrithviMode:    prithviMode,
		WorkDir:        workDir,
	}
	reqBytes, err := json.Marshal(sReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	cmd := exec.CommandContext(ctx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start sidecar: %w", err)
	}

	var wg sync.WaitGroup
	var lastError string

	// Stream stderr: one JSON object per line ({progress,msg} or {error}).
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Progress *int   `json:"progress"`
				Msg      string `json:"msg"`
				Error    string `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				// Non-JSON stderr (e.g. library warnings): forward as a message.
				wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
				continue
			}
			if ev.Error != "" {
				lastError = ev.Error
				continue
			}
			p := -1
			if ev.Progress != nil {
				p = *ev.Progress
			}
			wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
	}()

	// Read stdout (single JSON result).
	var out strings.Builder
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			out.WriteString(scanner.Text())
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()

	if waitErr != nil {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar failed: %w", waitErr)
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar produced no output")
	}

	var sres sidecarResult
	if err := json.Unmarshal([]byte(raw), &sres); err != nil {
		return nil, fmt.Errorf("failed to parse sidecar result: %w", err)
	}

	overlayURI, err := pngToDataURI(sres.OverlayPNG)
	if err != nil {
		return nil, fmt.Errorf("failed to read overlay: %w", err)
	}
	confidenceURI := ""
	if sres.ConfidencePNG != "" {
		if uri, cerr := pngToDataURI(sres.ConfidencePNG); cerr == nil {
			confidenceURI = uri
		}
	}
	ndviMeanURI := ""
	if sres.NDVIMeanPNG != "" {
		if uri, cerr := pngToDataURI(sres.NDVIMeanPNG); cerr == nil {
			ndviMeanURI = uri
		}
	}
	trueColorURI := ""
	if sres.TrueColorPNG != "" {
		if uri, cerr := pngToDataURI(sres.TrueColorPNG); cerr == nil {
			trueColorURI = uri
		}
	}
	referenceURI := ""
	if sres.ReferencePNG != "" {
		if uri, cerr := pngToDataURI(sres.ReferencePNG); cerr == nil {
			referenceURI = uri
		}
	}

	result := &PredictResult{
		Extent:          sres.Extent,
		OverlayURI:      overlayURI,
		ConfidenceURI:   confidenceURI,
		NDVIMeanURI:     ndviMeanURI,
		TrueColorURI:    trueColorURI,
		ReferenceURI:    referenceURI,
		RasterTIF:       sres.RasterTIF,
		MeanConfidence:  sres.MeanConfidence,
		NDates:          sres.NDates,
		DateRange:       sres.DateRange,
		ClassStats:      sres.ClassStats,
		Temporal:        sres.Temporal,
		VISeries:        sres.VISeries,
		Phenology:       sres.Phenology,
		PhenologyStates: sres.PhenologyStates,
		LULC:            convertLULC(sres.LULC),
	}
	if result.RasterTIF != "" {
		if p, perr := promoteExportFile(result.RasterTIF, "classification.tif"); perr == nil {
			result.RasterTIF = p
		}
	}
	if result.DateRange == nil {
		result.DateRange = []string{}
	}
	if result.ClassStats == nil {
		result.ClassStats = []ClassStat{}
	}
	if result.Temporal == nil {
		result.Temporal = []TemporalPoint{}
	}
	if result.VISeries == nil {
		result.VISeries = []VISeriesPoint{}
	}
	if result.PhenologyStates == nil {
		result.PhenologyStates = []PhenologyStatePoint{}
	}
	return result, nil
}

func convertLULC(raw *lulcSidecarPayload) *LULCAnalysis {
	if raw == nil {
		return nil
	}
	out := &LULCAnalysis{
		Year:                  raw.Year,
		Source:                raw.Source,
		Extent:                raw.Extent,
		Metrics:               raw.Metrics,
		Composition:           raw.Composition,
		Groups:                raw.Groups,
		PredVsRef:             raw.PredVsRef,
		ComparePixels:         raw.ComparePixels,
		CompareReferenceCells: raw.CompareReferenceCells,
	}
	if out.Composition == nil {
		out.Composition = []LULCClassRow{}
	}
	if out.Groups == nil {
		out.Groups = []LULCGroupRow{}
	}
	if out.PredVsRef == nil {
		out.PredVsRef = []LULCCompareRow{}
	}
	if raw.MapPNG != "" {
		if uri, err := pngToDataURI(raw.MapPNG); err == nil {
			out.MapURI = uri
		}
	}
	return out
}

// AnalyzeLULC runs descriptive MapBiomas land-cover / land-use analysis
// without Sentinel imagery or a classifier.
func (r *Runner) AnalyzeLULC(ctx context.Context, req LULCRequest) (*LULCAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}

	var polygon *GeoJSONGeometry
	var mbPath string
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
		mbPath = r.mapbiomasPath(area.MapBiomas)
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
		mbPath = req.MapBiomasPath // optional; sidecar fetches Brazil COG if empty
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}
	// mbPath may be empty for custom polygons — Python fetches MapBiomas on demand.

	workDir, err := os.MkdirTemp("", "geosense-lulc-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	sReq := sidecarRequest{
		Action:         "lulc",
		ModelDir:       r.modelDir, // unused for lulc, but kept for schema
		PolygonGeoJSON: polygon,
		MapBiomasPath:  mbPath,
		WorkDir:        workDir,
	}
	reqBytes, err := json.Marshal(sReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	cmd := exec.CommandContext(ctx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start sidecar: %w", err)
	}

	var wg sync.WaitGroup
	var lastError string

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Progress *int   `json:"progress"`
				Msg      string `json:"msg"`
				Error    string `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
				continue
			}
			if ev.Error != "" {
				lastError = ev.Error
				continue
			}
			p := -1
			if ev.Progress != nil {
				p = *ev.Progress
			}
			wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
	}()

	var out strings.Builder
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			out.WriteString(scanner.Text())
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()
	if waitErr != nil {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar failed: %w", waitErr)
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar produced no output")
	}

	var wrapped struct {
		LULC *lulcSidecarPayload `json:"lulc"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse LULC result: %w", err)
	}
	if wrapped.LULC == nil {
		return nil, fmt.Errorf("sidecar returned empty LULC payload")
	}
	return convertLULC(wrapped.LULC), nil
}

// ListDataCube queries Planetary Computer STAC for scenes covering the AOI
// (same filters as Predict) without running classification.
func (r *Runner) ListDataCube(ctx context.Context, req DataCubeRequest) (*DataCubeResult, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, fmt.Errorf("set the acquisition period (start and end dates)")
	}

	maxCloud := req.MaxCloud
	if maxCloud <= 0 {
		maxCloud = 100
	}

	var polygon *GeoJSONGeometry
	tiles := req.Tiles
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
		if len(tiles) == 0 {
			tiles = []string{"T22JBT", "T21JZN"}
		}
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	workDir, err := os.MkdirTemp("", "geosense-cube-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	sReq := sidecarRequest{
		Action:         "list_datacube",
		ModelDir:       r.modelDir,
		Source:         "stac",
		Start:          req.Start,
		End:            req.End,
		MaxCloud:       maxCloud,
		MonthlyBest:    req.MonthlyBest,
		Tiles:          tiles,
		PolygonGeoJSON: polygon,
		WorkDir:        workDir,
	}
	reqBytes, err := json.Marshal(sReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	cmd := exec.CommandContext(ctx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start sidecar: %w", err)
	}

	var wg sync.WaitGroup
	var lastError string

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Progress *int   `json:"progress"`
				Msg      string `json:"msg"`
				Error    string `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
				continue
			}
			if ev.Error != "" {
				lastError = ev.Error
				continue
			}
			p := -1
			if ev.Progress != nil {
				p = *ev.Progress
			}
			wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
	}()

	var out strings.Builder
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			out.WriteString(scanner.Text())
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()
	if waitErr != nil {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar failed: %w", waitErr)
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar produced no output")
	}

	var result DataCubeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, fmt.Errorf("failed to parse data cube result: %w", err)
	}
	if result.Scenes == nil {
		result.Scenes = []DataCubeScene{}
	}
	return &result, nil
}

// RenderComposite builds an RGB or index PNG overlay for one STAC scene.
func (r *Runner) RenderComposite(ctx context.Context, req CompositeRequest) (*CompositeResult, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if strings.TrimSpace(req.SceneID) == "" {
		return nil, fmt.Errorf("select a scene first")
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, fmt.Errorf("set the acquisition period (start and end dates)")
	}

	maxCloud := req.MaxCloud
	if maxCloud <= 0 {
		maxCloud = 100
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "rgb"
	}

	var polygon *GeoJSONGeometry
	tiles := req.Tiles
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
		if len(tiles) == 0 {
			tiles = []string{"T22JBT", "T21JZN"}
		}
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	stretch := req.StretchPct
	if len(stretch) != 2 {
		stretch = []float64{2, 98}
	}

	workDir, err := os.MkdirTemp("", "geosense-comp-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	sReq := sidecarRequest{
		Action:         "render_composite",
		ModelDir:       r.modelDir,
		Source:         "stac",
		Start:          req.Start,
		End:            req.End,
		MaxCloud:       maxCloud,
		MonthlyBest:    req.MonthlyBest,
		Tiles:          tiles,
		PolygonGeoJSON: polygon,
		WorkDir:        workDir,
		SceneID:        req.SceneID,
		Kind:           kind,
		Bands:          req.Bands,
		Index:          req.Index,
		StretchPct:     stretch,
	}
	reqBytes, err := json.Marshal(sReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	cmd := exec.CommandContext(ctx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start sidecar: %w", err)
	}

	var wg sync.WaitGroup
	var lastError string

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Progress *int   `json:"progress"`
				Msg      string `json:"msg"`
				Error    string `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
				continue
			}
			if ev.Error != "" {
				lastError = ev.Error
				continue
			}
			p := -1
			if ev.Progress != nil {
				p = *ev.Progress
			}
			wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
	}()

	var out strings.Builder
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			out.WriteString(scanner.Text())
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()
	if waitErr != nil {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar failed: %w", waitErr)
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		if lastError != "" {
			return nil, fmt.Errorf("%s", lastError)
		}
		return nil, fmt.Errorf("sidecar produced no output")
	}

	var wrapped struct {
		Extent     Bounds         `json:"extent"`
		OverlayPNG string         `json:"overlay_png"`
		RasterTIF  string         `json:"raster_tif"`
		Meta       map[string]any `json:"meta"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse composite result: %w", err)
	}
	if wrapped.OverlayPNG == "" {
		return nil, fmt.Errorf("sidecar returned empty composite overlay")
	}
	uri, err := pngToDataURI(wrapped.OverlayPNG)
	if err != nil {
		return nil, fmt.Errorf("failed to encode composite PNG: %w", err)
	}
	rasterTIF := ""
	if wrapped.RasterTIF != "" {
		if p, perr := promoteExportFile(wrapped.RasterTIF, "composite.tif"); perr == nil {
			rasterTIF = p
		}
	}
	return &CompositeResult{
		Extent:     wrapped.Extent,
		OverlayURI: uri,
		RasterTIF:  rasterTIF,
		Meta:       wrapped.Meta,
	}, nil
}

// pngToDataURI reads a PNG file and returns a base64 data URI.
func pngToDataURI(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

// promoteExportFile copies a sidecar work-dir asset to a durable cache so the
// path remains valid after the temporary work directory is removed.
func promoteExportFile(src, basename string) (string, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return "", fmt.Errorf("empty export source")
	}
	if _, err := os.Stat(src); err != nil {
		return "", err
	}
	dir := filepath.Join(os.TempDir(), "geosense-exports")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, fmt.Sprintf("%d-%s", time.Now().UnixNano(), basename))
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		return "", err
	}
	return dest, nil
}

// AnalyzeWater maps surface water over a period from spectral water indices.
//
// Descriptive: the result is a thresholded index, so it carries none of the
// fixed-legend domain-shift limitation that applies to the classifier.
func (r *Runner) AnalyzeWater(ctx context.Context, req WaterRequest) (*WaterAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if strings.TrimSpace(req.Start) == "" || strings.TrimSpace(req.End) == "" {
		return nil, fmt.Errorf("set the acquisition period (start and end dates)")
	}

	var polygon *GeoJSONGeometry
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	maxCloud := req.MaxCloud
	if maxCloud <= 0 {
		maxCloud = 100
	}

	workDir, err := os.MkdirTemp("", "geosense-water-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	// The occurrence PNG is read into a data URI before this returns, so the
	// directory is not needed afterwards.
	defer os.RemoveAll(workDir)

	sReq := sidecarRequest{
		Action:         "water",
		ModelDir:       r.modelDir, // unused here, kept for schema
		PolygonGeoJSON: polygon,
		Start:          req.Start,
		End:            req.End,
		MaxCloud:       maxCloud,
		MonthlyBest:    req.MonthlyBest,
		Index:          req.Index,
		WorkDir:        workDir,
	}
	reqBytes, err := json.Marshal(sReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}

	var wrapped struct {
		Water *waterSidecarPayload `json:"water"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse water result: %w", err)
	}
	if wrapped.Water == nil {
		return nil, fmt.Errorf("sidecar returned empty water payload")
	}
	return convertWater(wrapped.Water), nil
}

func convertWater(raw *waterSidecarPayload) *WaterAnalysis {
	if raw == nil {
		return nil
	}
	out := &WaterAnalysis{
		Index:            raw.Index,
		ThresholdMethod:  raw.ThresholdMethod,
		ThresholdFixed:   raw.ThresholdFixed,
		OtsuClip:         raw.OtsuClip,
		NDates:           raw.NDates,
		DateRange:        raw.DateRange,
		AOIPixels:        raw.AOIPixels,
		AOIAreaHa:        raw.AOIAreaHa,
		Series:           raw.Series,
		PeakDate:         raw.PeakDate,
		PeakWaterPct:     raw.PeakWaterPct,
		EphemeralPixels:  raw.EphemeralPixels,
		EphemeralAreaHa:  raw.EphemeralAreaHa,
		PersistentPixels: raw.PersistentPixels,
		PersistentAreaHa: raw.PersistentAreaHa,
		MeanAnomaly:      raw.MeanAnomaly,
		Extent:           raw.Extent,
	}
	if out.Series == nil {
		out.Series = []WaterDate{}
	}
	if out.DateRange == nil {
		out.DateRange = []string{}
	}
	if raw.OccurrencePNG != "" {
		if uri, err := pngToDataURI(raw.OccurrencePNG); err == nil {
			out.OccurrenceURI = uri
		}
	}
	return out
}

// runSidecarJSON runs the sidecar with a marshalled request, relaying progress
// events to the UI, and returns its stdout payload. Shared by the actions whose
// only difference is the request and the shape they unmarshal.
func (r *Runner) runSidecarJSON(ctx context.Context, reqBytes []byte) (string, error) {
	cmd := exec.CommandContext(ctx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start sidecar: %w", err)
	}

	var wg sync.WaitGroup
	var lastError string

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Progress *int   `json:"progress"`
				Msg      string `json:"msg"`
				Error    string `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
				continue
			}
			if ev.Error != "" {
				lastError = ev.Error
				continue
			}
			p := -1
			if ev.Progress != nil {
				p = *ev.Progress
			}
			wruntime.EventsEmit(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
	}()

	var out strings.Builder
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			out.WriteString(scanner.Text())
		}
	}()

	wg.Wait()
	if waitErr := cmd.Wait(); waitErr != nil {
		if lastError != "" {
			return "", fmt.Errorf("%s", lastError)
		}
		return "", fmt.Errorf("sidecar failed: %w", waitErr)
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		if lastError != "" {
			return "", fmt.Errorf("%s", lastError)
		}
		return "", fmt.Errorf("sidecar produced no output")
	}
	return raw, nil
}

// AnalyzeSolar computes the solar resource and photovoltaic yield at the AOI.
//
// Unlike every Sentinel-2 product it needs no scene, so it cannot fail on
// availability, and it carries no trained legend.
func (r *Runner) AnalyzeSolar(ctx context.Context, req SolarRequest) (*SolarAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}

	var polygon *GeoJSONGeometry
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	workDir, err := os.MkdirTemp("", "geosense-solar-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	payload := map[string]any{
		"action":            "solar_resource",
		"model_dir":         r.modelDir, // unused here, kept for schema
		"polygon_geojson":   polygon,
		"climatology_years": req.ClimatologyYears,
		"hourly_years":      req.HourlyYears,
		"surface_azimuth":   req.SurfaceAzimuth,
		"work_dir":          workDir,
	}
	if req.PerformanceRatio != nil {
		payload["performance_ratio"] = *req.PerformanceRatio
	}
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}

	var wrapped struct {
		Solar *SolarAnalysis `json:"solar"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse solar result: %w", err)
	}
	if wrapped.Solar == nil {
		return nil, fmt.Errorf("sidecar returned empty solar payload")
	}
	return wrapped.Solar, nil
}

// AnalyzeSolarTerrain maps plane-of-array irradiation over the AOI terrain.
func (r *Runner) AnalyzeSolarTerrain(ctx context.Context, req SolarTerrainRequest) (*SolarTerrainAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	var polygon *GeoJSONGeometry
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	workDir, err := os.MkdirTemp("", "geosense-solar-terrain-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	reqBytes, err := json.Marshal(map[string]any{
		"action":          "solar_terrain",
		"model_dir":       r.modelDir,
		"polygon_geojson": polygon,
		"hourly_years":    req.HourlyYears,
		"season":          req.Season,
		"work_dir":        workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Terrain *solarTerrainSidecarPayload `json:"solar_terrain"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse solar terrain result: %w", err)
	}
	if wrapped.Terrain == nil {
		return nil, fmt.Errorf("sidecar returned empty solar terrain payload")
	}
	t := wrapped.Terrain
	out := &SolarTerrainAnalysis{
		POAMin: t.POAMin, POAMax: t.POAMax, POAMean: t.POAMean,
		POAStdPct: t.POAStdPct, SlopeMeanDeg: t.SlopeMeanDeg,
		SlopeMaxDeg: t.SlopeMaxDeg, Pixels: t.Pixels,
		HourlyYears: t.HourlyYears, DEMSource: t.DEMSource,
		Season: t.Season, Unit: t.Unit, Extent: t.Extent,
	}
	if uri, err := pngToDataURI(t.OverlayPNG); err == nil {
		out.OverlayURI = uri
	}
	// The GeoTIFF stays on disk for export, so the work dir is not removed here.
	out.RasterTIF = t.RasterTIF
	return out, nil
}

// AnalyzeSolarSiting classifies the AOI for fixed-tilt photovoltaic siting.
func (r *Runner) AnalyzeSolarSiting(ctx context.Context, req SolarSitingRequest) (*SolarSitingAnalysis, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	var polygon *GeoJSONGeometry
	if req.AreaID != "" {
		area, ok := r.loadArea(req.AreaID)
		if !ok {
			return nil, fmt.Errorf("unknown area: %s", req.AreaID)
		}
		geom := area.Geometry
		polygon = &geom
	} else if req.PolygonGeoJSON != nil {
		polygon = req.PolygonGeoJSON
	} else {
		return nil, fmt.Errorf("no area or polygon provided")
	}

	workDir, err := os.MkdirTemp("", "geosense-solar-siting-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}

	reqBytes, err := json.Marshal(map[string]any{
		"action":                "solar_siting",
		"model_dir":             r.modelDir,
		"polygon_geojson":       polygon,
		"slope_acceptable_deg":  req.SlopeAcceptableDeg,
		"slope_restrictive_deg": req.SlopeRestrictiveDeg,
		"excluded_cover":        req.ExcludedCover,
		"cropland_cover":        req.CroplandCover,
		"work_dir":              workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Siting *solarSitingSidecarPayload `json:"solar_siting"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse solar siting result: %w", err)
	}
	if wrapped.Siting == nil {
		return nil, fmt.Errorf("sidecar returned empty solar siting payload")
	}
	p := wrapped.Siting
	out := &SolarSitingAnalysis{
		Classes:              p.Classes,
		SuitableNoConflictHa: p.SuitableNoConflictHa,
		SuitableCroplandHa:   p.SuitableCroplandHa,
		PixelAreaHa:          p.PixelAreaHa,
		Thresholds:           p.Thresholds,
		DEMSource:            p.DEMSource,
		RasterTIF:            p.RasterTIF,
		Extent:               p.Extent,
	}
	if out.Classes == nil {
		out.Classes = []SolarSitingClass{}
	}
	if uri, err := pngToDataURI(p.OverlayPNG); err == nil {
		out.OverlayURI = uri
	}
	return out, nil
}
