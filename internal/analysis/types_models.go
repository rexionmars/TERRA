package analysis

/*
The model packages a run can use, in the JSON the frontend reads.

A package's model.json has the shape of ModelManifest. internal/models reads,
checks and installs it, and sidecar/terra/models.py reads it again, and hashes
every file, before a run unpickles anything. Declared here rather than in
internal/models so that frontend/src/lib/types.ts is compared against it by
check:types, as the other shapes that cross to TypeScript are.
*/

// ModelFile is one file of a package, pinned by its digest.
type ModelFile struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// ModelFact is one labelled line of what a model reads or how it works.
type ModelFact struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// ModelEvaluation is what was measured about a model, and where it was reported.
type ModelEvaluation struct {
	Method  string      `json:"method"`
	Figures []ModelFact `json:"figures"`
	Source  string      `json:"source"`
}

// ModelPerson is someone a package names.
type ModelPerson struct {
	Name string `json:"name"`
}

// ModelPicture is the credit owed for the picture a package carries.
type ModelPicture struct {
	Subject string `json:"subject"`
	Author  string `json:"author"`
	License string `json:"license"`
	Source  string `json:"source"`
}

// ModelManifest is a package's model.json.
type ModelManifest struct {
	// Format is the manifest's own version; see sidecar/terra/models.py.
	Format  int    `json:"format"`
	ID      string `json:"id"`
	Version string `json:"version"`
	Name    string `json:"name"`
	// Family is the architecture the sidecar runs it as: feature_rf,
	// sequence_transformer or embedding_rf. Each family does one task.
	Family string `json:"family"`
	// Task is what the model does: land_cover, time_series or
	// observation_quality (internal/models holds the list).
	Task    string `json:"task"`
	Summary string `json:"summary"`
	// Classes are the MapBiomas codes a land_cover model emits. A model of any
	// other task estimates a quantity, and its manifest lists none.
	Classes []int `json:"classes"`
	// Modes are the classify modes it supports: "single", and "temporal" for
	// a model that can be rerun over a cumulative stack.
	Modes []string `json:"modes"`
	// Requires names the optional Python packages it needs, e.g. "torch".
	Requires []string `json:"requires"`
	// Variants are the heads of an embedding package, e.g. "pixel", "patch".
	Variants   []string         `json:"variants"`
	Reads      []ModelFact      `json:"reads"`
	Method     []ModelFact      `json:"method"`
	Evaluation *ModelEvaluation `json:"evaluation"`
	Limits     []string         `json:"limits"`
	License    string           `json:"license"`
	DOI        string           `json:"doi"`
	// PackagedBy names who made the package. They may not be who developed
	// the model: the evaluation's source names that work.
	PackagedBy []ModelPerson        `json:"packaged_by"`
	Picture    *ModelPicture        `json:"picture"`
	Files      map[string]ModelFile `json:"files"`
}

// ModelInfo is an installed package as the frontend lists it.
type ModelInfo struct {
	Manifest ModelManifest `json:"manifest"`
	// Digest is the package's fingerprint: SHA-256 over each role and its
	// file's digest, sorted by role. Equal to what a run records.
	Digest string `json:"digest"`
	// PictureURI is the package's picture as a data URI, empty without one.
	PictureURI string `json:"picture_uri"`
}

// ModelRef names the model a run used, down to its files.
type ModelRef struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Digest  string `json:"digest"`
}

// ModelSource is one place a published package can be downloaded from.
type ModelSource struct {
	// Name is the host as the reader knows it: "GitHub", "Zenodo".
	Name string `json:"name"`
	URL  string `json:"url"`
}

/*
CatalogEntry is a published package, as the catalogue lists it: what the
Models screen shows before the package is installed, and what its download is
checked against.
*/
type CatalogEntry struct {
	// Manifest is the model.json inside the package, as published.
	Manifest ModelManifest `json:"manifest"`
	// Digest is the package's fingerprint, as ModelInfo.Digest; the installed
	// package must have the same one.
	Digest     string `json:"digest"`
	PictureURI string `json:"picture_uri"`
	// Package is the zip itself: its file name, SHA-256 and size.
	Package ModelFile `json:"package"`
	// Sources are tried in order until one gives the zip the catalogue pins.
	Sources []ModelSource `json:"sources"`
}

/*
UpcomingEntry is a model being prepared for TERRA that has no release yet: what
the Models screen says about it before there is anything to download. It has no
version, digest, package or source, so nothing can be installed from it.
*/
type UpcomingEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Task    string `json:"task"`
	Summary string `json:"summary"`
	// Status says what the release still waits for, as a sentence.
	Status  string        `json:"status"`
	Reads   []ModelFact   `json:"reads"`
	Limits  []string      `json:"limits"`
	Picture *ModelPicture `json:"picture"`
	// PictureURI is the card's picture as a data URI, empty without one.
	PictureURI string `json:"picture_uri"`
}

// ModelCatalog is the catalogue as the Models screen reads it.
type ModelCatalog struct {
	Models []CatalogEntry `json:"models"`
	// Upcoming are the models in preparation, in the catalogue's order. None
	// can be installed, and none is counted in Unsupported.
	Upcoming []UpcomingEntry `json:"upcoming"`
	// Origin is "online" when the published catalogue was read just now, and
	// "built-in" when it could not be and the copy this build carries is shown.
	Origin string `json:"origin"`
	// Problem says why the published catalogue was not read; empty when it was.
	Problem string `json:"problem"`
	// Unsupported counts the entries left out because this version of TERRA
	// cannot run them: a family or a task it does not know, or a newer
	// manifest format.
	Unsupported int `json:"unsupported"`
}

// ModelDownload is the progress of a package being downloaded.
type ModelDownload struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	// Source is the name of the source being read.
	Source   string `json:"source"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
}
