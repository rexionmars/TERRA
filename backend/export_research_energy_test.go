package backend

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// loadSidecarFixture reads a recorded sidecar payload and unmarshals the block
// under the given top-level key, so the exporter is exercised against the shape
// the sidecar actually emits.
func loadSidecarFixture(t *testing.T, name, key string, dst any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Skipf("fixture %s not available: %v", name, err)
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	block, ok := wrapped[key]
	if !ok {
		t.Fatalf("%s carries no %q key", name, key)
	}
	if err := json.Unmarshal(block, dst); err != nil {
		t.Fatalf("unmarshal %s from %s: %v", key, name, err)
	}
}

func zipEntries(t *testing.T, zipBytes []byte) map[string]*zip.File {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	return files
}

func readCSV(t *testing.T, f *zip.File) [][]string {
	t.Helper()
	if f == nil {
		t.Fatal("missing zip entry")
	}
	rows, err := csv.NewReader(bytes.NewReader(mustReadZip(t, f))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// TestResearchPackEnergyAndWindTables checks that the energy model and the wind
// screening reach the research pack: every table the registry declares for them
// is written, its header is the registered column list, and the manifest
// carries the assumptions the figures were produced under.
func TestResearchPackEnergyAndWindTables(t *testing.T) {
	var energy EnergyModelAnalysis
	loadSidecarFixture(t, "energy_model_b.json", "energy_model", &energy)
	energy.NormalizeNilSlices()

	var wind WindAnalysis
	loadSidecarFixture(t, "wind_b.json", "wind", &wind)
	wind.NormalizeNilSlices()

	result := &PredictResult{EnergyModel: &energy, Wind: &wind}
	meta := ResearchExportMeta{ModelKind: "NASA POWER", AoiLabel: "Propriedade B"}

	zipBytes, err := BuildResearchPackZIP(meta, result, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	files := zipEntries(t, zipBytes)

	expectedRows := map[string]int{
		// Header plus data rows, counted from the fixture.
		"energy_loss_waterfall.csv":          1 + len(energy.LossWaterfall.Steps),
		"energy_declared_losses.csv":         1 + len(energy.PerformanceRatio.DeclaredLosses),
		"energy_tracking_seasonal.csv":       1 + len(energy.Tracking.Seasonal.Rows),
		"energy_generation_monthly.csv":      1 + len(energy.GenerationProfile.Monthly.Rows),
		"energy_generation_hourly_share.csv": 1 + len(energy.GenerationProfile.ShareOfAnnualByHour.Rows),
		"energy_generation_profile.csv":      1 + len(energy.GenerationProfile.MeanACPowerByMonthAndHour.Rows),
		"energy_exceedance.csv":              1 + len(energy.Plant.Exceedance.Levels),
		// suitable, cropland_conflict and restrictive all carry area at this AOI.
		"energy_plant_capacity.csv":  1 + 3,
		"wind_monthly_speed.csv":     1 + len(wind.Measured.MonthlyMeanSpeed50m),
		"wind_direction_rose.csv":    1 + len(wind.Measured.DirectionEnergyRose50m),
		"wind_shear_sensitivity.csv": 1 + len(wind.ShearSensitivity),
	}

	for name, wantRows := range expectedRows {
		f, ok := files[name]
		if !ok {
			t.Errorf("missing zip entry %s", name)
			continue
		}
		rows := readCSV(t, f)
		if len(rows) != wantRows {
			t.Errorf("%s has %d rows, want %d", name, len(rows), wantRows)
			continue
		}
		want := researchTableColumns[name]
		if strings.Join(rows[0], ",") != strings.Join(want, ",") {
			t.Errorf("%s header = %v, want %v", name, rows[0], want)
		}
		for i, row := range rows {
			if len(row) != len(want) {
				t.Errorf("%s row %d has %d cells, want %d", name, i, len(row), len(want))
				break
			}
		}
	}

	// The classes are never summed, so each has to be identifiable in the CSV.
	plant := readCSV(t, files["energy_plant_capacity.csv"])
	classes := []string{plant[1][0], plant[2][0], plant[3][0]}
	if strings.Join(classes, ",") != "suitable,cropland_conflict,restrictive" {
		t.Errorf("plant classes = %v", classes)
	}
	// Restrictive is area only: capacity is null in the payload and must be an
	// empty cell, not a zero that reads as "no capacity here".
	if plant[3][3] != "" {
		t.Errorf("restrictive capacity_dc_mw = %q, want empty", plant[3][3])
	}
	// The rule and the band statement have to survive into the artifact, on
	// every row: a reader opens this CSV without the manifest beside it.
	areasCol := columnIndex(t, plant[0], "areas_note")
	bandCol := columnIndex(t, plant[0], "uncertainty_statement")
	for i := 1; i < len(plant); i++ {
		if plant[i][areasCol] != energy.Plant.AreasNote {
			t.Errorf("plant row %d areas_note = %q, want the payload rule", i, plant[i][areasCol])
		}
	}
	if !strings.Contains(plant[1][bandCol], "narrower than a P90") {
		t.Errorf("suitable row uncertainty_statement = %q", plant[1][bandCol])
	}
	// The cropland row keeps its own note, which is where "never summed with
	// the suitable area" is stated for that class.
	noteCol := columnIndex(t, plant[0], "class_note")
	if !strings.Contains(plant[2][noteCol], "never summed") {
		t.Errorf("cropland_conflict class_note = %q", plant[2][noteCol])
	}

	// The exceedance levels carry the convention that puts P90 below P50 and
	// the statement of what the band excludes.
	exceed := readCSV(t, files["energy_exceedance.csv"])
	convCol := columnIndex(t, exceed[0], "convention")
	exBandCol := columnIndex(t, exceed[0], "uncertainty_statement")
	for i := 1; i < len(exceed); i++ {
		if exceed[i][convCol] != energy.Plant.Exceedance.Convention {
			t.Errorf("exceedance row %d convention = %q", i, exceed[i][convCol])
		}
		if exceed[i][exBandCol] != energy.Plant.Uncertainty.Statement {
			t.Errorf("exceedance row %d uncertainty_statement = %q", i, exceed[i][exBandCol])
		}
	}

	// Context rows of the waterfall carry no factor, and an empty cell is the
	// only honest rendering: a 1.0 would read as a step that loses nothing.
	waterfall := readCSV(t, files["energy_loss_waterfall.csv"])
	if waterfall[1][2] != "" || waterfall[1][5] != "" {
		t.Errorf("waterfall context row should have empty factor and cumulative_ratio: %v", waterfall[1])
	}

	// The row derived from the record itself assumes no roughness length.
	shear := readCSV(t, files["wind_shear_sensitivity.csv"])
	// The two qualifiers the manifest gives these quantities are in the column
	// names, so a CSV opened on its own cannot be read as a plant figure.
	cfCol := columnIndex(t, shear[0], "gross_capacity_factor_pct")
	aepCol := columnIndex(t, shear[0], "gross_annual_energy_mwh_per_turbine")
	exclCol := columnIndex(t, shear[0], "excluded_losses")
	if shear[1][cfCol] == "" || shear[1][aepCol] == "" {
		t.Errorf("shear row 1 lost its figures: %v", shear[1])
	}
	for i := 1; i < len(shear); i++ {
		if !strings.Contains(shear[i][exclCol], "wake and array losses") {
			t.Errorf("shear row %d excluded_losses = %q", i, shear[i][exclCol])
		}
	}
	if shear[1][1] != "" {
		t.Errorf("shear sensitivity row 1 roughness_length_m = %q, want empty", shear[1][1])
	}

	var manifest map[string]any
	if err := json.Unmarshal(mustReadZip(t, files["manifest.json"]), &manifest); err != nil {
		t.Fatal(err)
	}
	// No energy figure is interpretable without these, and no wind figure is
	// interpretable without the qualifier and the failed checks.
	for _, key := range []string{
		"energy_performance_ratio_applied",
		"energy_performance_ratio_source",
		"energy_reporting_basis",
		"energy_capacity_density_basis",
		"energy_capacity_density_area_basis",
		"energy_grid_note",
		"wind_qualifier",
		"wind_is_extrapolation",
		"wind_excluded_losses",
		"wind_all_checks_passed",
		"wind_flags",
		"wind_comparison_note",
		"wind_grid_note",
		// The two statements without which the plant figures can be read
		// wrongly: the areas invite a sum, and the band invites the standing of
		// a P90 used for project finance.
		"energy_areas_note",
		"energy_uncertainty_statement",
		"energy_uncertainty_excluded",
		"energy_exceedance_convention_note",
	} {
		if _, ok := manifest[key]; !ok {
			t.Errorf("manifest is missing %s", key)
		}
	}
	if manifest["energy_reporting_basis"] != "year_one" {
		t.Errorf("energy_reporting_basis = %v", manifest["energy_reporting_basis"])
	}
	if manifest["wind_all_checks_passed"] != false {
		t.Errorf("wind_all_checks_passed = %v, want false for this cell", manifest["wind_all_checks_passed"])
	}
	if flags, ok := manifest["wind_flags"].([]any); !ok || len(flags) != 3 {
		t.Errorf("wind_flags = %v, want the three raised at this cell", manifest["wind_flags"])
	}
}

// columnIndex resolves a column by name so an assertion is anchored to the
// registered header rather than to a position, which a later column addition
// would silently shift.
func columnIndex(t *testing.T, header []string, name string) int {
	t.Helper()
	for i, h := range header {
		if h == name {
			return i
		}
	}
	t.Fatalf("column %q not in header %v", name, header)
	return -1
}

// TestResearchPackTerrainOnly covers the AOI that carries a terrain layer and
// nothing else. The export button is enabled for it, so a pack holding only
// manifest.json was an export that reported success over no data.
func TestResearchPackTerrainOnly(t *testing.T) {
	shadingMean := 1.234
	shadingMax := 41.5
	terrain := &SolarTerrainAnalysis{
		POAMin: 1720.4, POAMax: 1961.2, POAMean: 1884.6, POAStdPct: 2.31,
		SlopeMeanDeg: 3.4, SlopeMaxDeg: 21.8,
		Pixels: 41822, HourlyYears: 10,
		DEMSource: "Copernicus DEM GLO-30", Season: "annual", Unit: "kWh/m2/year",
		ShadingMeanPct: &shadingMean, ShadingMaxPct: &shadingMax,
		HorizonMaxDistM: 5000, BeamFraction: 0.6425,
	}
	zipBytes, err := BuildResearchPackZIP(
		ResearchExportMeta{AoiLabel: "Propriedade B"},
		&PredictResult{SolarTerrain: terrain},
		t.TempDir(),
	)
	if err != nil {
		t.Fatal(err)
	}
	files := zipEntries(t, zipBytes)
	f, ok := files["solar_terrain.csv"]
	if !ok {
		t.Fatalf("terrain-only pack wrote no terrain table; entries = %v", zipNames(files))
	}
	rows := readCSV(t, f)
	want := researchTableColumns["solar_terrain.csv"]
	if strings.Join(rows[0], ",") != strings.Join(want, ",") {
		t.Errorf("solar_terrain header = %v, want %v", rows[0], want)
	}
	if len(rows) != 2 {
		t.Fatalf("solar_terrain has %d rows, want header plus one", len(rows))
	}
	// The unit belongs beside the values: the shading layer reports a blocked
	// fraction and the anisotropy layer a ratio, so the value columns are not
	// an irradiation on every layer.
	if rows[1][columnIndex(t, rows[0], "unit")] != "kWh/m2/year" {
		t.Errorf("unit = %q", rows[1][columnIndex(t, rows[0], "unit")])
	}
	if rows[1][columnIndex(t, rows[0], "layer")] != "annual" {
		t.Errorf("layer = %q", rows[1][columnIndex(t, rows[0], "layer")])
	}
	// The shading loss is a share of beam, and beam_fraction is what converts
	// it to a share of the total. Read as a share of the total it overstates
	// the effect on yield by the reciprocal of that fraction.
	if got := rows[1][columnIndex(t, rows[0], "shading_mean_pct_of_beam")]; got != "1.234" {
		t.Errorf("shading_mean_pct_of_beam = %q", got)
	}
	if got := rows[1][columnIndex(t, rows[0], "beam_fraction")]; got != "0.6425" {
		t.Errorf("beam_fraction = %q", got)
	}

	var manifest map[string]any
	if err := json.Unmarshal(mustReadZip(t, files["manifest.json"]), &manifest); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		"solar_terrain_layer",
		"solar_terrain_unit",
		"solar_terrain_dem_source",
		"solar_terrain_shading_mean_pct_of_beam",
		"solar_terrain_beam_fraction",
	} {
		if _, ok := manifest[key]; !ok {
			t.Errorf("manifest is missing %s", key)
		}
	}
}

func zipNames(files map[string]*zip.File) []string {
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
