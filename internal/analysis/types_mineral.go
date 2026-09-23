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
	// Passes read before stopping, best first. Zero means the sidecar default.
	MaxScenes int    `json:"max_scenes"`
	Label     string `json:"label"`
	RunLabel  string `json:"run_label"`
	AreaID    string `json:"area_id"`
	ProjectID string `json:"project_id"`
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
	// Every group's entry index, fit and depth, one band each, EPSG:4326.
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
	for i := range m.Groups {
		if m.Groups[i].Classes == nil {
			m.Groups[i].Classes = []MineralClassRow{}
		}
		if m.Groups[i].Entries == nil {
			m.Groups[i].Entries = []MineralEntryRow{}
		}
	}
}
