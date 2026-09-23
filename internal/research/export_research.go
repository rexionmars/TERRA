package research

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"geosense-infer/internal/analysis"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const researchExportSchemaVersion = 1

// researchTableColumns is the header row of every CSV the research pack can
// write, keyed by file name.
//
// frontend/src/lib/analysisTables.ts must define the same files with the same
// column keys in the same order: what the application shows on screen and what
// it exports have to be the same table, or a figure read on screen cannot be
// cited from the exported CSV. Nothing enforced that until
// TestResearchTableParity, which reads the TypeScript file and fails when the
// two drift. Keeping the headers here rather than inline is what makes that
// check possible.
var researchTableColumns = map[string][]string{
	"class_stats.csv": {"class_id", "name", "color", "pixels", "pct", "area_ha"},
	"vi_series.csv": {
		"date", "ndvi_mean", "ndvi_std", "evi_mean", "evi_std", "savi_mean", "savi_std",
	},
	"phenology.csv": {
		"sos_doy", "pos_doy", "eos_doy", "los_days", "peak", "base", "amplitude",
	},
	"phenology_states.csv": {"date", "state", "state_name", "color", "ndvi_mean"},
	"temporal.csv": {
		"date", "n_dates_stack", "soja_ndvi_mean", "soja_retention_pct", "dominant",
	},
	"lulc_metrics.csv": {
		"year", "source",
		"area_ha", "n_pixels", "n_classes", "shannon_h", "pielou_j",
		"dominant_class", "dominant_pct", "soja_pct", "outras_lav_pct", "agricola_pct",
	},
	"lulc_composition.csv": {
		"class_id", "name", "color", "group", "pixels", "pct", "area_ha",
	},
	"lulc_groups.csv": {"group", "color", "pct", "area_ha"},
	// pixels_ref counts 10 m pixels; n_reference_cells counts the native 30 m
	// MapBiomas cells behind them. An agreement statistic computed from this
	// table must use the cell count as its denominator.
	"lulc_pred_vs_ref.csv": {
		"class_id", "name", "color", "pct_ref", "pct_pred",
		"pixels_ref", "n_reference_cells",
	},
	// Compact domain fingerprint cached at classify (no raw sample matrix).
	"domain_fingerprint.csv": {
		"space", "n_features", "n_pixels", "n_sample",
		"mean_l2", "ndvi_hist_entropy",
	},
	// observed_pixels is the denominator of water_fraction_pct: the AOI pixels
	// actually seen on that date. A fraction cannot be recomputed against the
	// AOI area without it.
	"water_series.csv": {
		"date", "scene_id", "cloud_cover", "observed_pixels",
		"threshold_fixed", "threshold_otsu", "threshold_clipped",
		"threshold_degenerate", "water_fraction_pct",
		"water_fraction_otsu_pct", "water_pixels", "area_ha",
	},
	// One row per DEM product at the reference threshold, which manifest.json
	// names: these areas are not comparable across thresholds and the file does
	// not carry one per row because every row shares it.
	//
	// area_km2 is a cell count times the cell size reported in the manifest,
	// over the cells inside the AOI polygon and not over the buffered window
	// the terrain chain ran on, so the fraction is of the AOI. The manifest
	// carries both extents side by side under flood_aoi_* and flood_grid_*.
	// resampled is empty when the fact was not recorded, which is not the same
	// as false: a resampled product ran the terrain chain on a grid that is not
	// its own.
	"flood_products.csv": {
		"id", "collection", "native_resolution_m", "resampled",
		"cells", "area_km2", "area_frac",
	},
	// Every unordered pair at every threshold. iou is the Jaccard index between
	// the two extents, which for a binary mask is numerically the critical
	// success index (CSI) of the flood literature.
	//
	// iou_inset is the same index over the AOI shrunk by the inset margin the
	// manifest reports; a large gap between the two places the disagreement at
	// the edge of the reported area, where what drains in from beyond the
	// buffer is missing and HAND therefore reads high. The ring is cut from the
	// AOI polygon and not from the computed window, which is why the column is
	// not the iou_interior earlier packs carried: the two name different rings
	// and their numbers are not the same statistic. A resampled row carries an
	// alignment component alongside the terrain difference, quantified in the
	// manifest's flood_chain_grid, so it is not a comparison of terrain alone.
	// Empty cells are undefined rather than zero: the index has no value over
	// two empty extents, and the ratio none when A has no wet cell.
	"flood_pairs.csv": {
		"dem_a", "dem_b", "threshold_m", "iou", "iou_inset",
		"area_ratio_b_over_a", "resampled",
	},
	// The range the products span at each threshold: the narrowest and the
	// widest pairwise agreement. This is TERRA's own measurement over its own
	// DEM set, not the range published by the study the method comes from --
	// manifest.json carries the sentence that says so, and these numbers cannot
	// be quoted without it.
	"flood_envelope.csv": {
		"threshold_m", "iou_min", "iou_max", "iou_min_inset", "iou_max_inset",
	},
}

// researchHeader returns the registered header row for a CSV, as the first row
// of a table under construction. It panics on an unregistered name so a table
// cannot be written outside the registry the parity check reads.
func researchHeader(csvName string) [][]string {
	cols, ok := researchTableColumns[csvName]
	if !ok {
		panic("export_research: no column list registered for " + csvName)
	}
	return [][]string{cols}
}

// BuildResearchPackZIP builds a portable ZIP with CSVs, manifest, optional AOI,
// and optional classification GeoTIFF for an external training workspace.
// dataDir is used to resolve relative RasterTIF paths (e.g. runs/<id>/…).
func BuildResearchPackZIP(meta analysis.ResearchExportMeta, result *analysis.PredictResult, dataDir string) ([]byte, error) {
	if result == nil {
		return nil, fmt.Errorf("no analysis result to export")
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := map[string]any{
		"schema_version":  researchExportSchemaVersion,
		"exported_at":     time.Now().UTC().Format(time.RFC3339),
		"model_kind":      strings.TrimSpace(meta.ModelKind),
		"aoi_label":       strings.TrimSpace(meta.AoiLabel),
		"n_dates":         result.NDates,
		"date_range":      result.DateRange,
		"mean_confidence": result.MeanConfidence,
		"extent":          result.Extent,
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
	if fl := result.Flood; fl != nil {
		// The qualifier first, because every figure below is a measurement over
		// TERRA's own DEM set and none of them is a flood depth, an extent or a
		// probability. The study's published range is not this range.
		manifest["flood_qualifier"] = fl.Qualifier
		manifest["flood_reference_threshold_m"] = fl.ReferenceThresholdM
		manifest["flood_thresholds_m"] = fl.ThresholdsM
		manifest["flood_drainage_km2"] = fl.DrainageKm2
		manifest["flood_products"] = floodProductIDs(fl.Products)
		// What every area and fraction in the CSVs is measured over: the cells
		// inside the AOI polygon. Carried before the window below so a reader
		// meets the reporting extent first, and stated in prose as well, since
		// a bare km2 in a CSV is a number a reader attributes to ground and
		// these tables cannot say which ground on their own.
		manifest["flood_reporting_extent"] = fl.Assumptions.ReportingExtent
		manifest["flood_aoi_cells"] = fl.AOI.Cells
		manifest["flood_aoi_area_km2"] = fl.AOI.AreaKm2
		manifest["flood_aoi_inset_cells"] = fl.AOI.InsetCells
		// The window the terrain chain ran on, which is the AOI plus the buffer
		// less the border trimmed to a rectangle every product covers. It is
		// provenance and not the reporting extent: nothing in the CSVs is
		// measured over it, and the pack ships it so a reader can tell the
		// chain solved more ground than the tables cover. flood_aoi_area_km2
		// against flood_window_area_km2 is that comparison in one line.
		manifest["flood_grid_width"] = fl.Grid.Width
		manifest["flood_grid_height"] = fl.Grid.Height
		manifest["flood_grid_bounds"] = fl.Grid.Bounds
		manifest["flood_window_cells"] = fl.AOI.WindowCells
		manifest["flood_window_area_km2"] = fl.AOI.WindowAreaKm2
		manifest["flood_aoi_frac_of_window"] = fl.AOI.FracOfWindow
		manifest["flood_buffer_m"] = fl.BufferM
		manifest["flood_cell_size_x_m"] = fl.CellSizeM.X
		manifest["flood_cell_size_y_m"] = fl.CellSizeM.Y
		manifest["flood_inset_margin_cells"] = fl.InsetMarginCells
		// The agreement raster reduced to its histogram: index is how many
		// products call the cell flooded. The contested share is of the wet
		// cells alone, since the dry majority would hide it.
		manifest["flood_agreement_counts"] = fl.Agreement.Counts
		manifest["flood_unanimous_wet_km2"] = fl.Agreement.UnanimousWetKm2
		manifest["flood_contested_km2"] = fl.Agreement.ContestedKm2
		manifest["flood_unanimous_dry_km2"] = fl.Agreement.UnanimousDryKm2
		manifest["flood_contested_frac_of_wet"] = fl.Agreement.ContestedFracOfWet
		// Every default the figures rest on, and what is left out. The chain
		// order is carried separately because it is the one assumption that
		// moves a pairwise index by as much as the terrain does.
		manifest["flood_assumptions"] = fl.Assumptions
		manifest["flood_chain_grid"] = fl.Assumptions.ChainGrid
		manifest["flood_excluded"] = fl.Assumptions.Excluded
		// Which raster covers what. The GeoTIFF shipped under rasters/ is the
		// whole computed window and the display rendering is the AOI clip, so a
		// reader who opens the GeoTIFF in a GIS is looking at ground no figure
		// in these tables describes, and nothing in the file itself says so.
		manifest["flood_rasters"] = fl.Assumptions.Rasters
	}
	// Sample size of the MapBiomas comparison. The reference is native at 30 m
	// and is resampled onto the 10 m grid, so the pixel count overstates the
	// number of independent label observations by roughly nine times.
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
		rows := researchHeader("class_stats.csv")
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
		rows := researchHeader("vi_series.csv")
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
		rows := researchHeader("phenology.csv")
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
		rows := researchHeader("phenology_states.csv")
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
		rows := researchHeader("temporal.csv")
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
		metricRows := researchHeader("lulc_metrics.csv")
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
			rows := researchHeader("lulc_composition.csv")
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
			rows := researchHeader("lulc_groups.csv")
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
			rows := researchHeader("lulc_pred_vs_ref.csv")
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

	if fp := result.DomainFingerprint; fp != nil {
		rows := researchHeader("domain_fingerprint.csv")
		meanL2 := 0.0
		for _, v := range fp.Mean {
			meanL2 += v * v
		}
		meanL2 = math.Sqrt(meanL2)
		entropy := 0.0
		if fp.NDVIHist != nil {
			for _, p := range fp.NDVIHist.Probs {
				if p > 0 {
					entropy -= p * math.Log(p)
				}
			}
		}
		rows = append(rows, []string{
			fp.Space,
			strconv.Itoa(fp.NFeatures),
			strconv.Itoa(fp.NPixels),
			strconv.Itoa(fp.NSample),
			formatFloat(meanL2),
			formatFloat(entropy),
		})
		if err := writeZipCSV(zw, "domain_fingerprint.csv", rows); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	if w := result.Water; w != nil && len(w.Series) > 0 {
		rows := researchHeader("water_series.csv")
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

	if fl := result.Flood; fl != nil {
		if len(fl.Products) > 0 {
			rows := researchHeader("flood_products.csv")
			for _, p := range fl.Products {
				rows = append(rows, []string{
					p.ID,
					p.Collection,
					formatFloatPtr(p.NativeResolutionM),
					formatBoolPtr(p.Resampled),
					strconv.Itoa(p.Cells),
					formatFloat(p.AreaKm2),
					formatFloat(p.AreaFrac),
				})
			}
			if err := writeZipCSV(zw, "flood_products.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(fl.Pairs) > 0 {
			rows := researchHeader("flood_pairs.csv")
			for _, pr := range fl.Pairs {
				rows = append(rows, []string{
					pr.DEMA,
					pr.DEMB,
					formatFloat(pr.ThresholdM),
					formatFloatPtr(pr.IoU),
					formatFloatPtr(pr.IoUInset),
					formatFloatPtr(pr.AreaRatioBOverA),
					formatBoolPtr(pr.Resampled),
				})
			}
			if err := writeZipCSV(zw, "flood_pairs.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		if len(fl.Envelope) > 0 {
			rows := researchHeader("flood_envelope.csv")
			for _, e := range fl.Envelope {
				rows = append(rows, []string{
					formatFloat(e.ThresholdM),
					formatFloatPtr(e.IoUMin),
					formatFloatPtr(e.IoUMax),
					formatFloatPtr(e.IoUMinInset),
					formatFloatPtr(e.IoUMaxInset),
				})
			}
			if err := writeZipCSV(zw, "flood_envelope.csv", rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}

		// The agreement raster travels with the tables. It is the central
		// representation of this product -- where the products disagree, cell
		// by cell -- and the CSVs reduce it to histograms and indices that
		// cannot be turned back into a map.
		if tif := ResolveRasterPath(fl.AgreementTIF, dataDir); tif != "" {
			if err := writeZipFile(zw, "rasters/flood_agreement.tif", tif); err != nil {
				_ = zw.Close()
				return nil, err
			}
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

// floodProductIDs lists the DEM products the envelope was measured over. The
// envelope is a property of the set, so a range recorded without the set it
// spans is not attributable to anything.
func floodProductIDs(products []analysis.FloodProduct) []string {
	ids := make([]string, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.ID)
	}
	return ids
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

func hasPhenology(p analysis.PhenologyMetrics) bool {
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

// formatBoolPtr writes an unrecorded fact as an empty cell rather than as
// false. The flood tables distinguish the two: a pair whose alignment was never
// recorded is not a pair known to have run on its native grid.
func formatBoolPtr(v *bool) string {
	if v == nil {
		return ""
	}
	return strconv.FormatBool(*v)
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
