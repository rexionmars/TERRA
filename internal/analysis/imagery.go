package analysis

import (
	"os"
	"strings"
)

/*
The catalogues imagery can be read from, as the shell offers and passes them.

sidecar/terra/stac.py holds each catalogue's address, collection id and the
renaming of its assets; this list holds what the shell needs to offer the
choice in Settings and to hand it to the sidecar. Every key here must be one
the sidecar reads, and sidecar/tests/test_imagery_sources_sync.py fails when
one is not.

A Sentinel-1 source is offered only once the radar has thresholds measured on
it (radar/series.py CALIBRATIONS, measured with
sidecar/tools/radar_calibration.py): offered before then, it would be a choice
the radar refuses. NASA OPERA RTC-S1 has had its own since November 2026.
*/

// DefaultImagerySource is read when nothing is chosen: the shipped models and
// the radar thresholds were measured on it.
const DefaultImagerySource = "planetary-computer"

// ImageryChoice is one catalogue a collection can be read from.
type ImageryChoice struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	// Set when reading from it takes the NASA Earthdata token.
	NeedsEarthdata bool `json:"needs_earthdata"`
}

// ImageryCollection is one collection TERRA reads, and where it can come from.
type ImageryCollection struct {
	// TERRA's name for the collection, as stac.py and ImagerySource use it.
	Collection string `json:"collection"`
	// What the reader knows it as.
	Label string `json:"label"`
	// The variable the sidecar reads the choice from.
	Env     string          `json:"env"`
	Choices []ImageryChoice `json:"choices"`
}

// ImageryCollections is every collection TERRA reads imagery from.
var ImageryCollections = []ImageryCollection{
	{
		Collection: "sentinel-2-l2a",
		Label:      "Sentinel-2 (optical)",
		Env:        "TERRA_SENTINEL2_SOURCE",
		Choices: []ImageryChoice{
			{Key: "planetary-computer", Title: "Microsoft Planetary Computer"},
			{Key: "earth-search", Title: "Element 84 Earth Search"},
		},
	},
	{
		Collection: "sentinel-1-rtc",
		Label:      "Sentinel-1 (radar)",
		Env:        "TERRA_SENTINEL1_SOURCE",
		Choices: []ImageryChoice{
			{Key: "planetary-computer", Title: "Microsoft Planetary Computer"},
			{Key: "opera", Title: "NASA OPERA RTC-S1", NeedsEarthdata: true},
		},
	},
}

// ImageryCollectionNamed is the collection called `name`, if TERRA reads it.
func ImageryCollectionNamed(name string) (ImageryCollection, bool) {
	for _, c := range ImageryCollections {
		if c.Collection == name {
			return c, true
		}
	}
	return ImageryCollection{}, false
}

// Choice is the catalogue called `key` among the collection's, if it is one.
func (c ImageryCollection) Choice(key string) (ImageryChoice, bool) {
	for _, ch := range c.Choices {
		if ch.Key == key {
			return ch, true
		}
	}
	return ImageryChoice{}, false
}

/*
EffectiveImagerySource is the catalogue the collection will be read from, and
whether the process environment decided it.

The variable wins when it is set, as TERRA_PYTHON and EARTHDATA_TOKEN do: a
developer comparing catalogues per shell should not have to edit a file the UI
also writes. chosen is the installation's setting, keyed by collection.
*/
func EffectiveImagerySource(c ImageryCollection, chosen map[string]string) (key string, fromEnv bool) {
	if v := strings.TrimSpace(os.Getenv(c.Env)); v != "" {
		return v, true
	}
	if v := strings.TrimSpace(chosen[c.Collection]); v != "" {
		return v, false
	}
	return DefaultImagerySource, false
}

/*
ImageryEnv is the variables that carry the installation's choices to the
sidecar, for Runner.SetEnvironment.

A collection whose variable is already set in the process environment is left
out, because the child inherits that one and a later duplicate in cmd.Env
would replace it. A collection with nothing chosen is left out too, and the
sidecar reads its default.
*/
func ImageryEnv(chosen map[string]string) []string {
	var env []string
	for _, c := range ImageryCollections {
		if os.Getenv(c.Env) != "" {
			continue
		}
		if v := strings.TrimSpace(chosen[c.Collection]); v != "" {
			env = append(env, c.Env+"="+v)
		}
	}
	return env
}
