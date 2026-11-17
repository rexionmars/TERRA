package main

import (
	"errors"
	"fmt"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/pyenv"
)

// Which catalogue each imagery collection is read from: the choice in
// Settings, what it is handed to the sidecar as, and the token the radar
// needs when it is read from NASA's archive.

// ImagerySourceStatus is one collection's choice as the Settings screen shows it.
type ImagerySourceStatus struct {
	Collection string                   `json:"collection"`
	Label      string                   `json:"label"`
	Choices    []analysis.ImageryChoice `json:"choices"`
	// The catalogue runs will read from.
	Chosen string `json:"chosen"`
	// Set when the variable in Env decided Chosen, so a choice made on the
	// screen does not apply until it is unset.
	FromEnv bool   `json:"from_env"`
	Env     string `json:"env"`
}

func imageryStatus(cfg pyenv.AppConfig) []ImagerySourceStatus {
	out := make([]ImagerySourceStatus, 0, len(analysis.ImageryCollections))
	for _, c := range analysis.ImageryCollections {
		key, fromEnv := analysis.EffectiveImagerySource(c, cfg.ImagerySources)
		out = append(out, ImagerySourceStatus{
			Collection: c.Collection,
			Label:      c.Label,
			Choices:    c.Choices,
			Chosen:     key,
			FromEnv:    fromEnv,
			Env:        c.Env,
		})
	}
	return out
}

// GetImagerySources reports where each collection is read from.
func (a *App) GetImagerySources() []ImagerySourceStatus {
	return imageryStatus(a.appConfig())
}

/*
SetImagerySource records the catalogue a collection is read from.

The next run reads from it: the runner asks for the variables at each start
(Runner.SetEnvironment). The default is recorded as no entry at all, so a
config written before this setting existed and one that chose the default
read the same.
*/
func (a *App) SetImagerySource(collection, key string) ([]ImagerySourceStatus, error) {
	data := a.dataDir()
	if data == "" {
		return nil, errors.New("the local store is not open")
	}
	c, ok := analysis.ImageryCollectionNamed(collection)
	if !ok {
		return nil, fmt.Errorf("TERRA reads no collection called %q", collection)
	}
	if _, ok := c.Choice(key); !ok {
		return nil, fmt.Errorf("%s cannot be read from %q", c.Label, key)
	}
	cfg := pyenv.LoadAppConfig(data)
	if key == analysis.DefaultImagerySource {
		delete(cfg.ImagerySources, collection)
	} else {
		if cfg.ImagerySources == nil {
			cfg.ImagerySources = map[string]string{}
		}
		cfg.ImagerySources[collection] = key
	}
	if len(cfg.ImagerySources) == 0 {
		cfg.ImagerySources = nil
	}
	if err := pyenv.SaveAppConfig(data, cfg); err != nil {
		return nil, fmt.Errorf("could not save the imagery source: %w", err)
	}
	return imageryStatus(cfg), nil
}

// runnerEnvironment is what every sidecar run is started with; see
// Runner.SetEnvironment. The settings file is read at each start, so a choice
// made in Settings applies to the next run.
func (a *App) runnerEnvironment() []string {
	return analysis.ImageryEnv(a.appConfig().ImagerySources)
}

// newRunner is analysis.NewRunner with the application's environment attached.
// Both places that build a runner go through here, so a rebuilt runner cannot
// lose the imagery sources the first one carried.
func (a *App) newRunner(appDir, python string) (*analysis.Runner, error) {
	runner, err := analysis.NewRunner(appDir, python)
	if err != nil {
		return nil, err
	}
	runner.SetEnvironment(a.runnerEnvironment)
	return runner, nil
}

/*
radarEarthdataToken is the token a radar run is handed: the saved one when the
radar is read from a catalogue that needs it, and empty otherwise.

Only the run that needs the credential carries it. A radar read from the
Planetary Computer has no use for it, and the other products never do.
*/
func radarEarthdataToken(cfg pyenv.AppConfig) string {
	c, ok := analysis.ImageryCollectionNamed("sentinel-1-rtc")
	if !ok {
		return ""
	}
	key, _ := analysis.EffectiveImagerySource(c, cfg.ImagerySources)
	choice, ok := c.Choice(key)
	if !ok || !choice.NeedsEarthdata {
		return ""
	}
	return earthdataToken(cfg)
}
