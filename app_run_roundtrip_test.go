package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
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

	var res analysis.EnergyModelAnalysis
	loadFixture(t, "energy_model_b.json", "energy_model", &res)
	res.NormalizeNilSlices()
	assertEnergyFixtureBinds(t, &res)

	a.persistEnergyModelRun(analysis.EnergyModelRequest{
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

	var res analysis.EnergyModelAnalysis
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

	var res analysis.WindAnalysis
	loadFixture(t, "wind_b.json", "wind", &res)
	res.NormalizeNilSlices()
	assertWindFixtureBinds(t, &res)

	a.persistWindRun(analysis.WindRequest{
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
func assertEnergyFixtureBinds(t *testing.T, e *analysis.EnergyModelAnalysis) {
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
func assertWindFixtureBinds(t *testing.T, w *analysis.WindAnalysis) {
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

// A reloaded run knows which run it is.
//
// RunID is stamped by Predict AFTER persisting, so the copy serialised to disk
// cannot carry it -- the id did not exist yet. LoadAnalysis returned that copy
// untouched, so a reopened analysis came back unable to say what it was, and
// every surface keyed on the id had to invent one. The map screen invented the
// literal "current"; the board then listed a run under the AOI label or, with
// none, "Analysis" -- a row indistinguishable from a saved run, which refused
// every action taken on it because the store has no run by that name.
//
// Asserted for a classification and for the products that return through the
// other branch, since each has its own return and only one of them was ever
// going to be remembered.
func TestLoadAnalysisStampsTheRunItReturns(t *testing.T) {
	a := newTestApp(t)

	// Built here rather than loaded: the point is a result with NO run id, and
	// a fixture that happened to gain one would silently stop testing it.
	res := analysis.PredictResult{NDates: 3}
	body, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.SaveRun(store.InferenceRun{
		UserID:      store.LocalUserID,
		ModelKind:   "spectral",
		PeriodStart: "2025-01-01",
		PeriodEnd:   "2025-12-31",
		Status:      "done",
		Kind:        store.RunKindClassification,
		ResultJSON:  string(body),
	}); err != nil {
		t.Fatal(err)
	}
	runID := latestRunID(t, a)

	// The stored copy is the shape the defect came from: no id inside it.
	stored, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	var raw analysis.PredictResult
	if err := json.Unmarshal([]byte(stored.ResultJSON), &raw); err != nil {
		t.Fatal(err)
	}
	if raw.RunID != "" {
		t.Fatalf("the fixture already carries a run id (%q); this test no longer covers the case it was written for", raw.RunID)
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.RunID != runID {
		t.Fatalf("LoadAnalysis returned run_id %q, want %q", out.RunID, runID)
	}
}

/*
loadRecordedPayload reads a recorded sidecar payload from
internal/research/testdata and unmarshals the block under the given key.

Separate from loadFixture above, which reads backend/testdata -- a directory
this repository no longer has, the package having been renamed to internal --
and skips when the file is missing. A skip on a fixture that is present is a
test that reports success without running, and a skip on one that is absent is
a round trip nobody checked; both are failures here. loadFixture is corrected on
another branch, so it is left alone rather than edited into a conflict.
*/
func loadRecordedPayload(t *testing.T, name, key string, dst any) {
	t.Helper()
	path := filepath.Join("internal", "research", "testdata", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	block, ok := wrapped[key]
	if !ok {
		t.Fatalf("%s carries no %q key", path, key)
	}
	if err := json.Unmarshal(block, dst); err != nil {
		t.Fatalf("unmarshal %s from %s: %v", key, path, err)
	}
}

// onePixelPNG is the smallest file that exercises the asset path: written from
// a data URI on save and read back into one on load. Its content is never
// examined, only its survival.
const onePixelPNG = "data:image/png;base64," +
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// TestFloodRunRoundTrip checks that a flood envelope run is saved under its own
// kind, restored through the flood field, and keeps its rasters.
//
// Three defects are covered, each of which is silent. A run filed under another
// kind lists and reopens as that product. A run with no restore branch lists
// correctly, reopens as an empty card and reports nothing. A run whose stored
// raster paths still name the sidecar's temporary work directory reopens
// pointing at files the system has since removed.
func TestFloodRunRoundTrip(t *testing.T) {
	a := newTestApp(t)

	var res analysis.FloodAnalysis
	loadRecordedPayload(t, "flood_b.json", "flood", &res)
	res.NormalizeNilSlices()
	assertFloodFixtureBinds(t, &res)

	// The recorded paths point into a work directory that never existed on this
	// machine. Replaced by a real file, so the copy into the run's assets is
	// exercised rather than skipped.
	tifSrc := filepath.Join(t.TempDir(), "flood_agreement.tif")
	if err := os.WriteFile(tifSrc, []byte("not a real geotiff, but a real file"), 0o600); err != nil {
		t.Fatal(err)
	}
	res.AgreementTIF = tifSrc
	res.AgreementPNG = ""
	res.AgreementURI = onePixelPNG

	a.persistFloodRun(analysis.FloodRequest{
		AreaID: "B", Label: "Propriedade B",
	}, &res)

	runID := latestRunID(t, a)
	runs, _ := a.store.ListRuns(store.LocalUserID, 10)
	if runs[0].Kind != store.RunKindFlood {
		t.Fatalf("kind = %q, want %q", runs[0].Kind, store.RunKindFlood)
	}
	if runs[0].NDates != 0 {
		t.Fatalf("n_dates = %d, want 0: HAND has no observation dates to count", runs[0].NDates)
	}

	var summary struct {
		Qualifier   string   `json:"qualifier"`
		RefM        float64  `json:"flood_reference_threshold_m"`
		Contested   float64  `json:"flood_contested_km2"`
		Unanimous   float64  `json:"flood_unanimous_wet_km2"`
		AOIAreaKm2  float64  `json:"flood_aoi_area_km2"`
		Frac        *float64 `json:"flood_contested_frac_of_wet"`
		NProducts   int      `json:"flood_n_products"`
		ProductIDs  []string `json:"flood_products"`
		IoUMinAtRef *float64 `json:"flood_iou_min"`
		IoUMaxAtRef *float64 `json:"flood_iou_max"`
	}
	if err := json.Unmarshal([]byte(runs[0].SummaryJSON), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Qualifier == "" {
		t.Fatal("the run row carries a contested area with no qualifier beside it")
	}
	if summary.RefM != res.ReferenceThresholdM || summary.Contested != res.Agreement.ContestedKm2 ||
		summary.Unanimous != res.Agreement.UnanimousWetKm2 {
		t.Fatalf("the agreement figures did not reach the summary: %+v", summary)
	}
	// The two areas above are of the AOI, and the row has to say so. Without
	// this figure beside them a contested 0.31 km2 reads the same whether it
	// was measured over 4.5 km2 of AOI or over 37.5 km2 of buffered window.
	if summary.AOIAreaKm2 != res.AOI.AreaKm2 || summary.AOIAreaKm2 == 0 {
		t.Fatalf("the run row lists areas with no AOI to take them of: %v",
			summary.AOIAreaKm2)
	}
	if summary.Frac == nil || *summary.Frac != *res.Agreement.ContestedFracOfWet {
		t.Fatalf("contested share did not reach the summary: %v", summary.Frac)
	}
	if summary.NProducts != len(res.Products) || len(summary.ProductIDs) != len(res.Products) {
		t.Fatalf("the product set did not reach the summary: %+v", summary.ProductIDs)
	}
	// The envelope at the reference threshold is the range the map is read
	// against; listed without it the contested area has no scale.
	if summary.IoUMinAtRef == nil || summary.IoUMaxAtRef == nil {
		t.Fatal("the summary carries no pairwise range at the reference threshold")
	}
	if *summary.IoUMinAtRef != *res.Envelope[0].IoUMin || *summary.IoUMaxAtRef != *res.Envelope[0].IoUMax {
		t.Fatalf("summary range = %v..%v, want %v..%v",
			*summary.IoUMinAtRef, *summary.IoUMaxAtRef,
			*res.Envelope[0].IoUMin, *res.Envelope[0].IoUMax)
	}

	// Nothing of the base64 reaches the database: the run row would otherwise
	// carry a second copy of every raster this product renders.
	stored, err := a.store.GetRun(store.LocalUserID, runID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.ResultJSON, "data:image/png") {
		t.Fatal("the stored result still carries the agreement raster as a data URI")
	}

	out, err := a.LoadAnalysis(runID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Flood == nil {
		t.Fatal("LoadAnalysis returned no flood block")
	}
	if out.Solar != nil || out.EnergyModel != nil || out.Wind != nil || out.Water != nil {
		t.Fatal("a flood run was restored as another product, which is the defect this test exists for")
	}
	if out.RunID != runID {
		t.Fatalf("the restored run cannot say which run it is: run_id = %q", out.RunID)
	}
	got := out.Flood

	if got.ReferenceThresholdM != res.ReferenceThresholdM ||
		got.DrainageKm2 != res.DrainageKm2 || got.BufferM != res.BufferM ||
		got.InsetMarginCells != res.InsetMarginCells {
		t.Fatalf("the parameters the extent rests on were not restored: %+v", got)
	}
	if got.Grid != res.Grid || got.CellSizeM != res.CellSizeM {
		t.Fatalf("the window the chain ran on was not restored: %+v", got.Grid)
	}
	// The ground every figure above is measured over. Restored empty, the areas
	// come back with no denominator and cannot be told apart from the same
	// numbers taken over the buffered window, which is eight times the ground.
	if got.AOI != res.AOI {
		t.Fatalf("the reporting extent was not restored: %+v, want %+v", got.AOI, res.AOI)
	}
	if len(got.Products) != len(res.Products) || len(got.Pairs) != len(res.Pairs) ||
		len(got.Envelope) != len(res.Envelope) {
		t.Fatalf("products %d, pairs %d, envelope %d restored",
			len(got.Products), len(got.Pairs), len(got.Envelope))
	}
	if got.Agreement.ContestedKm2 != res.Agreement.ContestedKm2 ||
		len(got.Agreement.Counts) != len(res.Agreement.Counts) {
		t.Fatalf("the agreement histogram was not restored: %+v", got.Agreement)
	}
	if got.Qualifier != res.Qualifier || got.Assumptions.ChainGrid == "" ||
		len(got.Assumptions.Excluded) != len(res.Assumptions.Excluded) {
		t.Fatal("the qualifier or the assumptions did not survive the round trip")
	}
	// The pointers stay pointers: a null read as 0.0 states a measurement that
	// was never made.
	if got.Pairs[0].IoU == nil || *got.Pairs[0].IoU != *res.Pairs[0].IoU {
		t.Fatalf("pairwise index not restored: %v", got.Pairs[0])
	}

	// Both rasters point at files that exist, in the run's own directory and
	// not in the sidecar's temporary one.
	if got.AgreementURI == "" {
		t.Fatal("the agreement rendering was not restored")
	}
	if got.AgreementTIF == "" {
		t.Fatal("the agreement GeoTIFF was not restored; it is what a reader takes into a GIS")
	}
	if _, err := os.Stat(got.AgreementTIF); err != nil {
		t.Fatalf("restored agreement_tif does not resolve: %v", err)
	}
	if got.AgreementPNG == "" {
		t.Fatal("the agreement PNG path was not restored")
	}
	if _, err := os.Stat(got.AgreementPNG); err != nil {
		t.Fatalf("restored agreement_png does not resolve: %v", err)
	}
	/*
		The bounds that place the rendering, restored with it.

		A URI with no extent is an overlay the map cannot position, so the run
		reopens showing its figures and none of its geography -- the same
		"lists correctly, reopens as an empty card" failure the branch above
		exists for, one field further in. Zero is what an unrestored Bounds
		looks like, and it is also a legal point off the coast of Africa, so it
		is checked against the payload rather than against emptiness.
	*/
	if got.Extent != res.Extent {
		t.Fatalf("the overlay bounds were not restored: %+v, want %+v", got.Extent, res.Extent)
	}
	if got.Extent == (analysis.Bounds{}) {
		t.Fatal("the restored overlay bounds are the zero Bounds: nothing can be placed on them")
	}
	assertNoNullSlices(t, got)
}

// assertFloodFixtureBinds pins the recorded payload to the figures of the run
// it came from, for the reason given on assertEnergyFixtureBinds: without it
// every field would be zero on both sides of the round trip and every equality
// would hold.
//
// These are the figures of the recorded flood envelope over Propriedade B: four
// Planetary Computer DEM products at the 1 m reference threshold, reported over
// the 5256 AOI cells inside a 216 by 203 window read 2000 m beyond the AOI.
func assertFloodFixtureBinds(t *testing.T, f *analysis.FloodAnalysis) {
	t.Helper()
	if f.ReferenceThresholdM != 1.0 || f.DrainageKm2 != 0.5 || f.BufferM != 2000.0 {
		t.Fatalf("parameters did not bind: %v m, %v km2, %v m",
			f.ReferenceThresholdM, f.DrainageKm2, f.BufferM)
	}
	// 18 cells and not the 36 an earlier payload recorded: the ring is now cut
	// from the AOI polygon, so the cap that bounds it is taken from the AOI
	// bounding box rather than from the buffered window.
	if f.Grid.Width != 216 || f.Grid.Height != 203 || f.InsetMarginCells != 18 {
		t.Fatalf("window did not bind: %dx%d, inset margin %d",
			f.Grid.Width, f.Grid.Height, f.InsetMarginCells)
	}
	/*
		The reporting extent, and the two identities that say the figures are
		over it.

		WindowCells is the whole grid, 216 by 203; AOI.Cells is the 5256 of them
		whose centre falls inside the polygon, 12 percent of the ground the
		chain solved. Asserting the numbers alone would still pass if a later
		payload reported over the window again, so the accounting is checked as
		well: the agreement histogram sums to the AOI and not to the grid, which
		is the one arithmetic fact that separates the two extents.
	*/
	if f.AOI.Cells != 5256 || f.AOI.InsetCells != 1332 || f.AOI.WindowCells != 43848 {
		t.Fatalf("the reporting extent did not bind: %+v", f.AOI)
	}
	if f.AOI.WindowCells != f.Grid.Width*f.Grid.Height {
		t.Fatalf("aoi.window_cells = %d but the grid is %d by %d",
			f.AOI.WindowCells, f.Grid.Width, f.Grid.Height)
	}
	if !withinTolerance(f.AOI.AreaKm2, 4.4953, 1e-4) ||
		!withinTolerance(f.AOI.WindowAreaKm2, 37.5019, 1e-4) ||
		!withinTolerance(f.AOI.FracOfWindow, 0.119869, 1e-6) {
		t.Fatalf("the reporting areas did not bind: %+v", f.AOI)
	}
	total := 0
	for _, c := range f.Agreement.Counts {
		total += c
	}
	if total != f.AOI.Cells {
		t.Fatalf("the agreement histogram sums to %d cells, want the AOI's %d: "+
			"these figures are over the buffered window again", total, f.AOI.Cells)
	}
	/*
		Where the rendering goes, which is not where the grid is.

		extent is the bounding box of the AOI clip; Grid.Bounds is the buffered
		window around it. Equality between them is what a payload looks like
		when the clip was dropped and the whole window rendered instead, so the
		containment is asserted rather than the four numbers alone -- an overlay
		placed on the grid would be stretched over 37.5 km2 of ground for a
		4.5 km2 picture.
	*/
	if f.Extent == (analysis.Bounds{}) {
		t.Fatal("extent did not bind: the overlay has no bounds to be placed on")
	}
	if f.Extent.LonMin <= f.Grid.Bounds.LonMin || f.Extent.LonMax >= f.Grid.Bounds.LonMax ||
		f.Extent.LatMin <= f.Grid.Bounds.LatMin || f.Extent.LatMax >= f.Grid.Bounds.LatMax {
		t.Fatalf("extent %+v is not inside the buffered window %+v",
			f.Extent, f.Grid.Bounds)
	}
	if !withinTolerance(f.CellSizeM.X, 27.8539, 1e-4) || !withinTolerance(f.CellSizeM.Y, 30.7056, 1e-4) {
		t.Fatalf("cell size did not bind: %v by %v", f.CellSizeM.X, f.CellSizeM.Y)
	}
	if len(f.Products) != 4 || len(f.Pairs) != 30 || len(f.Envelope) != 5 {
		t.Fatalf("products %d (want 4), pairs %d (want 30), envelope rows %d (want 5)",
			len(f.Products), len(f.Pairs), len(f.Envelope))
	}
	// Five levels for four products: a cell can be called flooded by none of
	// them, which is a level and not a missing row.
	if len(f.Agreement.Counts) != 5 {
		t.Fatalf("agreement histogram has %d levels, want 5", len(f.Agreement.Counts))
	}
	if !withinTolerance(f.Agreement.UnanimousWetKm2, 0.0599, 1e-4) ||
		!withinTolerance(f.Agreement.ContestedKm2, 0.3147, 1e-4) ||
		!withinTolerance(f.Agreement.UnanimousDryKm2, 4.1207, 1e-4) {
		t.Fatalf("agreement areas did not bind: %v wet, %v contested, %v dry",
			f.Agreement.UnanimousWetKm2, f.Agreement.ContestedKm2,
			f.Agreement.UnanimousDryKm2)
	}
	// The three areas are the AOI, split. A sum that misses it says the classes
	// were measured over one extent and the AOI reported over another.
	sumKm2 := f.Agreement.UnanimousWetKm2 + f.Agreement.ContestedKm2 +
		f.Agreement.UnanimousDryKm2
	if !withinTolerance(sumKm2, f.AOI.AreaKm2, 1e-3) {
		t.Fatalf("the agreement classes sum to %.4f km2, want the AOI's %.4f",
			sumKm2, f.AOI.AreaKm2)
	}
	// A pointer because no product calling anything wet leaves the share
	// undefined. Here 84 percent of the wet cells are contested, and a null
	// decoded into a bare float64 would print that as agreement.
	if f.Agreement.ContestedFracOfWet == nil {
		t.Fatal("contested_frac_of_wet is nil: this AOI contests 0.8402 of its wet cells")
	}
	if !withinTolerance(*f.Agreement.ContestedFracOfWet, 0.8402, 1e-4) {
		t.Fatalf("contested_frac_of_wet = %v, want 0.8402", *f.Agreement.ContestedFracOfWet)
	}
	// The reference threshold is where the products disagree most, which is
	// where the envelope is drawn.
	if f.Envelope[0].ThresholdM != 1.0 || f.Envelope[0].IoUMin == nil || f.Envelope[0].IoUMax == nil {
		t.Fatalf("the reference envelope row did not bind: %+v", f.Envelope[0])
	}
	if !withinTolerance(*f.Envelope[0].IoUMin, 0.2941, 1e-4) ||
		!withinTolerance(*f.Envelope[0].IoUMax, 0.4985, 1e-4) {
		t.Fatalf("envelope at 1 m = %v..%v, want 0.2941..0.4985",
			*f.Envelope[0].IoUMin, *f.Envelope[0].IoUMax)
	}
	// The same range over the AOI minus the inset ring. It binds separately
	// because it is the column that moved: iou_min_inset is 0.1143 against the
	// 0.2941 beside it, so the disagreement at this threshold sits away from
	// the AOI boundary, and a reader who saw only the outer pair would not
	// know that.
	if f.Envelope[0].IoUMinInset == nil || f.Envelope[0].IoUMaxInset == nil {
		t.Fatalf("the inset envelope row did not bind: %+v", f.Envelope[0])
	}
	if !withinTolerance(*f.Envelope[0].IoUMinInset, 0.1143, 1e-4) ||
		!withinTolerance(*f.Envelope[0].IoUMaxInset, 0.5472, 1e-4) {
		t.Fatalf("inset envelope at 1 m = %v..%v, want 0.1143..0.5472",
			*f.Envelope[0].IoUMinInset, *f.Envelope[0].IoUMaxInset)
	}
	if f.Pairs[0].IoUInset == nil || !withinTolerance(*f.Pairs[0].IoUInset, 0.5424, 1e-4) {
		t.Fatalf("the first pair's inset index did not bind: %+v", f.Pairs[0])
	}
	// The 90 m product is resampled onto the shared grid and the pointer must
	// say so: decoded into a bare bool a null reads as a comparison of terrain
	// alone, which a resampled row is not.
	var cop90 *analysis.FloodProduct
	for i := range f.Products {
		if f.Products[i].ID == "cop90" {
			cop90 = &f.Products[i]
		}
	}
	if cop90 == nil {
		t.Fatal("the fixture no longer carries the 90 m product")
	}
	if cop90.Resampled == nil || !*cop90.Resampled {
		t.Fatal("cop90.resampled did not bind: the 90 m product runs on the shared 30 m grid")
	}
	if cop90.NativeResolutionM == nil || *cop90.NativeResolutionM != 90.0 {
		t.Fatalf("cop90.native_resolution_m did not bind: %v", cop90.NativeResolutionM)
	}
	if f.Qualifier == "" || f.Assumptions.ChainGrid == "" || len(f.Assumptions.Excluded) == 0 {
		t.Fatal("the qualifier or the assumptions did not bind")
	}
	// The two prose entries a figure cannot be read without: which cells it is
	// over, and which raster covers what. Empty, the areas travel with nothing
	// naming their ground and the GeoTIFF travels with nothing saying it is
	// wider than they are.
	if f.Assumptions.ReportingExtent == "" || f.Assumptions.Rasters == "" {
		t.Fatal("the reporting extent or the raster note did not bind")
	}
	if f.Assumptions.InsetMargin == "" {
		t.Fatal("the inset margin note did not bind")
	}
}
