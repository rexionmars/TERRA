package analysis

/*
Management zones: a field divided into three to five parts that have grown
alike over several seasons (sidecar/terra/zones), after Management Zone
Analyst (Fridgen et al., 2004).

Each season -- the requested period and EarlierSeasons before it -- gives one
NDVI layer, each cell's 90th percentile over the season's clear acquisitions.
The layers are standardised and clustered by fuzzy c-means for three, four and
five zones; the fuzziness performance index (FPI) and the normalised
classification entropy (NCE) of each partition say how clearly it separates,
and SuggestedK is the number that ranks best on the two. Every partition is
returned, so the number can be changed.

THE ZONES ARE WHERE THE CANOPY DIFFERED, NOT WHY. Soil, drainage, compaction,
a past management line or a pest patch draw the same boundary.
*/

// ZonesRequest asks for the zones of one field.
type ZonesRequest struct {
	PolygonGeoJSON *GeoJSONGeometry `json:"polygon_geojson"`
	Start          string           `json:"start"`
	End            string           `json:"end"`
	MaxCloud       float64          `json:"max_cloud"`
	// Seasons before the period that are read as well; zero takes the sidecar
	// default of three.
	EarlierSeasons int    `json:"earlier_seasons"`
	Label          string `json:"label,omitempty"`
	RunLabel       string `json:"run_label,omitempty"`
	AreaID         string `json:"area_id,omitempty"`
	ProjectID      string `json:"project_id,omitempty"`
}

// ZonesSeason is one season read, and whether it was used.
type ZonesSeason struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	NScenes int    `json:"n_scenes"`
	// Acquisitions that saw at least 30% of the field clearly.
	NClear int `json:"n_clear"`
	// Share of the field with enough clear acquisitions for a value, 0-1.
	Cover float64 `json:"cover"`
	Used  bool    `json:"used"`
}

// Zone is one zone of a partition, numbered from the lowest NDVI.
type Zone struct {
	Zone     int      `json:"zone"`
	AreaHa   float64  `json:"area_ha"`
	Share    float64  `json:"share"`
	NDVIMean *float64 `json:"ndvi_mean"`
	// The zone's mean of each used season's layer, in season order.
	SeasonNDVI []*float64 `json:"season_ndvi"`
	Colour     string     `json:"colour"`
}

// zonesSidecarPartition is one partition as the sidecar writes it.
type zonesSidecarPartition struct {
	K            int     `json:"k"`
	FPI          float64 `json:"fpi"`
	NCE          float64 `json:"nce"`
	Iterations   int     `json:"iterations"`
	Zones        []Zone  `json:"zones"`
	ZonesGeoJSON string  `json:"zones_geojson"`
	PNG          string  `json:"png"`
}

// ZonesPartition is one partition: K zones, how clearly they separate, their
// polygons as GeoJSON text in WGS84, and their map as a data URI.
type ZonesPartition struct {
	K            int     `json:"k"`
	FPI          float64 `json:"fpi"`
	NCE          float64 `json:"nce"`
	Iterations   int     `json:"iterations"`
	Zones        []Zone  `json:"zones"`
	ZonesGeoJSON string  `json:"zones_geojson"`
	MapURI       string  `json:"map_uri"`
}

// zonesSidecarResult is the sidecar's `zones` object.
type zonesSidecarResult struct {
	Extent     Bounds                  `json:"extent"`
	Seasons    []ZonesSeason           `json:"seasons"`
	NCells     int                     `json:"n_cells"`
	FieldCells int                     `json:"field_cells"`
	Fuzziness  float64                 `json:"fuzziness"`
	Percentile float64                 `json:"percentile"`
	MinZoneHa  float64                 `json:"min_zone_ha"`
	SuggestedK int                     `json:"suggested_k"`
	Partitions []zonesSidecarPartition `json:"partitions"`
}

// ZonesAnalysis is what the interface receives.
type ZonesAnalysis struct {
	Extent  Bounds        `json:"extent"`
	Seasons []ZonesSeason `json:"seasons"`
	// Cells clustered: those of the field with a value in every used season.
	NCells     int              `json:"n_cells"`
	FieldCells int              `json:"field_cells"`
	Fuzziness  float64          `json:"fuzziness"`
	Percentile float64          `json:"percentile"`
	MinZoneHa  float64          `json:"min_zone_ha"`
	SuggestedK int              `json:"suggested_k"`
	Partitions []ZonesPartition `json:"partitions"`
	RunID      string           `json:"run_id,omitempty"`
}

// NormalizeNilSlices turns absent lists into empty ones, which the interface
// reads as "none" rather than as a value missing.
func (z *ZonesAnalysis) NormalizeNilSlices() {
	if z.Seasons == nil {
		z.Seasons = []ZonesSeason{}
	}
	if z.Partitions == nil {
		z.Partitions = []ZonesPartition{}
	}
	for i := range z.Partitions {
		if z.Partitions[i].Zones == nil {
			z.Partitions[i].Zones = []Zone{}
		}
		for j := range z.Partitions[i].Zones {
			if z.Partitions[i].Zones[j].SeasonNDVI == nil {
				z.Partitions[i].Zones[j].SeasonNDVI = []*float64{}
			}
		}
	}
}

// Partition returns the partition into k zones, or nil.
func (z *ZonesAnalysis) Partition(k int) *ZonesPartition {
	for i := range z.Partitions {
		if z.Partitions[i].K == k {
			return &z.Partitions[i]
		}
	}
	return nil
}
