package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/credential"
	"geosense-infer/internal/pyenv"
)

// The mineral map and the one credential it needs. Kept apart from
// app_analysis.go because it is the only product that reads data behind a
// login, and the token's precedence, storage and verification are its own
// subject.

// AnalyzeMinerals maps surface mineralogy over an area from EMIT reflectance.
func (a *App) AnalyzeMinerals(req analysis.MineralRequest) (*analysis.MineralAnalysis, error) {
	return a.analyzeMinerals(a.ctx, req)
}

// analyzeMinerals is AnalyzeMinerals under a context of the caller's; see
// predict in app_analysis.go.
func (a *App) analyzeMinerals(ctx context.Context, req analysis.MineralRequest) (*analysis.MineralAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeMinerals(ctx, req, earthdataToken(a.appConfig()))
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistMineralRun(req, res)
	return res, nil
}

func (a *App) appConfig() pyenv.AppConfig {
	data := a.dataDir()
	if data == "" {
		return pyenv.AppConfig{}
	}
	return pyenv.LoadAppConfig(data)
}

/*
savedEarthdataToken is the token saved in this installation, and where.

The platform's credential store is asked first (internal/credential). The
settings file is read after it, for a system with no store and for a token
saved there before the store was used, which migrateEarthdataToken moves at
startup. where is "store", "file" or "" when nothing is saved.
*/
func savedEarthdataToken(cfg pyenv.AppConfig) (token, where string) {
	if t, err := credential.EarthdataToken(); err == nil && t != "" {
		return t, "store"
	}
	if t := strings.TrimSpace(cfg.EarthdataToken); t != "" {
		return t, "file"
	}
	return "", ""
}

/*
earthdataToken is the token to hand the sidecar, or empty when the sidecar
should read the one it inherits.

The variable wins when it is set, as TERRA_PYTHON does: a developer switching
accounts per shell should not have to edit a file the UI also writes.
Returning empty is how the inherited variable is left to apply, because
runSidecarJSONEnv appends after os.Environ() and a later duplicate would
otherwise replace it.
*/
func earthdataToken(cfg pyenv.AppConfig) string {
	if os.Getenv(analysis.EarthdataTokenEnv) != "" {
		return ""
	}
	token, _ := savedEarthdataToken(cfg)
	return token
}

// EarthdataStatus says whether EMIT data can be requested, and what decided it.
type EarthdataStatus struct {
	Configured bool `json:"configured"`
	// "EARTHDATA_TOKEN" when the variable applies, "chosen" when the saved
	// token does, "none" otherwise.
	Source string `json:"source"`
	// Where a saved token is kept, in the reader's words: the platform's
	// credential store by name, or the settings file on a system without one.
	// Empty when none is saved.
	Store string `json:"store"`
}

func earthdataStatus(cfg pyenv.AppConfig) EarthdataStatus {
	_, where := savedEarthdataToken(cfg)
	store := ""
	switch where {
	case "store":
		store = credential.StoreName()
	case "file":
		store = "the settings file"
	}
	switch {
	case os.Getenv(analysis.EarthdataTokenEnv) != "":
		return EarthdataStatus{Configured: true, Source: analysis.EarthdataTokenEnv, Store: store}
	case where != "":
		return EarthdataStatus{Configured: true, Source: "chosen", Store: store}
	default:
		return EarthdataStatus{Configured: false, Source: "none"}
	}
}

// GetEarthdataStatus reports whether a token is set. It never returns the
// token itself: the interface has no reason to hold it once it is saved.
func (a *App) GetEarthdataStatus() EarthdataStatus {
	return earthdataStatus(a.appConfig())
}

/*
SetEarthdataToken records the token the mineral map reads EMIT data with.

REFUSES A TOKEN IT CANNOT USE: a token saved without being tried is a setting
that looks applied and fails at the first run, several minutes into a search.
The trial is one authenticated metadata request to the LP DAAC, which also
fails when the account has not accepted the LP DAAC data use terms -- a second
cause of the same 401 that no other check would reveal.

IN THE CREDENTIAL STORE, AND OUT OF THE FILE. The token goes to the platform's
store, and a copy left in the settings file is removed once the store has it.
Where the store cannot be reached the file keeps it, 0600 as before, and the
status says which.

An empty string clears the saved token from both.
*/
func (a *App) SetEarthdataToken(token string) (EarthdataStatus, error) {
	data := a.dataDir()
	if data == "" {
		return EarthdataStatus{}, errors.New("the local store is not open")
	}
	token = strings.TrimSpace(token)
	if token != "" {
		ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
		defer cancel()
		if err := verifyEarthdataToken(ctx, http.DefaultClient, earthdataProbeURL, token); err != nil {
			return EarthdataStatus{}, err
		}
	}
	cfg := pyenv.LoadAppConfig(data)
	if err := credential.SetEarthdataToken(token); err != nil {
		if token == "" {
			// Nothing to remove from a store that cannot be reached; the file
			// is cleared below either way.
			cfg.EarthdataToken = ""
		} else {
			cfg.EarthdataToken = token
		}
	} else {
		cfg.EarthdataToken = ""
	}
	if err := pyenv.SaveAppConfig(data, cfg); err != nil {
		return EarthdataStatus{}, fmt.Errorf("could not save the token: %w", err)
	}
	return earthdataStatus(cfg), nil
}

/*
migrateEarthdataToken moves a token saved in the settings file into the
credential store, once the store has accepted it.

Run at startup, so a token saved by a version that kept it in the file leaves
the file the first time this version opens. A store that cannot be reached
leaves the file as it is, which is where the token is then read from.
*/
func migrateEarthdataToken(dataDir string) {
	cfg := pyenv.LoadAppConfig(dataDir)
	token := strings.TrimSpace(cfg.EarthdataToken)
	if token == "" {
		return
	}
	if err := credential.SetEarthdataToken(token); err != nil {
		return
	}
	cfg.EarthdataToken = ""
	_ = pyenv.SaveAppConfig(dataDir, cfg)
}

// The files a mineral run keeps in its assets directory, one class map per
// group and the GeoTIFF. Named in one place because persistMineralRun writes
// them and LoadAnalysis reads them back.
const mineralMapTIF = "mineral_map.tif"

func mineralGroupPNG(group int) string {
	return fmt.Sprintf("mineral_group%d.png", group)
}

/*
mineralLayerPNG is a derived layer's file name, or "" for an id that is not
one: the id comes from the sidecar's payload and becomes part of a path, so
only lower-case letters, digits and underscores are taken.
*/
func mineralLayerPNG(id string) string {
	if id == "" {
		return ""
	}
	for _, r := range id {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return ""
		}
	}
	return "mineral_layer_" + id + ".png"
}

// earthdataProbeURL is the metadata of one EMIT L2A granule over Minas Gerais,
// small (tens of kilobytes) and behind the same authorisation as every read the
// mineral map makes.
const earthdataProbeURL = "https://opendap.earthdata.nasa.gov/collections/C2408750690-LPCLOUD/" +
	"granules/EMIT_L2A_RFL_001_20240830T135446_2424309_051.dmr.xml"

func verifyEarthdataToken(ctx context.Context, client *http.Client, url, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("the LP DAAC could not be reached to test the token: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Errorf("the token was refused by Earthdata (HTTP %d): it may be expired, or the "+
			"account may not have accepted the LP DAAC data use terms at urs.earthdata.nasa.gov",
			resp.StatusCode)
	default:
		return fmt.Errorf("the token could not be tested: the LP DAAC answered HTTP %d", resp.StatusCode)
	}
}
