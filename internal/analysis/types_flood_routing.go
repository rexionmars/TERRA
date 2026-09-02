package analysis

// Overland routing: rain moved across the AOI, as depth, speed and arrival.
//
// A separate product from the flood envelope next door and deliberately a
// separate contract. The envelope is static and measures how much of a HAND
// extent follows from the choice of DEM; this one routes an actual flow and is
// answered by fields in time.
//
// A second mode routed a breach hydrograph and has been removed. Not for want
// of hydraulics -- the equations are the same either way -- but because nothing
// could reliably decide WHERE a channel enters a drawn polygon: ranking the
// boundary by accumulated flow finds the outlet, and so does ranking it by how
// far the water then travels. It can return once the inlet arrives as a
// coordinate the caller gives rather than a guess. Rain needs no such point.
//
// WHAT THE FIGURES COVER. As with the envelope, the DEM is read beyond the AOI
// so that flow arrives correctly, and every count, area and spread reported
// here is nevertheless taken over the cells inside the AOI polygon. The
// buffered window survives as provenance in Grid alone.
//
// THE THREE FIELDS THAT ARE NOT DECORATION. LakeAtRestResidualMS is the
// well-balancing check, run on the actual bed before the flow: an unbalanced
// scheme manufactures currents on every slope and each depth would be that
// error plus the flow. Volume.LeftFraction says whether the water reached an
// outlet at all -- a domain that stores everything it was given reports a
// filling level, not a routed wave. ResolutionM says which cell size the
// answer is for, because the cost is cells times timesteps and a coarser run
// is the usual way to get one at all.

// FloodRoutingRequest selects an AOI and what to route over it.
//
// The parameters are pointers for the reason FloodRequest gives: absence is
// what selects the sidecar's default, and zero is a legitimate request for
// none of these -- a zero volume, a zero rain rate or a zero duration is a
// request for nothing to happen, which the sidecar refuses by name.
type FloodRoutingRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson,omitempty"`
	// Which DEM to route over, by dem.COLLECTIONS id. Empty selects cop30.
	// One product and not the envelope's four: this is not a disagreement
	// measure, and the extent still moves with the choice, which is why the
	// id travels back in the result.
	DEMID string `json:"dem_id,omitempty"`
	// Cell size for the routing, in metres. Empty routes at the DEM's native
	// resolution, which for a large AOI is slower than a user will wait.
	ResolutionM *float64 `json:"resolution_m,omitempty"`
	// How far beyond the AOI to read the DEM. Empty sizes it from the AOI.
	BufferM *float64 `json:"buffer_m,omitempty"`
	// Simulated duration in minutes. Empty selects 60.
	Minutes *float64 `json:"minutes,omitempty"`
	// Lumped Manning n. Empty selects 0.05. A calibration parameter standing
	// in for sediment load and bed roughness together, not a measurement.
	Manning *float64 `json:"manning,omitempty"`

	// The rainfall rate and how long it falls. Required.
	RainMMH     *float64 `json:"rain_mm_h,omitempty"`
	RainMinutes *float64 `json:"rain_minutes,omitempty"`
}

// FloodRoutingSpread is one field's median and the range that matters.
//
// Pointers because a run where nothing wetted has no median, and zero is a
// depth. The panel shows a dash for absent rather than a plausible 0.00 m.
type FloodRoutingSpread struct {
	Median *float64 `json:"median"`
	P90    *float64 `json:"p90"`
	Max    *float64 `json:"max"`
}

// FloodRoutingAOI counts what happened inside the polygon, not the window.
type FloodRoutingAOI struct {
	Cells           int     `json:"cells"`
	AreaKm2         float64 `json:"area_km2"`
	FloodedCells    int     `json:"flooded_cells"`
	FloodedKm2      float64 `json:"flooded_km2"`
	FloodedFraction float64 `json:"flooded_fraction"`
	// What share of the flooded cells sit on the AOI's own boundary ring.
	//
	// A channel crossing an area touches that ring twice, where it enters and
	// where it leaves, so this stays low. It goes high when the polygon CLIPS
	// a valley instead of holding it -- the routing is still correct and still
	// follows the real channel, but the reach inside the drawing is a fragment
	// and every figure beside this one describes the fragment. Visible on the
	// map as a flow that hugs one edge; invisible to a reader who is reading
	// the numbers, which is why it is a number.
	OnBoundaryFraction float64 `json:"on_boundary_fraction"`
}

// FloodRoutingVolume is the mass balance, reported rather than assumed.
type FloodRoutingVolume struct {
	// What the boundary actually put into the domain, measured cell by cell.
	InM3     float64 `json:"in_m3"`
	StoredM3 float64 `json:"stored_m3"`
	// Measured across the boundary step by step, not differenced. A
	// conservative scheme cancels every interior flux, so the mass the domain
	// loses over one step IS what crossed its edge once the positivity clip is
	// taken back out -- and differencing instead reported an inflow of -779 Mm3
	// on a real AOI, which was the accounting rather than the flow.
	OutM3 float64 `json:"out_m3"`
	// What the positivity clip at the wetting front invented. Small on a
	// healthy run, and the first place to look when the balance does not close.
	// Reported because a balance that hides its own source term is not a
	// balance.
	ClippedM3 float64 `json:"clipped_m3"`
	// What share of the water reached a boundary and left. Near zero means the
	// flow never found an outlet inside this AOI and the depths are a filling
	// level; the panel says so rather than leaving the reader to notice.
	LeftFraction float64 `json:"left_fraction"`
}

// FloodRoutingRain is the rate that fell and for how long.
type FloodRoutingRain struct {
	MMH     float64 `json:"mm_h"`
	Minutes float64 `json:"minutes"`
}

// FloodRoutingCellSize is the ground size of one cell, both ways.
type FloodRoutingCellSize struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// FloodRoutingAnalysis is one routed run.
type FloodRoutingAnalysis struct {
	DEMID       string  `json:"dem_id"`
	Minutes     float64 `json:"minutes"`
	Manning     float64 `json:"manning"`
	Steps       int     `json:"steps"`
	VoidsFilled int     `json:"void_cells_filled"`

	// The lake-at-rest residual, in m/s. Machine noise on a well-balanced
	// scheme. The sidecar refuses to report a run above 1e-6, so a value that
	// arrives here has already passed; it is carried so the panel can show
	// that the check ran rather than only that it passed.
	LakeAtRestResidualMS float64 `json:"lake_at_rest_residual_ms"`

	ResolutionM float64 `json:"resolution_m"`
	// Set when the DEM was coarsened before routing, holding the native cell
	// size it came from. Nil when the run used the product as read.
	CoarsenedFromM *float64 `json:"coarsened_from_m"`

	Grid     FloodGrid            `json:"grid"`
	CellSize FloodRoutingCellSize `json:"cell_size_m"`
	AOI      FloodRoutingAOI      `json:"aoi"`

	DepthM     FloodRoutingSpread `json:"depth_m"`
	SpeedMS    FloodRoutingSpread `json:"speed_ms"`
	ArrivalMin FloodRoutingSpread `json:"arrival_min"`
	Volume     FloodRoutingVolume `json:"volume"`

	Rain FloodRoutingRain `json:"rain"`

	// What the run assumed, in the caller's own words rather than a footnote:
	// the water model, the terrain, and the boundary. Shown in the panel.
	Assumptions map[string]string `json:"assumptions"`

	// The depth raster over the whole computed window, on Grid. A path into the
	// run's work directory, which AnalyzeFloodRouting deliberately leaves in
	// place for the reason AnalyzeFlood gives about its agreement raster.
	DepthTIF string `json:"depth_tif"`
	// The same depths clipped to the AOI and coloured, for the map. The webview
	// cannot open a path on disk, so DepthURI carries it; added by
	// AnalyzeFloodRouting and not by the sidecar.
	DepthPNG     string  `json:"depth_png"`
	DepthURI     string  `json:"depth_uri,omitempty"`
	DepthPNGMaxM float64 `json:"depth_png_max_m"`
	// Where to put the PNG. The extent of the CLIPPED image, not of Grid: those
	// describe the buffered window and placing the image on them would stretch
	// it over ground it does not cover.
	//
	// Bounds and not a []float64, which is what this was and what made the
	// first run fail to parse. composite.extent_from_profile returns an OBJECT
	// -- lon_min, lat_min, lon_max, lat_max -- and every other payload that
	// places an overlay types it as Bounds for exactly that reason. The
	// Go/TypeScript contract check did not catch it: it compares structs
	// against same-named interfaces, and this one has none yet, so it sat in
	// the unguarded set the check reports by count.
	Extent Bounds `json:"extent"`
}

// NormalizeNilSlices gives the frontend an empty array where the sidecar sent
// null, for the reason the other payloads carry the same method: TypeScript
// reads a null where it expects a list and the panel throws on .length.
func (f *FloodRoutingAnalysis) NormalizeNilSlices() {
	if f.Assumptions == nil {
		f.Assumptions = map[string]string{}
	}
}
