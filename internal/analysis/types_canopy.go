package analysis

// Canopy: the leaf-area field, the grown stand and the meshes built from an AOI.
//
// Split out of types.go, which had grown to 2,631 lines. The package is the
// unit in Go, so this moves nothing across a boundary -- it only lets a reader
// open the subject they are after.

/*
CanopyFromAOIRequest reads an AOI's own vegetation-index series as a canopy.

The one request in this file that carries observation rather than parameters.
Everything else about a canopy is a choice the reader makes; this is what the
ground was measured to be, and the sowing it has to be read through.

Lat/Lon are optional and change the answer rather than decorating it: given, the
canopy is lit by the NASA POWER record for that cell -- real azimuths and
elevations weighted by the beam energy that arrived at each -- instead of by the
six reference suns, which exist to cross-validate a shader and are not sky.
*/
type CanopyFromAOIRequest struct {
	Species  string          `json:"species,omitempty"`
	VISeries []VIObservation `json:"vi_series"`
	// Sowing, which is what turns leaf area per plant into an LAI.
	InterRow   *float64 `json:"inter_row,omitempty"`
	InterPlant *float64 `json:"inter_plant,omitempty"`
	// The bearing the rows run on. Agronomy, not convention: rows laid
	// north-south intercept differently from rows laid east-west.
	RowAzimuthDeg *float64 `json:"row_azimuth_deg,omitempty"`
	Lat           *float64 `json:"lat,omitempty"`
	Lon           *float64 `json:"lon,omitempty"`
	Elevation     *float64 `json:"elevation,omitempty"`
	HourlyYears   int      `json:"hourly_years,omitempty"`
	Seed          *int     `json:"seed,omitempty"`
	// The classification's own reading of what grows here. The sidecar maps a
	// dominant class to a plantarchitecture species and, as importantly,
	// refuses: cane, coffee and eucalyptus have no plant in the library, and
	// the catch-all crop classes identify none.
	//
	// Without this field the guard on the far side was never true, so the
	// suggestion never fired and the species was always whatever the picker
	// held -- the classification and the simulation ran over the same ground
	// and never spoke. Species selects the architecture, which is the largest
	// single geometry choice in the run.
	ClassStats []ClassStat `json:"class_stats,omitempty"`
	// How many plants are drawn before the answer is reported as a band.
	// helios_grow draws stochastically, and on soybean at fixed LAI five seeds
	// spanned 0.096 in faPAR -- larger than the whole seasonal term. Zero
	// leaves the sidecar's default.
	NSeeds int `json:"n_seeds,omitempty"`
	// Half-width, in days, of the day-of-year window the solar record is
	// narrowed to around the lit date. Zero leaves the sidecar's default;
	// the sidecar treats a window wider than half a year as no window.
	SunWindowDays int `json:"sun_window_days,omitempty"`
}

/*
CanopyFromAOI is the season read as canopies, and what each reading is worth.

TWO ANCHORS FOR THE AGE TRAVEL TOGETHER, and neither is chosen for the reader.
Leaf area gives one, phenology gives another, and AgeCheck holds their
comparison. Where they agree the isolated-plant model describes the field; where
they do not, the disagreement is the finding, because Helios grows a plant with
no neighbours and in a dense sowing reaches a given leaf area far too early.
*/
type CanopyFromAOI struct {
	Species      string  `json:"species"`
	Density      float64 `json:"density"`
	InterRow     float64 `json:"inter_row"`
	InterPlant   float64 `json:"inter_plant"`
	ReachableLAI float64 `json:"reachable_lai"`

	LAI       CanopyLAISeries    `json:"lai"`
	States    []string           `json:"states"`
	Phenology map[string]float64 `json:"phenology"`
	Resolved  []CanopyResolved   `json:"resolved"`
	NUsable   int                `json:"n_usable"`
	Sun       CanopySun          `json:"sun"`
	// Absent when no date could be lit -- no location, or nothing the ladder
	// could build.
	Light *CanopyLight `json:"light,omitempty"`
	// The cycles the window was split into. More than one means it covers more
	// than one crop -- safra and safrinha, or a crop followed by a cover -- and
	// every age above is then measured from its own cycle's green-up rather
	// than from the start of the record. The sidecar emitted these and no
	// field received them, so a reader could not tell a two-crop window from a
	// one-crop one.
	Cycles []CanopyCycle `json:"cycles,omitempty"`
	// What the classification suggested and why, including why it refused.
	SpeciesSuggestion *SpeciesSuggestion `json:"species_suggestion,omitempty"`
	// The dominant class's share of the AOI. The series above is an area mean,
	// and a mean over mixed cover is not the crop's index; this is how much of
	// it is the crop.
	CropFraction *float64 `json:"crop_fraction,omitempty"`
}

// CanopyCycle is one contiguous stretch of the series outside bare soil and
// fallow. Bare-soil stretches are not cycles: there is no canopy to date in
// them.
type CanopyCycle struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	Greenup string `json:"greenup"`
	N       int    `json:"n"`
}

type CanopyLAISeries struct {
	NDVI          []float64          `json:"ndvi"`
	LAI           []float64          `json:"lai"`
	PeakLAI       float64            `json:"peak_lai"`
	N             int                `json:"n"`
	NSaturated    int                `json:"n_saturated"`
	SaturationLAI float64            `json:"saturation_lai"`
	Parameters    map[string]float64 `json:"parameters"`
}

// CanopyResolved is one observation: what it was, what age it implies, or why
// it implies none. Day is a pointer because a canopy past the plateau has no
// identifiable age, and zero would be a lie the front end could not detect.
type CanopyResolved struct {
	Date       string   `json:"date"`
	LAI        float64  `json:"lai"`
	State      string   `json:"state,omitempty"`
	Day        *float64 `json:"day,omitempty"`
	DayAtLeast *float64 `json:"day_at_least,omitempty"`
	HeightM    *float64 `json:"height_m,omitempty"`
	LeafAreaM2 *float64 `json:"leaf_area_m2,omitempty"`
	PlateauDay *float64 `json:"plateau_day,omitempty"`
	AtPlateau  bool     `json:"at_plateau,omitempty"`
	Declining  bool     `json:"declining,omitempty"`
	// Days since the series first left bare soil. The independent age.
	DaysSinceGreenup *float64       `json:"days_since_greenup,omitempty"`
	AgeCheck         CanopyAgeCheck `json:"age_check"`
	Why              string         `json:"why,omitempty"`
	Error            string         `json:"error,omitempty"`
}

// CanopyAgeCheck compares development PROGRESS and not days, because the two
// clocks run at different rates: Helios sorghum saturates at day 40 while a
// field season takes near a hundred days to peak, and subtracting one from the
// other mixes that with the competition it is meant to detect.
type CanopyAgeCheck struct {
	Comparable     bool     `json:"comparable"`
	ProgressHelios *float64 `json:"progress_helios,omitempty"`
	ProgressField  *float64 `json:"progress_field,omitempty"`
	DeltaProgress  *float64 `json:"delta_progress,omitempty"`
	Agrees         bool     `json:"agrees,omitempty"`
	Why            string   `json:"why,omitempty"`
}

type CanopySun struct {
	Source          string    `json:"source"`
	Cell            []float64 `json:"cell,omitempty"`
	Years           int       `json:"years,omitempty"`
	BeamEnergyTotal float64   `json:"beam_energy_total,omitempty"`
	NAzimuthBins    int       `json:"n_azimuth_bins,omitempty"`
	NElevationBins  int       `json:"n_elevation_bins,omitempty"`
	DiffuseShare    float64   `json:"diffuse_share,omitempty"`
	// WHICH SKY THIS IS. The record fetched is three whole years, and averaging
	// all of it gives the sun of no particular time, while this canopy is one
	// dated observation. WindowDays is the half-width of the day-of-year window
	// the record was narrowed to around WindowCentre; zero means the whole
	// record answered, which happens when no date resolved to an age.
	//
	// Measured on this cell: the month spans 0.0588 in faPAR at LAI 3, and the
	// whole-record average is wrong by up to 0.0367 for the worst month --
	// against 0.016 for the entire latitude range of Brazil. Before this the
	// panel captioned a three-year all-season sky with the observation's date.
	WindowDays   int    `json:"window_days,omitempty"`
	WindowCentre string `json:"window_centre,omitempty"`
	NHours       int    `json:"n_hours,omitempty"`
	// Whether the POWER record was fetched or read from cache, and which
	// revision. POWER reprocesses historical data, so a cached series can be a
	// superseded revision; every other POWER-reading surface in this app
	// renders this and the canopy panel was the one that could not.
	// One series and not the daily/hourly pair PowerProvenance carries: this
	// action reads the hourly record only.
	Provenance *PowerSeriesProvenance `json:"provenance,omitempty"`
	// THE SUN AS SOMETHING THAT CAN BE DRAWN, not only summed. Everything above
	// describes the sky as totals and bin counts, which a march consumes and a
	// viewer cannot; a scene handed only those has to invent a light, and the
	// picture then shows a sun that had nothing to do with the number beside it.
	Direction *SunDirection `json:"direction,omitempty"`
	// Global irradiance over its clear-sky reference across the window: 1.0 is
	// a cloudless record and the shortfall is cloud. Measured on the cell this
	// was developed against, a 21-day window runs 0.743 in February against
	// 0.927 in October -- the same site, two visibly different skies. Absent
	// when the record predates the clear-sky parameter.
	Clearness *float64 `json:"clearness,omitempty"`
	// One real day of the window, hour by hour, for a viewer that moves the sun
	// rather than fixing it.
	TrackDate string    `json:"track_date,omitempty"`
	Track     []SunHour `json:"track,omitempty"`
	// Why the reference suns were used instead, when they were.
	Why string `json:"why,omitempty"`
}

// CanopyLight is the canopy marched under that sun. FixedKErrorPct is the
// number a crop-model reader has a question about: how far Beer with a constant
// coefficient lands from what this canopy actually intercepted.
type CanopyLight struct {
	Date                 string   `json:"date,omitempty"`
	Day                  *float64 `json:"day,omitempty"`
	LAI                  float64  `json:"lai"`
	FaPAR                float64  `json:"fapar"`
	Transmittance        float64  `json:"transmittance"`
	BeamTransmittance    float64  `json:"beam_transmittance"`
	DiffuseTransmittance *float64 `json:"diffuse_transmittance,omitempty"`
	DiffuseShare         float64  `json:"diffuse_share"`
	KEmergent            *float64 `json:"k_emergent,omitempty"`
	FaPARFixedK          *float64 `json:"fapar_fixed_k,omitempty"`
	FixedK               float64  `json:"fixed_k,omitempty"`
	FixedKErrorPct       *float64 `json:"fixed_k_error_pct,omitempty"`
	BeamBinsMarched      int      `json:"beam_bins_marched,omitempty"`
	RowAzimuthDeg        float64  `json:"row_azimuth_deg,omitempty"`
	// The fraction of the module's ground that has leaf above it. The one
	// geometric number that tracks the answer: measured at fixed LAI, sweeping
	// the canopy's horizontal extent moves faPAR 0.19 to 0.88 and faPAR follows
	// cover almost proportionally, while sweeping its HEIGHT over a factor of
	// 2.4 moves it 0.020. Carried so a reader with an observed cover -- which a
	// nadir view gives cheaply, and which needs no 3D reconstruction -- can
	// check the simulated canopy against the field's.
	Cover float64 `json:"cover,omitempty"`
	Seed  int     `json:"seed,omitempty"`
	// The spread across the plants that were drawn. Absent only on error.
	Ensemble *CanopyEnsemble `json:"ensemble,omitempty"`
	Error    string          `json:"error,omitempty"`
}

/*
CanopyEnsemble is how far apart the drawn plants landed.

WHY A POINT ESTIMATE WAS THE WRONG SHAPE. helios_grow draws a plant
stochastically, and the draw is not a rounding detail: on soybean at 55 days
with everything else held -- same species, same age, same sowing, leaf area
rescaled to an identical LAI so only shape could differ -- five seeds spanned
faPAR 0.703 to 0.799. That 0.096 is larger than the whole seasonal term and
three times a 20% error in the LAI the inversion works so hard to recover, and
the surface was printing three decimals of a number whose own spread lands in
the second.

No data buys this away. It is the model's own variance and can only be sampled,
so the honest form of the same computation is a band.
*/
type CanopyEnsemble struct {
	N           int     `json:"n"`
	FaPARMin    float64 `json:"fapar_min"`
	FaPARMax    float64 `json:"fapar_max"`
	FaPARSpread float64 `json:"fapar_spread"`
	CoverMin    float64 `json:"cover_min"`
	CoverMax    float64 `json:"cover_max"`
	// In faPAR order, so the ends of the band can be reproduced.
	Seeds []int `json:"seeds"`
}

/*
CanopyMeshRequest asks for a stand of plants as geometry.

Distinct from CanopyFieldRequest and not a variant of it. The field is a
leaf-area density on a voxel grid, which holds no leaf to draw; this grows
plants and keeps their triangles. The two answer different questions, and the
only thing they share is a species name.

Organs selects what comes back. Sorghum fruit is a third of the triangles of a
grown stand, and nobody asking to see a canopy means the panicle, so leaving it
empty asks for the vegetative structure.
*/
type CanopyMeshRequest struct {
	Species    string   `json:"species,omitempty"`
	Days       int      `json:"days,omitempty"`
	Rows       int      `json:"rows,omitempty"`
	PerRow     int      `json:"per_row,omitempty"`
	InterRow   *float64 `json:"inter_row,omitempty"`
	InterPlant *float64 `json:"inter_plant,omitempty"`
	Seed       *int     `json:"seed,omitempty"`
	Organs     []string `json:"organs,omitempty"`
}

/*
CanopyMesh is a grown stand, as glTF plus what it is made of.

The mesh crosses as base64 for the reason the field does: it is a binary the
webview consumes directly, and the sidecar's work dir is removed by the time the
front end asks for it. LeafArea is Helios's own figure for the stand, so a
reader can tell this is the canopy a field would have been built from.
*/
type CanopyMesh struct {
	// The bytes themselves never cross the bridge: the app holds them and the
	// front end fetches URL. `json:"-"` is what keeps them out of a bound
	// method's reply, which is where a megabyte-scale string overflowed the
	// webview's stack before any of this application's code ran.
	Data []byte `json:"-"`
	URL  string `json:"url"`

	Bytes      int            `json:"bytes"`
	Species    string         `json:"species"`
	Days       int            `json:"days"`
	Plants     int            `json:"plants"`
	Rows       int            `json:"rows"`
	PerRow     int            `json:"per_row"`
	InterRow   float64        `json:"inter_row"`
	InterPlant float64        `json:"inter_plant"`
	LeafArea   float64        `json:"leaf_area"`
	Organs     map[string]int `json:"organs"`
}

/*
CanopyFieldRequest asks for the leaf-area-density field of one orchard module.

The field is periodic: it covers a single spacing module and a ray leaving one
side returns on the opposite one, which represents a closed orchard without
replicating a tree. Source picks how the crowns are filled -- "ellipsoid"
computes them analytically and needs nothing beyond numpy, "helios" grows an
explicit plant and needs pyhelios3d, which the managed environment does not
carry. The two are not interchangeable: an ellipsoid preserving leaf area and
crown envelope intercepts markedly more light than the architecture it stands
in for, so the result reports which one produced it.
*/
// Geometry is carried by pointer, not by value with omitempty. Zero is a value
// a caller can mean here -- a crown centred at ground level is a hedgerow, and
// an LAI of zero is the bare module the against-uniform comparison is about --
// and `omitempty` on a float64 drops both, letting the sidecar substitute its
// own default. That is the pattern sidecar/infer.py:82-91 records as having
// silently moved four numeric parameters in this repository, one of which
// shifted every energy figure by 5.78 percent.
type CanopyFieldRequest struct {
	Source  string   `json:"source,omitempty"`
	Spacing *float64 `json:"spacing,omitempty"`
	LAI     *float64 `json:"lai,omitempty"`
	Cell    *float64 `json:"cell,omitempty"`
	CrownA  *float64 `json:"crown_a,omitempty"`
	CrownB  *float64 `json:"crown_b,omitempty"`
	CrownZ  *float64 `json:"crown_z,omitempty"`
	// Rows only. A field of soy or maize is a strip of vegetation repeating
	// every spacing, not a set of crowns: all the module's leaf area lives
	// inside the strips, which is what Beer's law over the whole field misses.
	Height       *float64 `json:"height,omitempty"`
	RowWidthFrac *float64 `json:"row_width_frac,omitempty"`
	Base         *float64 `json:"base,omitempty"`
	// Helios only. Ignored when the crowns are ellipsoids.
	Species string `json:"species,omitempty"`
	Days    int    `json:"days,omitempty"`
	Seed    *int   `json:"seed,omitempty"`
	// How many points the reference cases evaluate. Raising it costs one
	// march per point and nothing at draw time.
	NReference int `json:"n_reference,omitempty"`
}

// CanopyFieldMeta describes the grid the march reads.
//
// Occupancy and the in-crown density are here because they are what explains a
// transmittance: the same leaf area concentrated into a tenth of the volume
// passes far more light than spread through all of it, Beer-Lambert being
// non-linear in density, and a surface reporting only LAI cannot say why two
// canopies of equal LAI differ.
type CanopyFieldMeta struct {
	Source         string  `json:"source"`
	Spacing        float64 `json:"spacing"`
	Cell           float64 `json:"cell"`
	ZTop           float64 `json:"z_top"`
	NXY            int     `json:"n_xy"`
	NZ             int     `json:"n_z"`
	LAI            float64 `json:"lai"`
	LeafArea       float64 `json:"leaf_area"`
	Occupancy      float64 `json:"occupancy"`
	DensityInCrown float64 `json:"density_in_crown"`
	Bytes          int     `json:"bytes"`
	CrownA         float64 `json:"crown_a,omitempty"`
	CrownB         float64 `json:"crown_b,omitempty"`
	CrownZ         float64 `json:"crown_z,omitempty"`
	Leaves         int     `json:"leaves,omitempty"`
	RowWidth       float64 `json:"row_width,omitempty"`
	RowWidthFrac   float64 `json:"row_width_frac,omitempty"`
	Height         float64 `json:"height,omitempty"`
	Base           float64 `json:"base,omitempty"`
}

// CanopyReferenceSun is one solar direction and what the numpy march answered
// for it at every reference point.
type CanopyReferenceSun struct {
	CosZenith     float64   `json:"cos_zenith"`
	Azimuth       float64   `json:"azimuth"`
	Why           string    `json:"why"`
	Direction     []float64 `json:"direction"`
	Transmittance []float64 `json:"transmittance"`
}

/*
CanopyReference is what a second implementation of the march has to reproduce.

The shading in the viewport marches this same field in GLSL, which makes the
shader a second implementation of sidecar/canopy_voxel.py. Two implementations
of one numerical method drift unless something compares them, and this
repository has already shipped a hand-copied table that drifted on every stop
while nothing failed. These are the numbers frontend/scripts/check-canopy-shader.ts
holds the shader to.
*/
type CanopyReference struct {
	Points   [][]float64 `json:"points"`
	StepFrac float64     `json:"step_frac"`
	GLeaf    float64     `json:"g_leaf"`
	// Every parameter the march reads travels, MaxPath included. It changes the
	// answer, and leaving it for the consumer to hard-code is the hand-copied
	// constant this payload exists to prevent -- the divergence would be
	// invisible on any field whose longest path is under both values.
	MaxPath   float64              `json:"max_path"`
	MaxSteps  int                  `json:"max_steps"`
	Tolerance float64              `json:"tolerance"`
	Suns      []CanopyReferenceSun `json:"suns"`
}

// CanopyAgainstUniform contrasts the field with a uniform canopy of the same
// leaf area -- the null model, and the reason for voxelising anything.
type CanopyAgainstUniform struct {
	CosZenith float64 `json:"cos_zenith"`
	Field     float64 `json:"field"`
	Uniform   float64 `json:"uniform"`
	// What the canopy intercepts, and what a crop model holding one fitted
	// extinction coefficient would have said instead. KEmergent inverts Beer
	// on the resolved answer (Braud et al. 2026, eq. 29); it is null where
	// there is too little leaf to invert or the canopy is closed.
	FAPAR       float64  `json:"fapar"`
	FAPARFixedK float64  `json:"fapar_fixed_k"`
	KEmergent   *float64 `json:"k_emergent"`
	FixedK      float64  `json:"fixed_k"`
	// Signed, and the sign is the finding: it changes within a single day,
	// which a fixed coefficient cannot express.
	FixedKErrorPct *float64 `json:"fixed_k_error_pct"`
	// Null where the uniform canopy underflows to zero, which happens at high
	// LAI and a low sun. Not NaN: json.dumps writes NaN and Infinity as bare
	// tokens and encoding/json refuses both, discarding an otherwise complete
	// payload with a message about a character.
	Ratio *float64 `json:"ratio"`
}

// CanopyGrown records what Helios produced, when Helios produced it.
type CanopyGrown struct {
	LeafArea      float64  `json:"leaf_area"`
	Reported      float64  `json:"reported"`
	RelativeError float64  `json:"relative_error"`
	Organs        []string `json:"organs"`
}

/*
CanopyField is the field plus everything needed to check what reads it.

FieldBase64 carries the grid itself as little-endian float32 in the Python
index order (ix, iy, iz), C-contiguous. It is base64 rather than a path because
the consumer is a webview that uploads it to a 3D texture: a path would have to
be served, and the grids are small -- a 27x27x16 field is 47 kB. The transpose
into texture axis order happens in the frontend, next to the texelFetch whose
axis order it exists to satisfy.
*/
type CanopyField struct {
	Field          CanopyFieldMeta        `json:"field"`
	FieldBase64    string                 `json:"field_base64"`
	Reference      CanopyReference        `json:"reference"`
	AgainstUniform []CanopyAgainstUniform `json:"against_uniform"`
	Grown          *CanopyGrown           `json:"grown,omitempty"`
}
