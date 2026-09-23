package analysis

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

/*
emitProgress is wails' EventsEmit behind one name.

The indirection exists so a Runner can be exercised outside a Wails context.
EventsEmit requires the specific context the lifecycle hooks hand out and calls
its fatal logger otherwise, which terminates the process -- so a test that runs
the real sidecar could not assert anything, and the sidecar boundary was
therefore covered only by tests that fed hand-written JSON to the parsers on
either side of it. Standardisation broke twice in exactly the gap those tests
leave.

Production behaviour is unchanged: this is EventsEmit under a variable.
*/
var emitProgress = func(ctx context.Context, event string, data ...any) {
	wruntime.EventsEmit(ctx, event, data...)
}

// Runner locates the repo, the Python interpreter, the model and the sidecar
// script, and runs inference requests.
type Runner struct {
	repoRoot   string // GeoSense repository root
	pythonPath string // Python interpreter (.venv/bin/python or TERRA_PYTHON)
	sidecar    string // path to sidecar/infer.py
	modelDir   string // path to the trained model directory
}

func hasSidecar(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "sidecar", "infer.py"))
	return err == nil
}

// resolveAppDir finds the directory that contains sidecar/, areas/, and model/.
// Order: TERRA_APP_DIR, provided appDir, macOS Contents/Resources, then
// parents of the executable.
func resolveAppDir(appDir string) string {
	if env := os.Getenv("TERRA_APP_DIR"); env != "" {
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

// resolvePython picks the interpreter: TERRA_PYTHON, the choice saved in the
// UI, bundled python/, repo .venv, then PATH.
//
// The saved choice sits second on purpose. It has to beat every heuristic
// below, because a user who picked an interpreter meant it -- but not the
// environment variable, so a developer can still override per run without
// editing a file the UI also writes.
//
// The last step is the dangerous one and is kept only as a last resort: PATH
// always answers something. A machine with no suitable Python still has a
// `python3`, so the chain never fails visibly -- it quietly selects an
// interpreter that cannot work and defers the error to the middle of an
// analysis. That is what the setup screen exists to replace.
func resolvePython(appDir, repoRoot, configured string) string {
	if env := os.Getenv("TERRA_PYTHON"); env != "" {
		return env
	}
	if configured != "" {
		if _, err := os.Stat(configured); err == nil {
			return configured
		}
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

// NewRunner resolves all required paths.
//
// appDir is the directory holding sidecar/, areas/ and model/, resolved from
// TERRA_APP_DIR, a candidate that actually contains sidecar/, or the value
// given. configuredPython is the interpreter chosen in the UI, empty when none
// has been; see resolvePython for where it sits in the order.
func NewRunner(appDir, configuredPython string) (*Runner, error) {
	appDir = resolveAppDir(appDir)

	repoRoot := filepath.Dir(appDir) // geosense-infer sits inside the repo
	// Packaged apps keep assets under Resources; treat that as the app root.
	if filepath.Base(appDir) == "Resources" {
		// …/TERRA.app/Contents/Resources → repoRoot stays Contents (unused for models)
		repoRoot = filepath.Dir(filepath.Dir(appDir))
	}
	if env := os.Getenv("TERRA_ROOT"); env != "" {
		repoRoot = env
	}

	python := resolvePython(appDir, repoRoot, configuredPython)

	sidecar := filepath.Join(appDir, "sidecar", "infer.py")

	// Model directory resolution (in order): TERRA_MODEL_DIR, the bundled
	// model/ directory inside the app (self-contained repo), or the legacy
	// training-output path in the research repo.
	modelDir := os.Getenv("TERRA_MODEL_DIR")
	if modelDir == "" {
		local := filepath.Join(appDir, "model")
		if _, err := os.Stat(filepath.Join(local, "rf_classifier.joblib")); err == nil {
			modelDir = local
		} else {
			modelDir = filepath.Join(repoRoot, "022026", "experiments", "output_mapbiomas", "model")
		}
	}

	// Earlier sessions' promoted exports and kept work directories, cleared
	// before this one starts adding to them. See sweepTempArtifacts for why
	// here and not at each promote.
	_ = sweepTempArtifacts(os.TempDir(), tempRetention)

	r := &Runner{
		repoRoot:   repoRoot,
		pythonPath: python,
		sidecar:    sidecar,
		modelDir:   modelDir,
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
	// Output collects stdout through a pipe of its own, and reads it to EOF:
	// an interpreter that hangs past the boot timeout holding that pipe would
	// otherwise keep the splash screen waiting on it with nothing to break in.
	cmd.WaitDelay = sidecarWaitDelay
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
	if os.Getenv("TERRA_PYTHON") != "" {
		src = "TERRA_PYTHON"
	}
	return fmt.Sprintf("sidecar ready · python %s (%s) · %s", ver, src, filepath.Base(r.sidecar)), nil
}

// SidecarPath is the script the runner executes, so callers can locate the
// directory that holds doctor.py beside it.
func (r *Runner) SidecarPath() string {
	if r == nil {
		return ""
	}
	return r.sidecar
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

// RepoRoot returns the resolved repository root, which is where the checked-out
// virtualenv and the fallback model directory are looked for.
//
// It used to be described as where the legacy MapBiomas rasters are looked up,
// and mapbiomasPath beside it did that lookup, resolving a raster by file name
// under global/data/mapbiomas. The three embedded example areas were the only
// callers and they were removed in 8ead8fa; the function outlived them with no
// caller anywhere, which is what golangci-lint's `unused` reported.
func (r *Runner) RepoRoot() string {
	if r == nil {
		return ""
	}
	return r.repoRoot
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

	/*
		A run is over the polygon it was given, and there is no second way in.

		This resolved either an embedded area -- A, B or C -- or a polygon. The
		embedded ones pinned two validated Parana tiles and a local MapBiomas
		raster; a drawn polygon got neither, and the comment here recorded that
		as "soja retention unavailable".

		Neither is a loss now. The tile filter left empty is what the STAC
		catalog wants: it returns whichever tile covers the ground, which is
		right for every field and was only ever right for those three by
		coincidence. And the MapBiomas reference is resolved by the sidecar from
		the polygon -- terra/mapbiomas.py falls back to fetching the Brazil COG
		window, and the classifier checks polygon_in_brazil before asking -- so
		the local raster was a shortcut, not the capability.
	*/
	if req.PolygonGeoJSON == nil {
		return nil, fmt.Errorf("no polygon provided")
	}
	polygon := req.PolygonGeoJSON
	tiles := req.Tiles
	mbPath := ""

	workDir, err := os.MkdirTemp("", "terra-run-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	// Kept, unlike most work directories here: the classification GeoTIFF is
	// copied out of it for export below, and when that copy fails the returned
	// RasterTIF is still the path inside this directory. A defer would turn a
	// failed promote into an Export button that opens nothing.
	// sweepTempArtifacts is what stops the directory from being permanent.

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

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
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
		Extent:         sres.Extent,
		OverlayURI:     overlayURI,
		ConfidenceURI:  confidenceURI,
		NDVIMeanURI:    ndviMeanURI,
		TrueColorURI:   trueColorURI,
		ReferenceURI:   referenceURI,
		RasterTIF:      sres.RasterTIF,
		MeanConfidence: sres.MeanConfidence,
		// Carried, and it was not. The sidecar computes 1/K and emits it, both
		// structs declare the field, and this literal simply never copied it --
		// so it marshalled away under omitempty and every consumer saw
		// undefined. The mean is unreadable without it: confidence is
		// max(predict_proba) and lives on [1/K, 1], so a mean of 0.37 against a
		// floor of 0.20 is a different statement from the same 0.37 on a scale
		// that starts at zero.
		ConfidenceFloor:   sres.ConfidenceFloor,
		NDates:            sres.NDates,
		DateRange:         sres.DateRange,
		PixelSizeM:        sres.PixelSizeM,
		ClassStats:        sres.ClassStats,
		ClassSpectra:      sres.ClassSpectra,
		LibraryLimit:      sres.LibraryLimit,
		Temporal:          sres.Temporal,
		VISeries:          sres.VISeries,
		VISeriesCrop:      sres.VISeriesCrop,
		CropPixelPct:      sres.CropPixelPct,
		Phenology:         sres.Phenology,
		PhenologyStates:   sres.PhenologyStates,
		LULC:              convertLULC(sres.LULC),
		DomainFingerprint: sres.DomainFingerprint,
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
		Agreement:             raw.Agreement,
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
	if req.PolygonGeoJSON == nil {
		return nil, fmt.Errorf("no polygon provided")
	}
	polygon = req.PolygonGeoJSON
	mbPath = req.MapBiomasPath // optional; sidecar fetches Brazil COG if empty
	// mbPath may be empty for custom polygons — Python fetches MapBiomas on demand.

	workDir, err := os.MkdirTemp("", "terra-lulc-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	// The MapBiomas PNG becomes a data URI in convertLULC and nothing that
	// leaves this function names workDir, so the directory was residue: one per
	// LULC analysis, kept for no reason and removed by nothing.
	defer os.RemoveAll(workDir)

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

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
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
	if req.PolygonGeoJSON == nil {
		return nil, fmt.Errorf("no polygon provided")
	}
	polygon = req.PolygonGeoJSON

	workDir, err := os.MkdirTemp("", "terra-cube-")
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

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
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
	if req.PolygonGeoJSON == nil {
		return nil, fmt.Errorf("no polygon provided")
	}
	polygon = req.PolygonGeoJSON

	stretch := req.StretchPct
	if len(stretch) != 2 {
		stretch = []float64{2, 98}
	}

	workDir, err := os.MkdirTemp("", "terra-comp-")
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

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
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

/*
stderrTail keeps the last few non-JSON lines the sidecar wrote.

The sidecar reports errors as {"error": ...} and the caller shows that. What it
cannot report that way is a crash: an unguarded import or any other uncaught
exception ends the process as a Python traceback on stderr, which parses as
nothing and was forwarded as progress -- then replaced by "sidecar failed: exit
status 1", a message that names neither the cause nor anywhere to look.

The tail is what turns that back into a diagnosis. Bounded, because a traceback
ends with the reason and the frames above it are noise.
*/
type stderrTail struct {
	mu    sync.Mutex
	lines []string
}

func (t *stderrTail) add(line string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lines = append(t.lines, line)
	if len(t.lines) > 6 {
		t.lines = t.lines[1:]
	}
}

// reason renders the tail as one line, or empty when nothing was captured.
func (t *stderrTail) reason() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.lines) == 0 {
		return ""
	}
	return strings.Join(t.lines, " · ")
}

// sidecarFailure explains a non-zero exit as well as the evidence allows.
//
// The structured error first, since the sidecar says what it means when it can.
// Then the tail, which is all that exists when the process died rather than
// reported. The bare exit status only when there is neither.
func sidecarFailure(waitErr error, lastError string, tail *stderrTail) error {
	if lastError != "" {
		return fmt.Errorf("%s", lastError)
	}
	if reason := tail.reason(); reason != "" {
		return fmt.Errorf("the analysis process stopped: %s", reason)
	}
	return fmt.Errorf("sidecar failed: %w", waitErr)
}

// pngToDataURI reads a PNG file and returns a base64 data URI.
func pngToDataURI(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

/*
What this program leaves in os.TempDir(), and for how long.

Two kinds of residue collect there. promoteExportFile copies a promoted GeoTIFF
into exportCacheDirName so its path survives the work directory it came out of,
and Predict keeps its entire work directory for the same reason. Nothing
removed either: every cleanup routine in this repository works inside the store
data directory, so the count only ever went up. macOS ages its temp directory
out and Linux has systemd-tmpfiles, but Windows sweeps nothing by default and
release.yml builds for Windows -- there, a full classification raster was kept
for good, once per analysis.

The retention protects the workflow, not the analysis. A result stays
exportable for as long as a window holds it, and a promoted raster is the only
copy of an unsaved run's GeoTIFF. Two weeks covers "run it now, export it when
the report is due" and still bounds the directory.
*/
const (
	exportCacheDirName = "terra-exports"
	tempRetention      = 14 * 24 * time.Hour
)

// keptWorkDirPrefixes are the os.MkdirTemp prefixes in this file whose
// directory deliberately outlives the call that created it. Every other prefix
// here is removed on return, so a sweep would never find one.
var keptWorkDirPrefixes = []string{
	"terra-run-",
}

/*
sweepTempArtifacts removes promoted exports and kept work directories older
than retention, and reports how many entries it removed.

It runs once when a Runner is built rather than on every promote, because at
that moment this session has produced no path at all: every candidate belongs
to an earlier run of the program, so the file the user is one click away from
exporting cannot be among them. A promote-time sweep would have to reason about
paths already handed to the interface to reach the same guarantee.

Errors are ignored throughout. An entry that cannot be read or removed -- a
second instance holding it open on Windows, another user's file in a shared
/tmp -- is left for the next boot, and none of that is worth failing a startup
over.
*/
func sweepTempArtifacts(tempDir string, retention time.Duration) int {
	cutoff := time.Now().Add(-retention)
	removed := 0

	remove := func(path string) {
		if os.RemoveAll(path) == nil {
			removed++
		}
	}
	stale := func(entry os.DirEntry) bool {
		info, err := entry.Info()
		return err == nil && info.ModTime().Before(cutoff)
	}

	cache := filepath.Join(tempDir, exportCacheDirName)
	if entries, err := os.ReadDir(cache); err == nil {
		for _, entry := range entries {
			if stale(entry) {
				remove(filepath.Join(cache, entry.Name()))
			}
		}
	}

	entries, err := os.ReadDir(tempDir)
	if err != nil {
		return removed
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		for _, prefix := range keptWorkDirPrefixes {
			if strings.HasPrefix(entry.Name(), prefix) && stale(entry) {
				remove(filepath.Join(tempDir, entry.Name()))
				break
			}
		}
	}
	return removed
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
	dir := filepath.Join(os.TempDir(), exportCacheDirName)
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
	if req.PolygonGeoJSON == nil {
		return nil, fmt.Errorf("no polygon provided")
	}
	polygon = req.PolygonGeoJSON

	maxCloud := req.MaxCloud
	if maxCloud <= 0 {
		maxCloud = 100
	}

	workDir, err := os.MkdirTemp("", "terra-water-")
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

/*
sidecarWaitDelay bounds Wait after the run is over -- the child has exited, or
its context was cancelled and it was killed -- and only its pipes are still
open. Without it Wait reads those pipes until EOF, and EOF does not arrive
while any process the sidecar orphaned still holds the inherited descriptor,
so the call never returns.

sidecarInactivityTimeout ends a run that has stopped talking. It is measured
from the last line the sidecar wrote and not from the start of the run: a
predict over a large AOI legitimately takes many minutes, and a total deadline
long enough to let that finish is too long to bound anything. What a working
run does is report each stage on stderr, so silence for this long is the
signal -- most often a Planetary Computer fetch with no timeout of its own.
*/
const (
	sidecarWaitDelay         = 5 * time.Second
	sidecarInactivityTimeout = 20 * time.Minute
)

/*
runSidecarJSON runs the sidecar with a marshalled request, relays its progress
events to the UI, and returns the stdout payload.

Every action reaches the sidecar through here. Four of them -- predict, lulc,
list_datacube, render_composite -- used to carry their own copy of this loop,
identical by intention rather than by anything holding them so: the 1 MB stderr
line limit, the "predict:progress" event name, and the stderrTail that turns a
bare exit status back into a reason each had to be edited in five places. A copy
missed in such an edit says nothing until the action carrying it is the one that
fails, which is the moment the diagnosis is needed.

What differs between the actions is the request and the shape of the reply, so
both stay with the caller: this takes marshalled bytes and hands back the raw
payload for the caller to unmarshal into whatever it expects.
*/
func (r *Runner) runSidecarJSON(ctx context.Context, reqBytes []byte) (string, error) {
	// A cancel of our own, because ctx is the Wails application context: it
	// lives as long as the window and is never cancelled, so the watchdog
	// below would have nothing to pull and a hung child nothing to stop it.
	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()

	cmd := exec.CommandContext(runCtx, r.pythonPath, r.sidecar)
	cmd.Stdin = strings.NewReader(string(reqBytes))
	// The line InspectPython sets, for the same reason and so that the two
	// agree. Without it the doctor answers for one import environment and the
	// analysis runs in another, which is how the environment screen came to
	// report ready for a run that could not import what it needed.
	cmd.Env = append(os.Environ(), "PYTHONNOUSERSITE=1")
	cmd.WaitDelay = sidecarWaitDelay

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

	var lastError string
	var readErr error
	var out strings.Builder
	var tail stderrTail

	// When either pipe last produced a line. Written by both readers and read
	// by the watchdog, hence atomic; a timer reset per line would be the same
	// value with a race around it.
	var lastOutput atomic.Int64
	lastOutput.Store(time.Now().UnixNano())
	var stalled atomic.Bool

	var wg sync.WaitGroup
	wg.Go(func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			lastOutput.Store(time.Now().UnixNano())
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
				// Kept, so a crash without a structured error can still say why.
				tail.add(line)
				emitProgress(ctx, "predict:progress", ProgressEvent{Progress: -1, Msg: line})
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
			emitProgress(ctx, "predict:progress", ProgressEvent{Progress: p, Msg: ev.Msg})
		}
		// Scan stops on error as well as at EOF. A traceback line over the
		// 1 MB cap is the one that happens, and it used to end the loop
		// indistinguishably from a clean exit; in the tail it at least says
		// why the frames stop where they do. A closed pipe is excluded because
		// that close is ours -- the teardown below -- and quoting it back would
		// report our own shutdown as the sidecar's last words.
		if err := scanner.Err(); err != nil && !errors.Is(err, os.ErrClosed) {
			tail.add("progress stream ended early: " + err.Error())
		}
		// Whatever ended the loop, the pipe still has to be emptied. A reader
		// that stops draining leaves the child blocked writing into a full
		// pipe buffer, and then it never exits and Wait never returns.
		_, _ = io.Copy(io.Discard, stderr)
	})

	wg.Go(func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		for scanner.Scan() {
			lastOutput.Store(time.Now().UnixNano())
			out.WriteString(scanner.Text())
		}
		// A payload over the 16 MB cap ends the loop with ErrTooLong. Left
		// unchecked it was reported as "sidecar produced no output", which
		// names the wrong problem: the analysis ran and answered, and the
		// answer was too large for the reader.
		readErr = scanner.Err()
		_, _ = io.Copy(io.Discard, stdout)
	})

	readers := make(chan struct{})
	go func() {
		wg.Wait()
		close(readers)
	}()

	go func() {
		tick := time.NewTicker(sidecarInactivityTimeout / 10)
		defer tick.Stop()
		for {
			select {
			case <-runCtx.Done():
				return
			case now := <-tick.C:
				if now.Sub(time.Unix(0, lastOutput.Load())) < sidecarInactivityTimeout {
					continue
				}
				stalled.Store(true)
				cancelRun()
				return
			}
		}
	}()

	abandoned := false
	select {
	case <-readers:
	case <-runCtx.Done():
		// Cancelled, by the watchdog or by the caller. Killing the child
		// normally closes the pipes and the readers end on their own; past
		// that we go on to Wait with them still running, because Wait closes
		// the parent ends and that is the only thing that unblocks a read
		// from a pipe an orphaned grandchild is still holding open.
		select {
		case <-readers:
		case <-time.After(sidecarWaitDelay):
			abandoned = true
		}
	}

	waitErr := cmd.Wait()

	// out, lastError and readErr belong to the reader goroutines until those
	// finish, so the two returns below are placed before anything reads them:
	// abandoned means they are still running. tail carries its own lock.
	//
	// The waitErr condition covers the race the watchdog can lose: a run whose
	// last stage is silent can exit on its own as the timer fires, and a
	// process that exited successfully has an answer worth returning.
	if stalled.Load() && waitErr != nil {
		msg := fmt.Sprintf("the analysis produced no output for %s and was stopped", sidecarInactivityTimeout)
		if reason := tail.reason(); reason != "" {
			msg += ": " + reason
		}
		return "", fmt.Errorf("%s", msg)
	}
	if abandoned {
		return "", fmt.Errorf("the analysis was stopped before its output could be read")
	}

	if waitErr != nil {
		return "", sidecarFailure(waitErr, lastError, &tail)
	}
	if readErr != nil {
		return "", fmt.Errorf("failed to read the sidecar's output: %w", readErr)
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

// AnalyzeDomainShift compares two cached domain fingerprints (KL / CVA / MMD / F1).
//
// No STAC re-fetch: both sides must already carry a fingerprint from classify.
func (r *Runner) AnalyzeDomainShift(ctx context.Context, req DomainShiftRequest) (*DomainShiftReport, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.FingerprintA == nil || req.FingerprintB == nil {
		return nil, fmt.Errorf("fingerprint_a and fingerprint_b are required")
	}

	workDir, err := os.MkdirTemp("", "terra-domain-shift-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	payload := map[string]any{
		"action":        "domain_shift",
		"model_dir":     r.modelDir,
		"work_dir":      workDir,
		"fingerprint_a": req.FingerprintA,
		"fingerprint_b": req.FingerprintB,
		"include_tsne":  req.IncludeTSNE,
	}
	if req.AgreementA != nil {
		payload["agreement_a"] = req.AgreementA
	}
	if req.AgreementB != nil {
		payload["agreement_b"] = req.AgreementB
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
		DomainShift *DomainShiftReport `json:"domain_shift"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse domain_shift result: %w", err)
	}
	if wrapped.DomainShift == nil {
		return nil, fmt.Errorf("sidecar returned empty domain_shift payload")
	}
	return wrapped.DomainShift, nil
}

// AnalyzeDomainShiftCohort measures one source fingerprint against N targets.
//
// One process for N-1 comparisons; see DomainShiftCohortRequest for why that
// matters. Same constraint as the pair: every side must already carry a
// fingerprint from classify, and nothing is re-fetched.
func (r *Runner) AnalyzeDomainShiftCohort(ctx context.Context, req DomainShiftCohortRequest) (*DomainShiftCohort, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if req.Source.Fingerprint == nil {
		return nil, fmt.Errorf("source fingerprint is required")
	}
	if len(req.Targets) == 0 {
		return nil, fmt.Errorf("at least one target is required")
	}
	for i, t := range req.Targets {
		if t.Fingerprint == nil {
			return nil, fmt.Errorf("target %d (%s) carries no fingerprint", i, t.Label)
		}
	}

	workDir, err := os.MkdirTemp("", "terra-domain-cohort-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	reqBytes, err := json.Marshal(map[string]any{
		"action":    "domain_shift_cohort",
		"model_dir": r.modelDir,
		"work_dir":  workDir,
		"source":    req.Source,
		"targets":   req.Targets,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}

	var wrapped struct {
		Cohort *DomainShiftCohort `json:"domain_shift_cohort"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse domain_shift_cohort result: %w", err)
	}
	if wrapped.Cohort == nil {
		return nil, fmt.Errorf("sidecar returned empty domain_shift_cohort payload")
	}
	return wrapped.Cohort, nil
}
