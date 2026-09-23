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
	"geosense-infer/internal/pyenv"
)

// The mineral map and the one credential it needs. Kept apart from
// app_analysis.go because it is the only product that reads data behind a
// login, and the token's precedence, storage and verification are its own
// subject.

// AnalyzeMinerals maps surface mineralogy over an area from EMIT reflectance.
func (a *App) AnalyzeMinerals(req analysis.MineralRequest) (*analysis.MineralAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeMinerals(a.ctx, req, earthdataToken(a.appConfig()))
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
	return strings.TrimSpace(cfg.EarthdataToken)
}

// EarthdataStatus says whether EMIT data can be requested, and what decided it.
type EarthdataStatus struct {
	Configured bool `json:"configured"`
	// "EARTHDATA_TOKEN" when the variable applies, "chosen" when the saved
	// token does, "none" otherwise.
	Source string `json:"source"`
}

func earthdataStatus(cfg pyenv.AppConfig) EarthdataStatus {
	switch {
	case os.Getenv(analysis.EarthdataTokenEnv) != "":
		return EarthdataStatus{Configured: true, Source: analysis.EarthdataTokenEnv}
	case strings.TrimSpace(cfg.EarthdataToken) != "":
		return EarthdataStatus{Configured: true, Source: "chosen"}
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

An empty string clears the saved token.
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
	cfg.EarthdataToken = token
	if err := pyenv.SaveAppConfig(data, cfg); err != nil {
		return EarthdataStatus{}, fmt.Errorf("could not save the token: %w", err)
	}
	return earthdataStatus(cfg), nil
}

// The files a mineral run keeps in its assets directory, one class map per
// group and the GeoTIFF. Named in one place because persistMineralRun writes
// them and LoadAnalysis reads them back.
const mineralMapTIF = "mineral_map.tif"

func mineralGroupPNG(group int) string {
	return fmt.Sprintf("mineral_group%d.png", group)
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
