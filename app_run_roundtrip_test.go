package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"geosense-infer/backend"
	"geosense-infer/backend/store"
)

// newTestApp builds an App backed by a store in a temporary home, which is what
// openTestStore does for the store's own tests.
func newTestApp(t *testing.T) *App {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))
	st, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &App{store: st}
}

func latestRunID(t *testing.T, a *App) string {
	t.Helper()
	runs, err := a.store.ListRuns(store.LocalUserID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected exactly one saved run, got %d", len(runs))
	}
	return runs[0].ID
}

// loadFixture reads a recorded sidecar payload from backend/testdata and
// unmarshals the block under
// the given key, so the round trip runs on the shape the sidecar actually
// emits rather than on a hand-written struct that cannot disagree with itself.
func loadFixture(t *testing.T, name, key string, dst any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("backend", "testdata", name))
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

// TestEnergyModelRunRoundTrip checks that an energy model run comes back out
// of the store the way it went in.
//
// The defect this guards against is silent: a product that saves but is not
// restored lists correctly, reopens as an empty card, and reports nothing. The
// LoadAnalysis switch discriminates on summary_json.solar_product, and the
// literal written there and the literal read back are two separate strings.
func TestEnergyModelRunRoundTrip(t *testing.T) {
	a := newTestApp(t)

	var res backend.EnergyModelAnalysis
	loadFixture(t, "energy_model_b.json", "energy_model", &res)
	res.NormalizeNilSlices()
	assertEnergyFixtureBinds(t, &res)

	a.persistEnergyModelRun(backend.EnergyModelRequest{
		AreaID: "B", Label: "Propriedade B", ProjectID: "",
	}, &res)

	runID := latestRunID(t, a)
	runs, _ := a.store.ListRuns(store.LocalUserID, 10)
	if runs[0].Kind != store.RunKindSolar {
		t.Fatalf("kind = %q, want %q", runs[0].Kind, store.RunKindSolar)
	}
	if runs[0].NDates != res.HourlyYears {
		t.Fatalf("n_dates = %d, want %d", runs[0].NDates, res.HourlyYears)
	}
	var summary struct {
		Product string  `json:"solar_product"`
		Yield   float64 `json:"specific_yield"`
		Tilt    float64 `json:"optimal_tilt_deg"`
	}
	if err := json.Unmarshal([]byte(runs[0].SummaryJSON), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Product != "energy_model" {
		t.Fatalf("solar_product = %q", summary.Product)
	}
	if summary.Yield != res.LossWaterfall.Delivered.AppliedKWhKWpYear {
		t.Fatalf("summary yield = %v, want %v", summary.Yield, res.LossWaterfall.Delivered.AppliedKWhKWpYear)
	}
	if summary.Tilt != res.Geometry.OptimalTiltDeg {
		t.Fatalf("summary tilt = %v, want %v", summary.Tilt, res.Geometry.OptimalTiltDeg)
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.EnergyModel == nil {
		t.Fatal("LoadAnalysis returned no energy_model block")
	}
	if out.Solar != nil {
		t.Fatal("the run was restored as a solar resource run, which is the defect this test exists for")
	}
	got := out.EnergyModel

	// The figures the whole product is read on, and the assumptions without
	// which none of them is interpretable.
	if got.Geometry.OptimalTiltDeg != res.Geometry.OptimalTiltDeg ||
		got.Geometry.POAKWhM2Year != res.Geometry.POAKWhM2Year {
		t.Fatalf("geometry not restored: %+v", got.Geometry)
	}
	if got.PerformanceRatio.Applied != res.PerformanceRatio.Applied ||
		got.PerformanceRatio.AppliedSource != res.PerformanceRatio.AppliedSource ||
		got.PerformanceRatio.Modelled != res.PerformanceRatio.Modelled ||
		got.ReportingBasis != res.ReportingBasis {
		t.Fatalf("performance ratio not restored: %+v", got.PerformanceRatio)
	}
	if got.LossWaterfall.Delivered.AppliedKWhKWpYear != res.LossWaterfall.Delivered.AppliedKWhKWpYear {
		t.Fatalf("delivered yield not restored: %v", got.LossWaterfall.Delivered)
	}
	if got.Plant.Suitable.CapacityDCMW != res.Plant.Suitable.CapacityDCMW ||
		got.Plant.Suitable.AreaHa != res.Plant.Suitable.AreaHa {
		t.Fatalf("plant capacity not restored: %+v", got.Plant.Suitable)
	}
	if got.CapacityDensity.Basis != res.CapacityDensity.Basis ||
		got.CapacityDensity.ValueMWDCPerHa != res.CapacityDensity.ValueMWDCPerHa {
		t.Fatalf("capacity density not restored: %+v", got.CapacityDensity)
	}
	if got.GridNote == "" || got.Assumptions.Note == "" {
		t.Fatal("the assumption text did not survive the round trip")
	}

	// Every slice must come back as an array, never as null: the TypeScript
	// mirror declares them non-nullable on the strength of the normaliser.
	if len(got.LossWaterfall.Steps) != len(res.LossWaterfall.Steps) {
		t.Fatalf("waterfall steps: got %d, want %d",
			len(got.LossWaterfall.Steps), len(res.LossWaterfall.Steps))
	}
	assertNoNullSlices(t, got)
}

// TestEnergyModelRunLegacyProductTagOpens checks that a run saved under the tag
// this product carried before it was renamed still opens as an energy model.
//
// The product was written under solar_product "energy_advanced" until that name
// was removed as promotional. No write path emits it any more, so the only
// evidence the read path still accepts it is this test; without it the
// compatibility case in LoadAnalysis reads as dead code and is deleted, and
// every run saved under the old tag falls to the default branch, decodes an
// energy payload into a SolarAnalysis and reopens as an empty solar card with
// nothing raising an error. That is the same silent defect
// TestEnergyModelRunRoundTrip guards, reached through the rename instead.
func TestEnergyModelRunLegacyProductTagOpens(t *testing.T) {
	a := newTestApp(t)

	var res backend.EnergyModelAnalysis
	loadFixture(t, "energy_model_b.json", "energy_model", &res)
	res.NormalizeNilSlices()

	resultBytes, err := json.Marshal(&res)
	if err != nil {
		t.Fatal(err)
	}
	// Written by hand rather than through persistEnergyModelRun, because that
	// function no longer emits the old tag and must not be changed to.
	summary, err := json.Marshal(map[string]any{
		"solar_product":    "energy_advanced",
		"specific_yield":   res.LossWaterfall.Delivered.AppliedKWhKWpYear,
		"optimal_tilt_deg": res.Geometry.OptimalTiltDeg,
		"reporting_basis":  res.ReportingBasis,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.SaveRun(store.InferenceRun{
		UserID:      store.LocalUserID,
		Kind:        store.RunKindSolar,
		ModelKind:   "NASA POWER",
		Status:      "ok",
		SummaryJSON: string(summary),
		ResultJSON:  string(resultBytes),
		NDates:      res.HourlyYears,
		Label:       "run-legacy-tag",
	}); err != nil {
		t.Fatal(err)
	}

	out, err := a.LoadAnalysis(latestRunID(t, a))
	if err != nil {
		t.Fatal(err)
	}
	if out.EnergyModel == nil {
		t.Fatal("a run saved under the pre-rename tag returned no energy_model block")
	}
	if out.Solar != nil {
		t.Fatal("a run saved under the pre-rename tag was restored as a solar resource run, which is the defect this test exists for")
	}
	if out.EnergyModel.Geometry.OptimalTiltDeg != res.Geometry.OptimalTiltDeg ||
		out.EnergyModel.LossWaterfall.Delivered.AppliedKWhKWpYear !=
			res.LossWaterfall.Delivered.AppliedKWhKWpYear {
		t.Fatalf("figures not restored from the pre-rename tag: %+v",
			out.EnergyModel.Geometry)
	}
	assertNoNullSlices(t, out.EnergyModel)
}

// TestWindRunRoundTrip checks that a wind run is saved under its own kind and
// restored through the wind field, rather than being read back as solar.
func TestWindRunRoundTrip(t *testing.T) {
	a := newTestApp(t)

	var res backend.WindAnalysis
	loadFixture(t, "wind_b.json", "wind", &res)
	res.NormalizeNilSlices()
	assertWindFixtureBinds(t, &res)

	a.persistWindRun(backend.WindRequest{
		AreaID: "B", Label: "Propriedade B",
	}, &res)

	runID := latestRunID(t, a)
	runs, _ := a.store.ListRuns(store.LocalUserID, 10)
	if runs[0].Kind != store.RunKindWind {
		t.Fatalf("kind = %q, want %q", runs[0].Kind, store.RunKindWind)
	}
	if runs[0].NDates != int(res.RecordYears) {
		t.Fatalf("n_dates = %d, want %d", runs[0].NDates, int(res.RecordYears))
	}
	var summary struct {
		CF        float64 `json:"wind_gross_capacity_factor_pct"`
		Qualifier string  `json:"qualifier"`
		Checks    bool    `json:"wind_all_checks_passed"`
		Flags     int     `json:"wind_flag_count"`
	}
	if err := json.Unmarshal([]byte(runs[0].SummaryJSON), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.CF != res.Hub.GrossCapacityFactorPct {
		t.Fatalf("summary capacity factor = %v, want %v", summary.CF, res.Hub.GrossCapacityFactorPct)
	}
	if summary.Qualifier == "" {
		t.Fatal("the run row carries a capacity factor with no qualifier beside it")
	}
	if summary.Checks != res.DataQuality.AllChecksPassed || summary.Flags != len(res.DataQuality.Flags) {
		t.Fatalf("the check outcome did not reach the summary: %+v", summary)
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Wind == nil {
		t.Fatal("LoadAnalysis returned no wind block")
	}
	if out.Solar != nil || out.EnergyModel != nil {
		t.Fatal("a wind run was restored as a solar product")
	}
	got := out.Wind
	if got.Hub.GrossCapacityFactorPct != res.Hub.GrossCapacityFactorPct ||
		got.Hub.GrossAnnualEnergyMWhPerTurbine != res.Hub.GrossAnnualEnergyMWhPerTurbine {
		t.Fatalf("hub figures not restored: %+v", got.Hub)
	}
	if got.Measured.MeanSpeed50mMS != res.Measured.MeanSpeed50mMS ||
		got.Measured.ShearExponent != res.Measured.ShearExponent {
		t.Fatalf("measured figures not restored: %+v", got.Measured)
	}
	if got.Turbine.Name != res.Turbine.Name || got.Turbine.Citation == "" {
		t.Fatalf("turbine provenance not restored: %+v", got.Turbine)
	}
	if got.Qualifier == "" || got.Assumptions.ComparisonNote == "" {
		t.Fatal("the qualifier and the comparison note did not survive the round trip")
	}
	if len(got.DataQuality.Flags) != len(res.DataQuality.Flags) {
		t.Fatalf("data quality flags: got %d, want %d",
			len(got.DataQuality.Flags), len(res.DataQuality.Flags))
	}
	if got.DataQuality.AllChecksPassed != res.DataQuality.AllChecksPassed {
		t.Fatal("all_checks_passed did not survive the round trip")
	}
	assertNoNullSlices(t, got)
}

// assertNoNullSlices walks the restored value and fails on any nil slice or
// nil map.
//
// A nil slice in Go marshals as null, and a null read as an array on the other
// side throws on .map or .length. The TypeScript mirror is entitled to declare
// these fields non-nullable only because NormalizeNilSlices runs on both the
// live path and the restore path; this asserts that property directly on the
// struct rather than inferring it from the JSON.
func assertNoNullSlices(t *testing.T, v any) {
	t.Helper()
	var walk func(rv reflect.Value, path string)
	walk = func(rv reflect.Value, path string) {
		switch rv.Kind() {
		case reflect.Ptr, reflect.Interface:
			if !rv.IsNil() {
				walk(rv.Elem(), path)
			}
		case reflect.Struct:
			rt := rv.Type()
			for i := 0; i < rv.NumField(); i++ {
				if rt.Field(i).PkgPath != "" {
					continue // unexported, never marshalled
				}
				walk(rv.Field(i), path+"."+rt.Field(i).Name)
			}
		case reflect.Slice:
			if rv.IsNil() {
				t.Errorf("%s is a nil slice; it marshals as null and must be an empty array", path)
				return
			}
			for i := 0; i < rv.Len(); i++ {
				walk(rv.Index(i), fmt.Sprintf("%s[%d]", path, i))
			}
		case reflect.Map:
			if rv.IsNil() {
				t.Errorf("%s is a nil map; it marshals as null and must be an empty object", path)
				return
			}
			for _, k := range rv.MapKeys() {
				walk(rv.MapIndex(k), fmt.Sprintf("%s[%v]", path, k.Interface()))
			}
		}
	}
	walk(reflect.ValueOf(v), "")
}

// withinTolerance reports whether two figures agree to an absolute tolerance.
func withinTolerance(got, want, tol float64) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// assertEnergyFixtureBinds pins the recorded payload to the figures the run it
// came from is known to produce.
//
// Without this the round-trip assertions would pass on a struct whose json tags
// bind to nothing: every field would be zero on both sides and every equality
// would hold. These are the figures of the stored run for Propriedade B, at the
// reference performance ratio 0.80 on the year-one basis, over the 2016-2025
// hourly window. The plane-of-array total is 1884.607 rather than the 1884.6193
// of the reference script because the action evaluates solar position at the
// grid cell the request rounds to, which is the behaviour of solar_resource
// beside it.
func assertEnergyFixtureBinds(t *testing.T, e *backend.EnergyModelAnalysis) {
	t.Helper()
	for _, c := range []struct {
		name string
		got  float64
		want float64
		tol  float64
	}{
		{"geometry.optimal_tilt_deg", e.Geometry.OptimalTiltDeg, 26.0, 0},
		{"geometry.poa_kwh_m2_year", e.Geometry.POAKWhM2Year, 1884.607, 1e-3},
		{"geometry.ghi_hourly_kwh_m2_year", e.Geometry.GHIHourlyKWhM2Year, 1783.2727, 1e-3},
		{"performance_ratio.applied", e.PerformanceRatio.Applied, 0.80, 0},
		{"performance_ratio.modelled", e.PerformanceRatio.Modelled, 0.856873, 1e-6},
		{"factors.f_iam", e.PerformanceRatio.Factors.FIAM, 0.986940, 1e-6},
		{"factors.f_temp", e.PerformanceRatio.Factors.FTemp, 0.907776, 1e-6},
		{"factors.f_inverter", e.PerformanceRatio.Factors.FInverter, 0.956416, 1e-6},
		{"factors.telescoping_residual", e.PerformanceRatio.Factors.TelescopingResidual, 0.0, 1e-9},
		{"factors.temp_cell_irradiance_weighted_c", e.PerformanceRatio.Factors.TempCellIrradianceWtdC, 51.350, 1e-3},
		{"delivered.applied_kwh_kwp_year", e.LossWaterfall.Delivered.AppliedKWhKWpYear, 1507.686, 1e-3},
		{"delivered.applied_capacity_factor_pct", e.LossWaterfall.Delivered.AppliedCapacityFactorPct, 17.211, 1e-3},
		{"base.ghi_climatology_kwh_m2_year", e.LossWaterfall.Base.GHIClimatologyKWhM2Year, 1771.685, 1e-3},
		{"capacity_density.value_mw_dc_per_ha", e.CapacityDensity.ValueMWDCPerHa, 0.648652, 1e-6},
		{"plant.suitable.area_ha", e.Plant.Suitable.AreaHa, 5.168, 1e-3},
		{"plant.suitable.capacity_dc_mw", e.Plant.Suitable.CapacityDCMW, 3.35, 1e-2},
		{"plant.exceedance.cv_pct", e.Plant.Exceedance.CVPct, 3.449, 1e-3},
	} {
		if !withinTolerance(c.got, c.want, c.tol) {
			t.Fatalf("%s = %v, want %v: the json tag does not bind to the sidecar key", c.name, c.got, c.want)
		}
	}
	if e.ReportingBasis != "year_one" || e.PerformanceRatio.AppliedSource != "reference" {
		t.Fatalf("basis or ratio source did not bind: %q / %q", e.ReportingBasis, e.PerformanceRatio.AppliedSource)
	}
	if e.HourlyYears != 10 || e.ClimatologyYears != 30 {
		t.Fatalf("record lengths did not bind: %d hourly, %d climatology", e.HourlyYears, e.ClimatologyYears)
	}
	if len(e.LossWaterfall.Steps) != 17 {
		t.Fatalf("loss waterfall has %d steps, want 17", len(e.LossWaterfall.Steps))
	}
	if len(e.PerformanceRatio.DeclaredLosses) != 6 {
		t.Fatalf("declared loss stack has %d terms, want 6", len(e.PerformanceRatio.DeclaredLosses))
	}
	if n := len(e.GenerationProfile.MeanACPowerByMonthAndHour.Rows); n != 12 {
		t.Fatalf("generation profile has %d months, want 12", n)
	}
	if n := len(e.GenerationProfile.MeanACPowerByMonthAndHour.Rows[0].MeanACWKWp); n != 24 {
		t.Fatalf("generation profile month has %d hours, want 24", n)
	}
	if e.GridNote == "" || e.Plant.Limitations == "" {
		t.Fatal("the grid note and the plant limitation text did not bind")
	}
}

// assertWindFixtureBinds pins the recorded wind payload to the figures the
// critique independently re-ran for the Propriedade B reanalysis cell, for the
// reason given on assertEnergyFixtureBinds.
func assertWindFixtureBinds(t *testing.T, w *backend.WindAnalysis) {
	t.Helper()
	for _, c := range []struct {
		name string
		got  float64
		want float64
		tol  float64
	}{
		{"measured.mean_speed_10m_ms", w.Measured.MeanSpeed10mMS, 1.1739, 1e-4},
		{"measured.mean_speed_50m_ms", w.Measured.MeanSpeed50mMS, 2.7151, 1e-4},
		{"measured.shear_exponent", w.Measured.ShearExponent, 0.5210, 1e-4},
		{"measured.weibull_k_50m", w.Measured.WeibullK50m, 2.7183, 1e-4},
		{"measured.weibull_c_50m_ms", w.Measured.WeibullC50mMS, 3.0447, 1e-4},
		{"measured.air_density_mean_kg_m3", w.Measured.AirDensityMeanKgM3, 1.1441, 1e-4},
		{"measured.wind_power_density_50m_w_m2", w.Measured.WindPowerDensity50mWM2, 16.94, 1e-2},
		{"hub.mean_speed_ms", w.Hub.MeanSpeedMS, 4.0942, 1e-4},
		{"hub.gross_capacity_factor_pct", w.Hub.GrossCapacityFactorPct, 9.360, 1e-3},
		{"hub.gross_annual_energy_mwh_per_turbine", w.Hub.GrossAnnualEnergyMWhPerTurbine, 2765.2, 1e-1},
		{"hub.extrapolation.height_ratio", w.Hub.Extrapolation.HeightRatio, 2.2, 1e-6},
	} {
		if !withinTolerance(c.got, c.want, c.tol) {
			t.Fatalf("%s = %v, want %v: the json tag does not bind to the sidecar key", c.name, c.got, c.want)
		}
	}
	// A pointer, because the log profile has no roughness inverse for every
	// shear exponent. At this cell it does, so the pointer must be non-nil and
	// carry the value: decoded into a bare float64 a null became zero, and the
	// panel printed a roughness of 0.000 m that does not exist.
	if w.DataQuality.Shear.ImpliedRoughnessLengthM == nil {
		t.Fatal("implied_roughness_length_m is nil: the B cell inverts to 2.935 m")
	}
	if !withinTolerance(*w.DataQuality.Shear.ImpliedRoughnessLengthM, 2.935, 1e-3) {
		t.Fatalf("implied_roughness_length_m = %v, want 2.935",
			*w.DataQuality.Shear.ImpliedRoughnessLengthM)
	}
	if w.DataQuality.RecordHours != 87672 {
		t.Fatalf("record_hours = %d, want 87672", w.DataQuality.RecordHours)
	}
	// The record does not pass its own checks at this cell, and the payload has
	// to keep saying so: the flags are the reason the hub figures are a
	// screening indication rather than a measurement.
	if w.DataQuality.AllChecksPassed {
		t.Fatal("all_checks_passed did not bind: the B cell raises three flags")
	}
	if len(w.DataQuality.Flags) != 3 {
		t.Fatalf("data quality flags = %d, want 3", len(w.DataQuality.Flags))
	}
	if !w.Hub.Extrapolation.IsExtrapolation {
		t.Fatal("is_extrapolation did not bind: the hub sits 2.2 times above the highest level in the record")
	}
	if len(w.Measured.MonthlyMeanSpeed50m) != 12 || len(w.Measured.DirectionEnergyRose50m) != 16 {
		t.Fatalf("monthly means %d (want 12), rose sectors %d (want 16)",
			len(w.Measured.MonthlyMeanSpeed50m), len(w.Measured.DirectionEnergyRose50m))
	}
	if w.Turbine.Name != "IEA-3.4-130-RWT" || w.Turbine.PowerCurvePoints != 50 {
		t.Fatalf("turbine did not bind: %q, %d curve points", w.Turbine.Name, w.Turbine.PowerCurvePoints)
	}
	if w.Qualifier == "" || w.Assumptions.ComparisonNote == "" || w.GridNote == "" {
		t.Fatal("the qualifier, the comparison note or the grid note did not bind")
	}
	// The row derived from the record itself assumes no roughness, so its
	// roughness length is null and must stay a pointer.
	if len(w.ShearSensitivity) == 0 || w.ShearSensitivity[0].RoughnessLengthM != nil {
		t.Fatal("shear_sensitivity[0].roughness_length_m must be null on the row derived from the record")
	}
}
