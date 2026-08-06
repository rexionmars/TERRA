package backend

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const researchExportSchemaVersion = 1

// BuildResearchPackZIP builds a portable ZIP with CSVs, manifest, optional AOI,
// and optional classification GeoTIFF for an external training workspace.
// dataDir is used to resolve relative RasterTIF paths (e.g. runs/<id>/…).
func BuildResearchPackZIP(meta ResearchExportMeta, result *PredictResult, dataDir string) ([]byte, error) {
	if result == nil {
		return nil, fmt.Errorf("no analysis result to export")
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := map[string]any{
		"schema_version":  researchExportSchemaVersion,
		"exported_at":     time.Now().UTC().Format(time.RFC3339),
		"model_kind":      strings.TrimSpace(meta.ModelKind),
		"area_id":         strings.TrimSpace(meta.AreaID),
		"aoi_label":       strings.TrimSpace(meta.AoiLabel),
		"n_dates":         result.NDates,
		"date_range":      result.DateRange,
		"mean_confidence": result.MeanConfidence,
		"extent":          result.Extent,
	}
	// Sample size of the MapBiomas comparison. The reference is native at 30 m
	// and is resampled onto the 10 m grid, so the pixel count overstates the
	// number of independent label observations by roughly nine times.
	if sol := result.Solar; sol != nil {
		// Every solar figure travels with the assumption that produced it.
		manifest["solar_ghi_annual_kwh_m2"] = sol.Resource.GHIAnnualKWhM2
		manifest["solar_n_years"] = sol.Resource.NYears
		manifest["solar_optimal_tilt_deg"] = sol.Geometry.OptimalTiltDeg
		manifest["solar_surface_azimuth_deg"] = sol.Geometry.SurfaceAzimuthDeg
		manifest["solar_specific_yield_kwh_kwp_year"] = sol.PV.SpecificYieldKWhKWpYear
		manifest["solar_performance_ratio"] = sol.PV.PerformanceRatio
		manifest["solar_performance_ratio_source"] = sol.PV.PerformanceRatioSource
		manifest["solar_performance_ratio_modelled"] = sol.PV.PerformanceRatioModelled
		manifest["solar_grid_note"] = sol.GridNote
	}
	if st := result.SolarSiting; st != nil {
		// Reported apart, never summed.
		manifest["solar_siting_suitable_no_conflict_ha"] = st.SuitableNoConflictHa
		manifest["solar_siting_suitable_cropland_ha"] = st.SuitableCroplandHa
		manifest["solar_siting_thresholds"] = st.Thresholds
	}
	if w := result.Water; w != nil && len(w.Series) > 0 {
		manifest["water_index"] = w.Index
		manifest["water_threshold"] = w.ThresholdFixed
		manifest["water_n_dates"] = w.NDates
		manifest["water_peak_date"] = w.PeakDate
		manifest["water_peak_fraction_pct"] = w.PeakWaterPct
		manifest["water_ephemeral_area_ha"] = w.EphemeralAreaHa
		manifest["water_persistent_area_ha"] = w.PersistentAreaHa
		manifest["water_aoi_area_ha"] = w.AOIAreaHa
	}
	if result.LULC != nil && result.LULC.CompareReferenceCells > 0 {
		manifest["compare_pixels"] = result.LULC.ComparePixels
		manifest["compare_reference_cells"] = result.LULC.CompareReferenceCells
	}
	if err := writeZipJSON(zw, "manifest.json", manifest); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if poly := strings.TrimSpace(meta.PolygonGeoJSON); poly != "" && poly != "null" {
		aoiPayload, err := normalizeAOIGeoJSON(poly)
		if err != nil {
			_ = zw.Close()
			return nil, fmt.Errorf("aoi geojson: %w", err)
		}
		if err := writeZipBytes(zw, "aoi.geojson", aoiPayload); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.ClassStats) > 0 {
		rows := [][]string{{"class_id", "name", "color", "pixels", "pct", "area_ha"}}
		for _, c := range result.ClassStats {
			rows = append(rows, []string{
				strconv.Itoa(c.ClassID),
				c.Name,
				c.Color,
				strconv.Itoa(c.Pixels),
				formatFloat(c.Pct),
				formatFloat(c.AreaHa),
			})
		}
		if err := writeZipCSV(zw, "class_stats.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.VISeries) > 0 {
		rows := [][]string{{
			"date", "ndvi_mean", "ndvi_std", "evi_mean", "evi_std", "savi_mean", "savi_std",
		}}
		for _, p := range result.VISeries {
			rows = append(rows, []string{
				p.Date,
				formatFloat(p.NDVIMean),
				formatFloat(p.NDVIStd),
				formatFloat(p.EVIMean),
				formatFloat(p.EVIStd),
				formatFloat(p.SAVIMean),
				formatFloat(p.SAVIStd),
			})
		}
		if err := writeZipCSV(zw, "vi_series.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if hasPhenology(result.Phenology) {
		rows := [][]string{{
			"sos_doy", "pos_doy", "eos_doy", "los_days", "peak", "base", "amplitude",
		}}
		ph := result.Phenology
		rows = append(rows, []string{
			formatFloatPtr(ph.SOSDOY),
			formatFloatPtr(ph.POSDOY),
			formatFloatPtr(ph.EOSDOY),
			formatFloatPtr(ph.LOSDays),
			formatFloatPtr(ph.Peak),
			formatFloatPtr(ph.Base),
			formatFloatPtr(ph.Amplitude),
		})
		if err := writeZipCSV(zw, "phenology.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.PhenologyStates) > 0 {
		rows := [][]string{{"date", "state", "state_name", "color", "ndvi_mean"}}
		for _, s := range result.PhenologyStates {
			rows = append(rows, []string{
				s.Date,
				strconv.Itoa(s.State),
				s.StateName,
				s.Color,
				formatFloatPtr(s.NDVIMean),
			})
		}
		if err := writeZipCSV(zw, "phenology_states.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if len(result.Temporal) > 0 {
		rows := [][]string{{
			"date", "n_dates_stack", "soja_ndvi_mean", "soja_retention_pct", "dominant",
		}}
		for _, t := range result.Temporal {
			dom := ""
			if t.Dominant != nil {
				dom = *t.Dominant
			}
			rows = append(rows, []string{
				t.Date,
				strconv.Itoa(t.NDatesStack),
				formatFloatPtr(t.SojaNDVIMean),
				formatFloatPtr(t.SojaRetentionPct),
				dom,
			})
		}
		if err := writeZipCSV(zw, "temporal.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if result.LULC != nil {
		lulc := result.LULC
		m := lulc.Metrics
		metricRows := [][]string{{
			"year", "source",
			"area_ha", "n_pixels", "n_classes", "shannon_h", "pielou_j",
			"dominant_class", "dominant_pct", "soja_pct", "outras_lav_pct", "agricola_pct",
		}}
		metricRows = append(metricRows, []string{
			strconv.Itoa(lulc.Year),
			lulc.Source,
			formatFloat(m.AreaHa),
			strconv.Itoa(m.NPixels),
			strconv.Itoa(m.NClasses),
			formatFloat(m.ShannonH),
			formatFloat(m.PielouJ),
			m.DominantClass,
			formatFloat(m.DominantPct),
			formatFloat(m.SojaPct),
			formatFloat(m.OutrasLavPct),
			formatFloat(m.AgricolaPct),
		})
		if err := writeZipCSV(zw, "lulc_metrics.csv", metricRows); err != nil {
			_ = zw.Close()
			return nil, err
		}

		if len(lulc.Composition) > 0 {
			rows := [][]string{{"class_id", "name", "color", "group", "pixels", "pct", "area_ha"}}
			for _, c := range lulc.Composition {
				rows = append(rows, []string{
					strconv.Itoa(c.ClassID),
					c.Name,
					c.Color,
					c.Group,
					strconv.Itoa(c.Pixels),
					formatFloat(c.Pct),
					formatFloat(c.AreaHa),
				})
			}
			if err := writeZipCSV(zw, "lulc_composition.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(lulc.Groups) > 0 {
			rows := [][]string{{"group", "color", "pct", "area_ha"}}
			for _, g := range lulc.Groups {
				rows = append(rows, []string{
					g.Group,
					g.Color,
					formatFloat(g.Pct),
					formatFloat(g.AreaHa),
				})
			}
			if err := writeZipCSV(zw, "lulc_groups.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(lulc.PredVsRef) > 0 {
			// pixels_ref counts 10 m pixels; n_reference_cells counts the native
			// 30 m MapBiomas cells behind them. An agreement statistic computed
			// from this table must use the cell count as its denominator.
			rows := [][]string{{
				"class_id", "name", "color", "pct_ref", "pct_pred",
				"pixels_ref", "n_reference_cells",
			}}
			for _, r := range lulc.PredVsRef {
				rows = append(rows, []string{
					strconv.Itoa(r.ClassID),
					r.Name,
					r.Color,
					formatFloat(r.PctRef),
					formatFloat(r.PctPred),
					strconv.Itoa(r.PixelsRef),
					strconv.Itoa(r.NReferenceCells),
				})
			}
			if err := writeZipCSV(zw, "lulc_pred_vs_ref.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if w := result.Water; w != nil && len(w.Series) > 0 {
		// observed_pixels is the denominator of water_fraction_pct: the AOI
		// pixels actually seen on that date. A fraction cannot be recomputed
		// against the AOI area without it.
		rows := [][]string{{
			"date", "scene_id", "cloud_cover", "observed_pixels",
			"threshold_fixed", "threshold_otsu", "threshold_clipped",
			"threshold_degenerate", "water_fraction_pct",
			"water_fraction_otsu_pct", "water_pixels", "area_ha",
		}}
		for _, d := range w.Series {
			rows = append(rows, []string{
				d.Date,
				d.SceneID,
				formatFloat(d.CloudCover),
				strconv.Itoa(d.ObservedPixels),
				formatFloat(d.ThresholdFixed),
				formatFloat(d.ThresholdOtsu),
				strconv.FormatBool(d.ThresholdClipped),
				strconv.FormatBool(d.ThresholdDegenerate),
				formatFloat(d.WaterFractionPct),
				formatFloat(d.WaterFractionOtsu),
				strconv.Itoa(d.WaterPixels),
				formatFloat(d.AreaHa),
			})
		}
		if err := writeZipCSV(zw, "water_series.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if sol := result.Solar; sol != nil && len(sol.Resource.Monthly) > 0 {
		rows := [][]string{{"month", "ghi", "dni", "dhi", "kt"}}
		for _, m := range sol.Resource.Monthly {
			rows = append(rows, []string{
				strconv.Itoa(m.Month),
				formatFloatPtr(m.GHI),
				formatFloatPtr(m.DNI),
				formatFloatPtr(m.DHI),
				formatFloatPtr(m.KT),
			})
		}
		if err := writeZipCSV(zw, "solar_monthly.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}

		// The tilt tolerance is what says how much the optimum matters: a
		// figure quoted without it reads as a requirement rather than a peak.
		tol := [][]string{{"deviation_deg", "loss_pct"}}
		for _, t := range sol.Geometry.TiltTolerance {
			tol = append(tol, []string{
				formatFloat(t.DeviationDeg), formatFloat(t.LossPct),
			})
		}
		if len(tol) > 1 {
			if err := writeZipCSV(zw, "solar_tilt_tolerance.csv", tol); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if st := result.SolarSiting; st != nil && len(st.Classes) > 0 {
		rows := [][]string{{"code", "name", "color", "pixels", "area_ha", "pct"}}
		for _, c := range st.Classes {
			rows = append(rows, []string{
				strconv.Itoa(c.Code), c.Name, c.Color,
				strconv.Itoa(c.Pixels), formatFloat(c.AreaHa), formatFloat(c.Pct),
			})
		}
		if err := writeZipCSV(zw, "solar_siting_classes.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if rasterPath := ResolveRasterPath(result.RasterTIF, dataDir); rasterPath != "" {
		if err := writeZipFile(zw, "rasters/classification.tif", rasterPath); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ResolveRasterPath returns an existing filesystem path for a classification
// GeoTIFF, or "" when missing / data-URI-only.
func ResolveRasterPath(rasterTIF, dataDir string) string {
	src := strings.TrimSpace(rasterTIF)
	if src == "" || strings.HasPrefix(src, "data:") {
		return ""
	}
	candidates := []string{src}
	if !filepath.IsAbs(src) && strings.TrimSpace(dataDir) != "" {
		candidates = append(candidates, filepath.Join(dataDir, src))
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// DefaultResearchPackFilename builds terra-export-<slug>-YYYYMMDD.zip.
func DefaultResearchPackFilename(aoiLabel string) string {
	slug := slugify(aoiLabel)
	if slug == "" {
		slug = "analysis"
	}
	stamp := time.Now().Format("20060102")
	return fmt.Sprintf("terra-export-%s-%s.zip", slug, stamp)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlug.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 48 {
		s = strings.Trim(s[:48], "-")
	}
	return s
}

func hasPhenology(p PhenologyMetrics) bool {
	return p.SOSDOY != nil || p.POSDOY != nil || p.EOSDOY != nil ||
		p.LOSDays != nil || p.Peak != nil || p.Base != nil || p.Amplitude != nil
}

func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func formatFloatPtr(v *float64) string {
	if v == nil {
		return ""
	}
	return formatFloat(*v)
}

func normalizeAOIGeoJSON(raw string) ([]byte, error) {
	var anyJSON any
	if err := json.Unmarshal([]byte(raw), &anyJSON); err != nil {
		return nil, err
	}
	m, ok := anyJSON.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected GeoJSON object")
	}
	// Already a Feature or FeatureCollection — keep as-is.
	if t, _ := m["type"].(string); t == "Feature" || t == "FeatureCollection" {
		return json.MarshalIndent(m, "", "  ")
	}
	// Geometry → wrap as Feature.
	if _, hasCoords := m["coordinates"]; hasCoords || m["type"] != nil {
		feat := map[string]any{
			"type":       "Feature",
			"properties": map[string]any{},
			"geometry":   m,
		}
		return json.MarshalIndent(feat, "", "  ")
	}
	return json.MarshalIndent(m, "", "  ")
}

func writeZipJSON(zw *zip.Writer, name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeZipBytes(zw, name, b)
}

func writeZipCSV(zw *zip.Writer, name string, rows [][]string) error {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.WriteAll(rows); err != nil {
		return err
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return err
	}
	return writeZipBytes(zw, name, buf.Bytes())
}

func writeZipBytes(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func writeZipFile(zw *zip.Writer, name, srcPath string) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, in)
	return err
}
