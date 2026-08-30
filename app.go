package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/geocode"
	"geosense-infer/internal/pyenv"
	"geosense-infer/internal/store"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// The application struct the frontend is bound to, and what it takes to get
// one running: the boot sequence, the log the splash reads, and the two
// handles -- the sidecar runner and the local store -- every method reaches
// through.
//
// What it does NOT hold, and why it is worth saying: the methods the frontend
// calls are in app_analysis.go, app_runs.go, app_storage.go, app_session.go,
// app_projects.go and app_whiteboards.go. This file held all of them, 67
// declarations over seven subjects, and a reader looking for how a run is
// saved had to find it among sign-in and window management.

// App is the application struct bound to the frontend.
type App struct {
	ctx    context.Context
	runner *analysis.Runner
	store  *store.Store

	mu           sync.RWMutex
	sessionToken string
	currentUser  *store.User

	envBuilder  pyenv.EnvBuilder
	bootMu      sync.Mutex
	bootLogs    []string
	bootStarted time.Time

	/*
		Grown meshes waiting to be fetched, keyed by the id in their URL.

		A single slot was the first shape and it was wrong: the canopy editor is
		deliberately not marked unique -- BoardSurface's own comment says two
		areas holding it "describe two orchards, which is a comparison worth
		having" -- and every instance grows once on mount. Two of them race, the
		second build overwrites the id the first was handed, and the first area
		fetches a URL that no longer matches and gets a 404 it cannot recover
		from without pressing Grow again. The same race fires inside one area
		whenever a regrow is issued while the previous body is still streaming.

		Bounded because the entries are megabytes: the oldest is dropped once
		more than a few are held, which is far more than the number of canopy
		areas anyone opens and still cannot grow without limit.
	*/
	meshMu    sync.RWMutex
	meshes    map[string][]byte
	meshOrder []string
}

// How many grown meshes are kept fetchable at once. Each is single-digit
// megabytes, and a fetch follows its build within a frame or two, so this only
// has to cover concurrent areas and one regrow racing its own predecessor.
const maxHeldMeshes = 4

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
func (a *App) currentRunner() *analysis.Runner {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.runner
}

/*
currentStore is the store as it stands right now, or nil when there is none.

The same argument as currentRunner, with a second failure of its own. a.store
is written while a restore swaps the database out from under it, and every
bound method runs on its own goroutine, so a bare read races that write.

The shape matters as much as the lock. The guard this replaced tested a.store
and left the caller to dereference a.store again, which is two reads of a field
that can change between them: the test could pass and the dereference still
find nil. Callers take the pointer once and work through that.

nil covers both no store and a store part-way through being replaced, which are
the same thing to a caller: nothing to query.
*/
func (a *App) currentStore() *store.Store {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.store
}

// requireStore is currentStore for the bindings that all answer the same way
// when there is no store to reach.
func (a *App) requireStore() (*store.Store, error) {
	st := a.currentStore()
	if st == nil {
		return nil, errors.New("user store not available")
	}
	return st, nil
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
	// Under the lock, for the reason set out on the runner assignment below:
	// a field guarded in one place and bare in another reads as one that is
	// safe to touch bare.
	a.mu.Lock()
	a.store = st
	a.mu.Unlock()
	a.bootLog("store ready")

	cfg := pyenv.LoadAppConfig(st.DataDir())
	a.bootLog("resolving sidecar paths…")
	runner, err := analysis.NewRunner(appDir, cfg.PythonPath)
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

	/*
		How long the splash is held when the boot finishes sooner.

		This was five seconds, held so it "reads as a real boot screen" while
		logging "warming up…" over no work at all -- opening SQLite, resolving
		paths and asking an interpreter its version take a fraction of that.
		With the fade and reveal after it, every launch cost about 5.6 seconds
		of watching a screen that had finished.

		Three seconds is the deliberate choice: long enough to read the release
		name and see the still it is named for, short enough that nobody is
		waiting on it. The Ken Burns pan is timed against this -- see
		.splash-kenburns in index.css.
	*/
	const minSplash = 3 * time.Second
	if a.bootStarted.IsZero() {
		a.bootStarted = time.Now()
	}
	if wait := minSplash - time.Since(a.bootStarted); wait > 0 {
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

// The two files a flood run keeps in its assets directory. Named in one place
// because the persist path writes them and LoadAnalysis reads them, and a run
// whose writer and reader disagree on a file name reopens without its raster.
const (
	floodAgreementPNG = "flood_agreement.png"
	floodAgreementTIF = "flood_agreement.tif"
)

// GeocodeSearch resolves a place name to candidate locations (OSM Nominatim).
func (a *App) GeocodeSearch(query string) ([]geocode.GeocodeResult, error) {
	return geocode.Geocode(a.ctx, query)
}

// OpenExternal opens a URL in the system browser.
func (a *App) OpenExternal(url string) {
	wruntime.BrowserOpenURL(a.ctx, url)
}

// --- Auth / profile ---
