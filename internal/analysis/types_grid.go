package analysis

// The Brazilian electrical system: what the grid did to the plants already on
// it, read from the operator's own published record.
//
// A SIBLING OF THE ENERGY PRODUCTS, NOT AN EXTENSION OF THEM. Every energy
// action answers about a site's resource -- irradiance onto a plane, a yield
// from it, ground a plant could stand on. None answers about the system the
// site would join, and in the subsystems where a third of photovoltaic output
// is withheld that is the binding constraint rather than the terrain. The two
// are weighed together by whoever reads them, not by folding one into the
// other's payload.
//
// EVERY ACTION HERE NEEDS A LOCAL POSTGIS AND HAS NO FALLBACK. That is by
// design: answering "this plant, this window" has exactly one implementation,
// so it cannot drift into two that disagree. An installation without the store
// gets a refusal naming what is missing, never a slower answer.
//
// THE RECORD DESCRIBES METERED PLANTS. It says nothing about a site that has
// none, and nothing here borrows a neighbour's figure to fill the gap.

// GridCoverageRequest asks what the store holds. It carries no AOI because the
// answer is about the store and not about any ground.
type GridCoverageRequest struct {
	// Connection to the local PostGIS, in libpq form. Empty lets the sidecar
	// resolve it: TERRA_BR_DSN first, then a peer-authenticated `terra_br` on
	// this machine.
	StoreDSN string `json:"br_store_dsn,omitempty"`
}

// GridDatasetCoverage is one published record the store has loaded, and the
// span it covers.
//
// READ FROM THE LOAD LEDGER, NOT COUNTED FROM THE FACT TABLES, so a period
// whose rows failed to load reports as absent rather than as present and empty.
type GridDatasetCoverage struct {
	Dataset string `json:"dataset"`
	Periods int    `json:"periods"`
	// The first and last period files loaded, as YYYY-MM.
	From string `json:"from"`
	To   string `json:"to"`
	Rows int64  `json:"rows"`
	// When this store last loaded a period of this record. Not when ONS
	// published it: the operator rewrites whole years in a batch, so the two
	// dates answer different questions and only the catalogue revision recorded
	// per period says which revision the rows came from.
	LoadedUTC string `json:"loaded_utc"`
}

// GridPlantCoverage is the register the record is joined to for geometry, which
// the operator never publishes.
type GridPlantCoverage struct {
	Registered int `json:"registered"`
	// Plants carrying a usable coordinate. The gap is not a load failure: ANEEL
	// writes an absent coordinate as 0.0, and 432 enterprises are recorded that
	// way. Stored as given they are a point in the Gulf of Guinea, so they are
	// stored with no geometry instead and are reachable by CEG alone.
	WithGeometry int `json:"with_geometry"`
}

// GridNetworkCoverage is the transmission register a site would have to reach.
type GridNetworkCoverage struct {
	Substations    int `json:"substations"`
	LinesInService int `json:"lines_in_service"`
}

// GridLoadConflicts counts the instants at which the published record
// contradicts itself, and how many of those were exact repeats.
//
// REPORTED RATHER THAN HIDDEN. The loader keeps the first row of a colliding
// set, and discarding that silently would be indistinguishable from a load that
// lost rows. 56 instants in 19 million carry two rows for one plant; 8 are
// identical and the rest disagree in value.
type GridLoadConflicts struct {
	Total     int    `json:"total"`
	Identical int    `json:"identical"`
	Note      string `json:"note,omitempty"`
}

// GridCoverage is what the store holds, and is also the health probe: it can
// only answer by opening the connection and reading the ledger, so an answer at
// all means the database is reachable and carries the schema.
type GridCoverage struct {
	Datasets      []GridDatasetCoverage `json:"datasets"`
	Plants        GridPlantCoverage     `json:"plants"`
	Network       GridNetworkCoverage   `json:"network"`
	LoadConflicts GridLoadConflicts     `json:"load_conflicts"`
}

// GridStoreReport is whether the store can be reached, and what it holds.
//
// UNREACHABLE IS A STRING, NOT AN ERROR, for the reason pyenv.InspectPython
// records a broken interpreter the same way: the environment surface has to
// render WHY rather than throw. Three distinct failures reach a user here and
// each needs a different action — psycopg absent is an install, a refused
// connection is a server that is not running, and a missing PostGIS extension
// is a database that exists but was never prepared.
//
// It doubles as the health probe because it cannot be answered without opening
// the connection and reading the load ledger. An answer at all means the
// database is reachable and carries the schema.
type GridStoreReport struct {
	// The connection as it will be used, with any password removed.
	DSN string `json:"dsn"`
	// What decided it: "TERRA_BR_DSN", "chosen" or "default".
	DSNSource   string `json:"dsn_source"`
	Reachable   bool   `json:"reachable"`
	Unreachable string `json:"unreachable,omitempty"`
	// Absent when Reachable is false.
	Coverage *GridCoverage `json:"coverage,omitempty"`
}

// GridCongestionRequest asks what network an AOI could reach, and what its
// plants are already attached to.
//
// The same shape GridCurtailmentRequest has, minus the window: proximity and
// attachment are facts about a register rather than readings over a period.
type GridCongestionRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// How far to look. Omitted means 100 km, which is the sidecar's own
	// default and is stated there rather than duplicated here.
	SearchRadiusKM *float64 `json:"search_radius_km,omitempty"`
	StoreDSN       string   `json:"br_store_dsn,omitempty"`
	Label          string   `json:"label,omitempty"`
	RunLabel       string   `json:"run_label,omitempty"`
	ProjectID      string   `json:"project_id,omitempty"`
	AreaID         string   `json:"area_id,omitempty"`
}

// GridReach is one substation or circuit within the search radius.
//
// DistanceKM is to the DRAWN geometry, which for a line is the straight
// segment between its terminals. The conductor runs about 8 percent longer at
// the median and 41 at the ninetieth percentile, so this is a lower bound and
// is knowably one.
type GridReach struct {
	Name        string   `json:"name"`
	DistanceKM  float64  `json:"distance_km"`
	VoltageKV   *float64 `json:"voltage_kv"`
	CapacityMVA *float64 `json:"capacity_mva,omitempty"`
}

// GridAttachment is where a plant of this AOI actually joins the network.
//
// NOT THE NEAREST SUBSTATION, AND THAT IS THE WHOLE POINT. Sol do Cerrado sits
// 9.01 km from a bus named JAIBA, and a distance ordering answers JAIBA 500 kV
// because ONS publishes that station's 500, 230 and 138 kV buses at one
// coordinate. The plant connects at MGJAB-230-A. Same name, same point, wrong
// voltage, and every headroom figure computed from it is about the wrong
// circuit.
type GridAttachment struct {
	IDONS            string   `json:"id_ons"`
	Entity           string   `json:"entity"`
	PointCode        string   `json:"point_code"`
	PointName        string   `json:"point_name"`
	CapacityMW       *float64 `json:"capacity_mw"`
	Kind             string   `json:"kind"`
	DistanceKM       *float64 `json:"distance_km"`
	Bus              *int     `json:"bus"`
	Substation       *string  `json:"substation"`
	VoltageKV        *float64 `json:"voltage_kv"`
	VoltageConfirmed bool     `json:"voltage_confirmed"`
}

// GridBusHeadroom is what leaves a bus against what is already attached to it.
//
// REPORTED, NEVER SCORED. Across the 29 connection points where both are known
// the correlation between local occupancy and the curtailment actually
// suffered is -0.025: Barreiras II carries 350 MW on 3,475 MVA of line, ten
// percent, and the plants there lose 37 percent of their output. Local
// headroom does not explain the loss, because the binding constraint is
// upstream of the bus. A caller adding these into a suitability number asserts
// a relationship the record does not contain.
type GridBusHeadroom struct {
	Bus                      int      `json:"bus"`
	LinesInService           int      `json:"lines_in_service"`
	LinesWithPublishedRating int      `json:"lines_with_published_rating"`
	LineCapacityMVA          *float64 `json:"line_capacity_mva"`
	UnitsAttached            int      `json:"units_attached"`
	AttachedMW               *float64 `json:"attached_mw"`
	Note                     string   `json:"note"`
}

// GridRouteNote is how much longer a conductor runs than the segment measured.
type GridRouteNote struct {
	Median float64 `json:"median"`
	P90    float64 `json:"p90"`
	Note   string  `json:"note"`
}

// GridConnection is what an AOI can reach, and what it is already joined to.
//
// PROXIMITY AND ATTACHMENT ARE REPORTED APART AND NEVER MERGED. Distance says
// whether reaching the network is plausible for ground that has no plant;
// attachment says where the ground that HAS one is already joined, and the two
// disagree by a voltage level at the first site anyone checked.
type GridConnection struct {
	Reachable           bool              `json:"reachable"`
	SearchedKM          float64           `json:"searched_km"`
	Attachment          []GridAttachment  `json:"attachment"`
	AttachedBusHeadroom []GridBusHeadroom `json:"attached_bus_headroom"`
	// Where the plants AROUND this ground attach, for ground that has none of
	// its own -- which is the case a site is chosen in.
	//
	// NOT A PREDICTION OF WHERE THIS GROUND WOULD JOIN. Where a project
	// actually connects is an access opinion the operator issues and does not
	// publish. What these say is that the plants near here enter the network
	// at these points, so a project here would be asking to join the same part
	// of the system and inherit what it does to them. Empty whenever
	// Attachment is not: a weaker claim must not stand beside a stronger one
	// under the same heading.
	Neighbours                []GridAttachment  `json:"neighbours"`
	NeighbourBusHeadroom      []GridBusHeadroom `json:"neighbour_bus_headroom"`
	NearestSubstation         *GridReach        `json:"nearest_substation"`
	NearestLine               *GridReach        `json:"nearest_line"`
	Substations               []GridReach       `json:"substations"`
	Lines                     []GridReach       `json:"lines"`
	HighestVoltageKV          *float64          `json:"highest_voltage_kv"`
	CapacityPublishedFraction float64           `json:"capacity_published_fraction"`
	RouteFactor               GridRouteNote     `json:"route_factor"`
	Source                    string            `json:"source"`
	Note                      string            `json:"note"`
}

// GridCongestionAnalysis is the network beside what the plants on it suffer.
//
// The two are carried in one payload and are NOT combined, which is the
// docstring of the action that builds it: a site 1.3 km from a 440 kV line
// rated 2,664 MVA can still lose 14 percent of its output, because the
// constraint is upstream of the connection.
type GridCongestionAnalysis struct {
	Connection                   GridConnection          `json:"connection"`
	CurtailmentAtConnectedPlants *GridCurtailmentSummary `json:"curtailment_at_connected_plants"`
	Window                       GridWindow              `json:"window"`
	Note                         string                  `json:"note"`
}

// GridCurtailmentRequest asks what was withheld at the plants inside an AOI.
//
// The window is optional in both ends because the record has its own span and
// the sidecar clamps to it. Sending a decade, the way the resource products
// may, would return a fraction of the window it reported.
type GridCurtailmentRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// YYYY-MM-DD. Empty asks for the whole record.
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
	// Hours the daily profile is read in. Omitted means Brasilia, which is
	// how ONS already stamps this record.
	UTCOffset *float64 `json:"utc_offset,omitempty"`
	// How many plants the per-plant table carries.
	PlantLimit *int   `json:"plant_limit,omitempty"`
	StoreDSN   string `json:"br_store_dsn,omitempty"`
	Label      string `json:"label,omitempty"`
	RunLabel   string `json:"run_label,omitempty"`
	ProjectID  string `json:"project_id,omitempty"`
	AreaID     string `json:"area_id,omitempty"`
}

// GridWindow is what was asked for, what the record covers, and what was read.
//
// All three, because they differ and the difference is the answer to "is this
// figure about the period I meant". A response carrying only the last would
// look like it honoured a request it had clamped.
type GridWindow struct {
	Requested []string `json:"requested"`
	Record    []string `json:"record"`
	Used      []string `json:"used"`
}

// GridCurtailmentSummary is the totals over the window.
//
// THE TOTAL IS A SUM OF TWO DIFFERENT THINGS AND BOTH ARE REPORTED. WithheldMWh
// spans every half hour, so it carries the energy taken while a restriction was
// in force AND the operator's estimate error while none was -- and the second is
// frequently negative, because plants often out-produce the estimate when free.
// At one AOI those are 192,976 and -39,437, which is why the by-reason table
// sums to more than the headline.
type GridCurtailmentSummary struct {
	PlantsInAOI                 int     `json:"plants_in_aoi"`
	Window                      string  `json:"window"`
	ExpectedMWh                 float64 `json:"expected_mwh"`
	DeliveredMWh                float64 `json:"delivered_mwh"`
	WithheldMWh                 float64 `json:"withheld_mwh"`
	WithheldFraction            float64 `json:"withheld_fraction"`
	WithheldUnderRestrictionMWh float64 `json:"withheld_under_restriction_mwh"`
	EstimateGapWhenFreeMWh      float64 `json:"estimate_gap_when_free_mwh"`
	Periods                     int     `json:"periods"`
	PeriodsUnderRestriction     int     `json:"periods_under_restriction"`
	RestrictedFraction          float64 `json:"restricted_fraction"`
	TopReason                   string  `json:"top_reason"`
	TopOrigin                   string  `json:"top_origin"`
	// The same difference where no restriction was in force, at the same plants
	// over the same window. The floor below which this figure is the operator's
	// model error rather than curtailment, and it crosses zero: a withheld
	// fraction quoted without it reads as if the floor were nothing.
	UnrestrictedBaselineFraction float64 `json:"unrestricted_baseline_fraction"`
	Kind                         string  `json:"kind"`
	Basis                        string  `json:"basis"`
	Source                       string  `json:"source"`
}

// GridReasonRow is withheld energy under one reason-and-origin pair.
type GridReasonRow struct {
	Reason      string  `json:"reason"`
	Origin      string  `json:"origin"`
	Periods     int     `json:"periods"`
	WithheldMWh float64 `json:"withheld_mwh"`
	Share       float64 `json:"share"`
	Meaning     string  `json:"meaning"`
	// "local" or "systemic". The distinction that decides whether moving the
	// project helps: a systemic reason describes the subsystem and would follow
	// it to any site in it.
	Scope string `json:"scope"`
}

// GridReasonBreakdown is the split, with the share a siting decision can act on.
type GridReasonBreakdown struct {
	ByReason []GridReasonRow `json:"by_reason"`
	// The fraction of withheld energy under a LOCAL origin. Reported apart
	// because it is the only part of the total a different connection point
	// could avoid.
	ShareLocal float64 `json:"share_local"`
	Note       string  `json:"note"`
}

// GridHourRow is one hour of the local day.
//
// WithheldFraction is a pointer: an hour with no expected generation -- night,
// at a photovoltaic plant -- has no fraction, and a zero there would read as
// "nothing was withheld" rather than as "nothing was expected".
type GridHourRow struct {
	Hour               int      `json:"hour"`
	Periods            int      `json:"periods"`
	Restricted         int      `json:"restricted"`
	ExpectedMWh        float64  `json:"expected_mwh"`
	WithheldMWh        float64  `json:"withheld_mwh"`
	WithheldFraction   *float64 `json:"withheld_fraction"`
	RestrictedFraction *float64 `json:"restricted_fraction"`
}

// GridMonthRow is one published month.
type GridMonthRow struct {
	Month            string   `json:"month"`
	ExpectedMWh      float64  `json:"expected_mwh"`
	WithheldMWh      float64  `json:"withheld_mwh"`
	Restricted       int      `json:"restricted"`
	Periods          int      `json:"periods"`
	WithheldFraction *float64 `json:"withheld_fraction"`
}

// GridPlantRow is one plant, which is the resolution the record actually has.
//
// The aggregate hides the spread: plants inside one AOI share a subsystem and
// often a cluster and still differ, and the total is dominated by the largest.
type GridPlantRow struct {
	IDONS              string   `json:"id_ons"`
	Plant              string   `json:"plant"`
	Cluster            string   `json:"cluster"`
	ExpectedMWh        float64  `json:"expected_mwh"`
	WithheldMWh        float64  `json:"withheld_mwh"`
	Restricted         int      `json:"restricted"`
	Periods            int      `json:"periods"`
	WithheldFraction   *float64 `json:"withheld_fraction"`
	RestrictedFraction *float64 `json:"restricted_fraction"`
	// Where the plant stands, so the row can be DRAWN and not only listed.
	//
	// Pointers, because absence is a real state and zero is a place. ANEEL
	// writes a missing coordinate as 0.0 and 432 of its 25,130 enterprises
	// carry one; read as a number that puts them in the Gulf of Guinea, which
	// is the defect store.py records for the register itself. A plant with no
	// point stays in the table and stays off the map.
	Lat *float64 `json:"lat"`
	Lon *float64 `json:"lon"`
}

// GridCurtailmentAnalysis is one reading of the record over one AOI.
//
// SUMMARY IS A POINTER AND NIL IS A REAL ANSWER. An AOI with no metered plant
// gets nothing rather than zero: zero would read as "nothing was curtailed
// here" where the truth is "nothing here is measured", and no neighbour's
// figure is borrowed to fill it.
type GridCurtailmentAnalysis struct {
	Window   GridWindow              `json:"window"`
	Summary  *GridCurtailmentSummary `json:"summary"`
	ByReason *GridReasonBreakdown    `json:"by_reason,omitempty"`
	ByHour   []GridHourRow           `json:"by_hour,omitempty"`
	ByMonth  []GridMonthRow          `json:"by_month,omitempty"`
	ByPlant  []GridPlantRow          `json:"by_plant,omitempty"`
	// Present exactly when Summary is nil, saying why.
	Note  string `json:"note,omitempty"`
	RunID string `json:"run_id,omitempty"`
}

// GridFigureRequest asks for one analysis of the published research series.
//
// One request type for all twelve. They share the store, the window and the
// table shape, and differ only in which module answers -- the same argument
// that made the sidecar's action registry a table rather than twelve imports.
type GridFigureRequest struct {
	// 1..12. The sidecar refuses a number it does not compute rather than
	// falling through to a default, because a figure is a specific finding and
	// there is no sensible substitute for the one that was asked for.
	Figure int `json:"figure"`
	// Required by a site-scoped figure and REFUSED by a system-scoped one.
	// Refused rather than ignored: a national correlation answered over one
	// polygon is a different quantity under the same name, and silently
	// dropping the polygon would let a caller believe it had been honoured.
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// YYYY-MM-DD. Empty reads the whole record.
	//
	// WORTH SETTING DELIBERATELY. The research notebooks read to the last
	// COMPLETE month; reading one month further changed Fig. 1's day count
	// from 852 to 883 and every energy figure with it -- 3.6 percent, entirely
	// window and nothing to do with the analysis.
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`

	StoreDSN  string `json:"br_store_dsn,omitempty"`
	Label     string `json:"label,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	AreaID    string `json:"area_id,omitempty"`
}

// GridFigureTable is one panel's data, in the shape terra's own tables use.
//
// Columns and rows rather than a typed struct per panel, because there are
// about forty panels across the series and each has its own columns. The
// interface draws from this and the research pack exports from the same
// object, so a figure read on screen can be cited from the CSV without being
// re-derived.
type GridFigureTable struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// GridFigureAnalysis is one figure of the series, as numbers rather than as a
// picture.
//
// PYTHON COMPUTES AND THE SCREEN DRAWS, which is the split experiments/ already
// states for this repository's own research figures. The published figure is
// 183 mm at 7 pt, and frontend/src/lib/figure.ts records why that does not
// survive a screen: about 7.3 px in a 540 px panel, under the 9 px floor the
// interface holds in twenty-one places. Returning the tables also makes the
// port checkable against the research's own CSVs, which a bitmap never could --
// and it is checked: sidecar/tests/test_grid_figures.py compares them.
type GridFigureAnalysis struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	// "site" or "system".
	Scope string `json:"scope"`
	// Figures whose reading this one corrects, delimits or demotes.
	//
	// Carried with the result because four of the twelve retire an earlier
	// one: Fig. 6 corrects Fig. 5, Fig. 9 withdraws Fig. 8's causal reading,
	// Fig. 11 delimits Fig. 10, Fig. 12 demotes Fig. 10's headline to one
	// robustness test in three. A reader shown the earlier figure alone is
	// reading something the series itself withdrew.
	Supersedes []int `json:"supersedes"`
	// Stated limits that are part of the finding rather than boilerplate.
	Caveats []string `json:"caveats"`
	// The figure's own headline numbers, whose keys differ per figure.
	Headline map[string]any `json:"headline"`
	// Counts the published caption states -- rows read, rows carrying a
	// restriction, rows whose reference fell below verified generation. Not
	// diagnostics: the third is what tells a reader the clip is doing
	// something.
	Integrity map[string]any             `json:"integrity"`
	Tables    map[string]GridFigureTable `json:"tables"`
	RunID     string                     `json:"run_id,omitempty"`
}
