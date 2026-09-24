package analysis

/*
Surface mineralogy from EMIT imaging spectroscopy, identified by Tetracorder.

Tetracorder (Clark et al., 2003, JGR 108(E12) 5131; Clark et al., 2024, PSJ
5:276) compares the diagnostic absorptions of each observed spectrum with those
of reference spectra, after continuum removal, and keeps the best match per
wavelength region. The sidecar runs a port of it with the public expert system
nearest the one the EMIT L2B product records and the libraries convolved to
EMIT's channels, over EMIT L2A reflectance read from the LP DAAC for the area
alone.

WHAT IT IS NOT. Band depth rises with the abundance of the matched mineral at a
fixed grain size, but it is not an abundance: no unmixing is done, and a deeper
band in one cell than another is not a larger fraction of that mineral. Green
vegetation, water and dense cloud each suppress the mineral answer entirely,
which over most of Brazil is the common case rather than the exception, so the
observed and identified cell counts travel with every figure.
*/

// MineralRequest asks for the mineral map of one area over a period.
type MineralRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	// The acquisitions considered. Mineralogy does not change between passes,
	// so the period only bounds which passes are searched; each cell takes its
	// answer from one pass, never an average.
	Start string `json:"start"`
	End   string `json:"end"`
	// Scene-level cloud cover, percent, above which a pass is not read. Zero
	// means no ceiling, the frontend's choice: cells under cloud inside a pass
	// are excluded by the EMIT mask, and passes are read least cloudy first.
	MaxCloud float64 `json:"max_cloud"`
	// Passes compared per cell, best ranked first; each cell takes its answer
	// from the one its ground is most exposed in. Zero means the sidecar
	// default.
	MaxScenes int `json:"max_scenes"`
	// Classifications of the reflectance perturbed by its reported
	// uncertainty, for the stability of each cell's class. Zero skips them:
	// each costs a full classification, and the uncertainty is a second cube
	// as large as the reflectance.
	UncertaintyDraws int    `json:"uncertainty_draws"`
	Label            string `json:"label"`
	RunLabel         string `json:"run_label"`
	AreaID           string `json:"area_id"`
	ProjectID        string `json:"project_id"`
}

// MineralScene is one EMIT pass that contributed cells.
type MineralScene struct {
	Granule     string   `json:"granule"`
	Date        string   `json:"date"`
	CloudCover  *float64 `json:"cloud_cover"`
	MaskGranule string   `json:"mask_granule"`
	// Cells this pass answered for, and cells it saw only under its mask.
	Cells       int `json:"cells"`
	MaskedCells int `json:"masked_cells"`
	// Largest difference between this scene's band centres and those the
	// reference library was convolved to, in nanometres. Channels are matched
	// by index, as Tetracorder matches them.
	WavelengthOffsetNm float64 `json:"wavelength_offset_nm"`
	// Cells this pass observed usably, of those the ones it showed exposed --
	// free of green vegetation and plant residue -- and of the cells it
	// answered for the ones exposed in it.
	CandidateCells     int `json:"candidate_cells"`
	ExposedCells       int `json:"exposed_cells"`
	ChosenExposedCells int `json:"chosen_exposed_cells"`
	// The EMIT L2B fractional cover and mineral granules of the same
	// acquisition, empty where none exists.
	FrcovGranule string `json:"frcov_granule"`
	L2BGranule   string `json:"l2b_granule"`
	// The acquisition time, "2024-08-30 13:54 UTC".
	Acquired string `json:"acquired"`
}

// MineralSelection says how each cell's pass was chosen, and how many cells
// were exposed in the pass they were taken from.
type MineralSelection struct {
	Rule               string  `json:"rule"`
	ComparedPasses     int     `json:"compared_passes"`
	ContributingPasses int     `json:"contributing_passes"`
	ExposedCells       int     `json:"exposed_cells"`
	ExposedAreaHa      float64 `json:"exposed_area_ha"`
}

// MineralCoverGroup is the identified area over cells EMIT L2B FRCOV counts
// as bare ground, for one group.
type MineralCoverGroup struct {
	Group            int     `json:"group"`
	IdentifiedCells  int     `json:"identified_cells"`
	IdentifiedAreaHa float64 `json:"identified_area_ha"`
}

// MineralCover is the EMIT L2B fractional cover of the passes used, over the
// cells that have it.
type MineralCover struct {
	Product       string              `json:"product"`
	Cells         int                 `json:"cells"`
	AreaHa        float64             `json:"area_ha"`
	MeanPV        float64             `json:"mean_pv"`
	MeanNPV       float64             `json:"mean_npv"`
	MeanBare      float64             `json:"mean_bare"`
	BareThreshold float64             `json:"bare_threshold"`
	BareCells     int                 `json:"bare_cells"`
	BareAreaHa    float64             `json:"bare_area_ha"`
	Groups        []MineralCoverGroup `json:"groups"`
}

// MineralSpread is a distribution: count, mean, standard deviation and the
// 10th, 50th and 90th percentiles.
type MineralSpread struct {
	Cells int     `json:"cells"`
	Mean  float64 `json:"mean"`
	SD    float64 `json:"sd"`
	P10   float64 `json:"p10"`
	P50   float64 `json:"p50"`
	P90   float64 `json:"p90"`
}

// MineralPositionClass is the fitted band position over the cells of one
// class, as a MineralSpread's fields beside the class. Written out rather than
// embedded, so the TypeScript the bindings generate has them.
type MineralPositionClass struct {
	Class string  `json:"class"`
	Label string  `json:"label"`
	Cells int     `json:"cells"`
	Mean  float64 `json:"mean"`
	SD    float64 `json:"sd"`
	P10   float64 `json:"p10"`
	P50   float64 `json:"p50"`
	P90   float64 `json:"p90"`
}

// MineralPositionReference is the same measurement on the library references
// of one class: the yardstick a cell's position is read against.
type MineralPositionReference struct {
	Class      string  `json:"class"`
	References int     `json:"references"`
	MinNm      float64 `json:"min_nm"`
	MaxNm      float64 `json:"max_nm"`
	MedianNm   float64 `json:"median_nm"`
}

// MineralRamp is how a continuous layer was coloured: min and max clamp, and
// the colours are spaced evenly between them.
type MineralRamp struct {
	Min    float64  `json:"min"`
	Max    float64  `json:"max"`
	Unit   string   `json:"unit"`
	Colors []string `json:"colors"`
	Low    string   `json:"low"`
	High   string   `json:"high"`
}

// MineralPosition is one absorption's fitted wavelength over the cells whose
// class makes it: the Fe3+ band (hematite against goethite) or the Al-OH band
// (white mica composition).
type MineralPosition struct {
	Key        string                     `json:"key"`
	Title      string                     `json:"title"`
	Unit       string                     `json:"unit"`
	Group      int                        `json:"group"`
	Classes    []MineralPositionClass     `json:"classes"`
	References []MineralPositionReference `json:"references"`
	Ramp       MineralRamp                `json:"ramp"`
}

// MineralConfidence is how firmly one group's answers stood: the margin of
// each answer's fit over the best reference of another class, and, when draws
// were asked for, how often the class held under the reflectance uncertainty.
type MineralConfidence struct {
	Group       int            `json:"group"`
	Margin      *MineralSpread `json:"margin"`
	Draws       int            `json:"draws"`
	Stability   *MineralSpread `json:"stability,omitempty"`
	StableCells int            `json:"stable_cells"`
}

// MineralClassPair is one disagreement: the class here, the class EMIT L2B
// gave the same pixel, and how many cells.
type MineralClassPair struct {
	Here  string `json:"here"`
	L2B   string `json:"l2b"`
	Cells int    `json:"cells"`
}

// MineralAgreement compares one group's classes with the EMIT L2B product's.
type MineralAgreement struct {
	Group         int      `json:"group"`
	Granules      []string `json:"granules"`
	ComparedCells int      `json:"compared_cells"`
	Agree         int      `json:"agree"`
	Differ        int      `json:"differ"`
	PortOnly      int      `json:"port_only"`
	L2BOnly       int      `json:"l2b_only"`
	Neither       int      `json:"neither"`
	// Agree over agree plus differ: of the cells both identified, the share
	// given the same class. Null where there were none.
	AgreeFractionOfBoth *float64           `json:"agree_fraction_of_both"`
	Pairs               []MineralClassPair `json:"pairs"`
}

// MineralAcidSulfateRow is the area whose answer is one mineral of acid mine
// drainage, with the setting the literature ties it to. Groups counts the
// cells by the group the match was made in, keyed "1" and "2": a group 2
// match rests on a band specific to the mineral, a group 1 match on the broad
// Fe3+ bands it shares with goethite.
type MineralAcidSulfateRow struct {
	Key     string         `json:"key"`
	Label   string         `json:"label"`
	Setting string         `json:"setting"`
	Color   string         `json:"color"`
	Cells   int            `json:"cells"`
	AreaHa  float64        `json:"area_ha"`
	Groups  map[string]int `json:"groups"`
}

// MineralLayerLegendItem is one colour of a class layer. Excluded marks a
// colour that is not a class, such as the cells observed only under the mask.
type MineralLayerLegendItem struct {
	Label    string `json:"label"`
	Color    string `json:"color"`
	Excluded bool   `json:"excluded,omitempty"`
}

// MineralLayer is one derived raster: the pass each cell was taken from, the
// exposure, the fractional cover, a band position, a fit margin, an agreement
// with L2B. Kind says how it is read -- "classes", "ramp" or "rgb" -- and
// which of Legend, Ramp and Channels describes it.
type MineralLayer struct {
	ID       string                   `json:"id"`
	Title    string                   `json:"title"`
	Kind     string                   `json:"kind"`
	PNG      string                   `json:"png"`
	URI      string                   `json:"uri,omitempty"`
	Legend   []MineralLayerLegendItem `json:"legend,omitempty"`
	Ramp     *MineralRamp             `json:"ramp,omitempty"`
	Channels map[string]string        `json:"channels,omitempty"`
	About    string                   `json:"about"`
}

// MineralClassRow is the area identified as one class within one group.
type MineralClassRow struct {
	Class              string  `json:"class"`
	Label              string  `json:"label"`
	Color              string  `json:"color"`
	Cells              int     `json:"cells"`
	AreaHa             float64 `json:"area_ha"`
	FractionOfObserved float64 `json:"fraction_of_observed"`
	MeanDepth          float64 `json:"mean_depth"`
}

// MineralEntryRow is one Tetracorder reference and the cells it won.
type MineralEntryRow struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Class     string  `json:"class"`
	Cells     int     `json:"cells"`
	AreaHa    float64 `json:"area_ha"`
	MeanFit   float64 `json:"mean_fit"`
	MeanDepth float64 `json:"mean_depth"`
}

// MineralGroup is the answer of one Tetracorder group: group 1 reads the
// Fe2+/Fe3+ electronic absorptions below about 1.3 um, group 2 the vibrational
// absorptions of 2.0-2.5 um. A cell carries one answer from each.
type MineralGroup struct {
	Group          int     `json:"group"`
	Label          string  `json:"label"`
	DetectedCells  int     `json:"detected_cells"`
	DetectedAreaHa float64 `json:"detected_area_ha"`
	// Classes by area, largest first, and the references behind them.
	Classes []MineralClassRow `json:"classes"`
	Entries []MineralEntryRow `json:"entries"`
	// The class map as the sidecar wrote it, and as a data URI for the map.
	ClassPNG string `json:"class_png"`
	ClassURI string `json:"class_uri,omitempty"`
}

// MineralLegendItem is one class colour, as the PNGs were drawn with it.
type MineralLegendItem struct {
	Class string `json:"class"`
	Label string `json:"label"`
	Color string `json:"color"`
}

// MineralAnalysis is the mineral map of one area.
type MineralAnalysis struct {
	RunID        string   `json:"run_id,omitempty"`
	Sensor       string   `json:"sensor"`
	ExpertSystem string   `json:"expert_system"`
	Libraries    []string `json:"libraries"`
	// The area in cells of the output grid, how much of it a pass observed
	// without cloud, and how much was seen only under the mask.
	AOICells       int     `json:"aoi_cells"`
	AOIAreaHa      float64 `json:"aoi_area_ha"`
	ObservedCells  int     `json:"observed_cells"`
	ObservedAreaHa float64 `json:"observed_area_ha"`
	MaskedCells    int     `json:"masked_cells"`
	// Output cell size in degrees, longitude then latitude.
	CellSizeDeg []float64           `json:"cell_size_deg"`
	Scenes      []MineralScene      `json:"scenes"`
	Groups      []MineralGroup      `json:"groups"`
	Legend      []MineralLegendItem `json:"legend"`
	// Null in a run saved before the pass of each cell was chosen.
	Selection   *MineralSelection       `json:"selection"`
	Cover       *MineralCover           `json:"cover"`
	Positions   []MineralPosition       `json:"positions"`
	Confidence  []MineralConfidence     `json:"confidence"`
	Agreement   []MineralAgreement      `json:"agreement"`
	AcidSulfate []MineralAcidSulfateRow `json:"acid_sulfate"`
	Layers      []MineralLayer          `json:"layers"`
	// Every quantity per cell, one band each, named in its band description,
	// EPSG:4326.
	GeoTIFF string `json:"geotiff"`
	Extent  Bounds `json:"extent"`
	// What a reader needs to read the figures, written by the sidecar.
	Notes []string `json:"notes"`
}

// NormalizeNilSlices turns absent lists into empty ones, so the frontend can
// iterate every list without a null check.
func (m *MineralAnalysis) NormalizeNilSlices() {
	if m.Libraries == nil {
		m.Libraries = []string{}
	}
	if m.CellSizeDeg == nil {
		m.CellSizeDeg = []float64{}
	}
	if m.Scenes == nil {
		m.Scenes = []MineralScene{}
	}
	if m.Groups == nil {
		m.Groups = []MineralGroup{}
	}
	if m.Legend == nil {
		m.Legend = []MineralLegendItem{}
	}
	if m.Notes == nil {
		m.Notes = []string{}
	}
	if m.Positions == nil {
		m.Positions = []MineralPosition{}
	}
	if m.Confidence == nil {
		m.Confidence = []MineralConfidence{}
	}
	if m.Agreement == nil {
		m.Agreement = []MineralAgreement{}
	}
	if m.AcidSulfate == nil {
		m.AcidSulfate = []MineralAcidSulfateRow{}
	}
	if m.Layers == nil {
		m.Layers = []MineralLayer{}
	}
	for i := range m.Agreement {
		if m.Agreement[i].Pairs == nil {
			m.Agreement[i].Pairs = []MineralClassPair{}
		}
		if m.Agreement[i].Granules == nil {
			m.Agreement[i].Granules = []string{}
		}
	}
	for i := range m.Groups {
		if m.Groups[i].Classes == nil {
			m.Groups[i].Classes = []MineralClassRow{}
		}
		if m.Groups[i].Entries == nil {
			m.Groups[i].Entries = []MineralEntryRow{}
		}
	}
}
