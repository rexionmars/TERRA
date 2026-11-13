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
	// sequence_transformer or embedding_rf.
	Family  string `json:"family"`
	Task    string `json:"task"`
	Summary string `json:"summary"`
	// Classes are the MapBiomas codes it emits.
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
