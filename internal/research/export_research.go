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

/*
researchExportSchemaVersion is the manifest's format.

2 added what a run needs to be repeated and checked: the scenes read and the
catalogue they came from, the model's digest, the parameters, the time the
imagery was read, the reference used for agreement, and the list of files.
*/
const researchExportSchemaVersion = 2

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
	// The accuracy assessment against MapBiomas, over the reference's native
	// 30 m cells (analysis.LULCAgreement): one row of summary, one row per class
	// with both accuracies and their 95% Wilson intervals, and the confusion
	// matrix in long form, so the header does not depend on which classes occur.
	"lulc_agreement.csv": {
		"n_reference_cells", "overall_pct", "overall_ci_low", "overall_ci_high",
		"quantity_disagreement_pct", "allocation_disagreement_pct", "n_outside_legend",
		"blocks_n_measured", "blocks_median_pct", "blocks_iqr_pct",
		"blocks_min_pct", "blocks_max_pct",
	},
	"lulc_accuracy.csv": {
		"class_id", "name", "color",
		"producers_pct", "producers_ci_low", "producers_ci_high",
		"users_pct", "users_ci_low", "users_ci_high",
		"n_reference", "n_predicted",
	},
	"lulc_confusion.csv": {"predicted_class", "reference_class", "n_reference_cells"},
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
	zw := &packWriter{Writer: zip.NewWriter(&buf)}

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
	for key, value := range provenance(result) {
		manifest[key] = value
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
	// Sample size of the MapBiomas comparison. The reference is native at 30 m
	// and is resampled onto the 10 m grid, so the pixel count overstates the
	// number of independent label observations by roughly nine times.
	if result.LULC != nil && result.LULC.CompareReferenceCells > 0 {
		manifest["compare_pixels"] = result.LULC.ComparePixels
		manifest["compare_reference_cells"] = result.LULC.CompareReferenceCells
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

	if lulc := result.LULC; lulc != nil && lulc.Agreement != nil {
		for _, t := range agreementTables(lulc.Agreement) {
			if err := writeZipCSV(zw, t.name, t.rows); err != nil {
				_ = zw.Close()
				return nil, err
			}
		}
	}

	if fp := result.DomainFingerprint; fp != nil {
		// The whole fingerprint as well as its summary: the domain-shift report
		// compares two runs, so it belongs to no one run's package, and this
		// is what lets it be computed again from two packages.
		if err := writeZipJSON(zw, "domain_fingerprint.json", fp); err != nil {
			_ = zw.Close()
			return nil, err
		}
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

	if rasterPath := ResolveRasterPath(result.RasterTIF, dataDir); rasterPath != "" {
		if err := writeZipFile(zw, "rasters/classification.tif", rasterPath); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}

	// Last, so it can list every other file the package holds.
	files := make([]string, 0, len(zw.files))
	files = append(files, zw.files...)
	manifest["files"] = append(files, "manifest.json")
	if err := writeZipJSON(zw, "manifest.json", manifest); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

/*
provenance is what the manifest records so a run can be repeated and its
numbers traced: the scenes read and the catalogue they came from, the model
down to its files, the parameters, when the imagery was read, and the
reference the agreement was measured against.

Each key is left out when the run does not carry it, as one saved before it was
recorded does not, rather than written empty: an empty list of scenes would
read as a run that read none.
*/
func provenance(result *analysis.PredictResult) map[string]any {
	out := map[string]any{}
	if result.RunID != "" {
		out["run_id"] = result.RunID
	}
	if result.ComputedAt != "" {
		out["computed_at"] = result.ComputedAt
	}
	if result.Parameters != nil {
		out["parameters"] = result.Parameters
	}
	if result.Model != nil {
		out["model"] = result.Model
	}
	imagery := map[string]any{}
	if len(result.ImagerySource) > 0 {
		imagery["sources"] = result.ImagerySource
	}
	if len(result.Scenes) > 0 {
		imagery["scenes"] = result.Scenes
	}
	if len(imagery) > 0 {
		out["imagery"] = imagery
	}
	if lulc := result.LULC; lulc != nil {
		out["reference"] = map[string]any{
			"name":   "MapBiomas",
			"source": lulc.Source,
			"year":   lulc.Year,
		}
	}
	return out
}

type packTable struct {
	name string
	rows [][]string
}

// agreementTables are the accuracy assessment's three CSVs, in the order they
// are written.
func agreementTables(a *analysis.LULCAgreement) []packTable {
	ci := func(v []float64, i int) string {
		if len(v) == 2 {
			return formatFloat(v[i])
		}
		return ""
	}
	summary := researchHeader("lulc_agreement.csv")
	row := []string{
		strconv.Itoa(a.NReferenceCells),
		formatFloat(a.OverallPct), ci(a.OverallCI, 0), ci(a.OverallCI, 1),
		formatFloat(a.QuantityDisagreementPct), formatFloat(a.AllocationDisagreementPct),
		strconv.Itoa(a.NOutsideLegend),
	}
	if b := a.Blocks; b != nil {
		row = append(row, strconv.Itoa(b.NMeasured), formatFloat(b.MedianPct),
			formatFloat(b.IQRPct), formatFloat(b.MinPct), formatFloat(b.MaxPct))
	} else {
		row = append(row, "", "", "", "", "")
	}
	summary = append(summary, row)

	perClass := researchHeader("lulc_accuracy.csv")
	for _, c := range a.PerClass {
		perClass = append(perClass, []string{
			strconv.Itoa(c.ClassID), c.Name, c.Color,
			formatFloatPtr(c.ProducersPct), ci(c.ProducersCI, 0), ci(c.ProducersCI, 1),
			formatFloatPtr(c.UsersPct), ci(c.UsersCI, 0), ci(c.UsersCI, 1),
			strconv.Itoa(c.NReference), strconv.Itoa(c.NPredicted),
		})
	}

	// matrix[pred][ref]: rows are the classification, columns the reference.
	confusion := researchHeader("lulc_confusion.csv")
	for i, predRow := range a.Matrix {
		if i >= len(a.MatrixClasses) {
			break
		}
		for j, n := range predRow {
			if j >= len(a.MatrixClasses) {
				break
			}
			confusion = append(confusion, []string{
				strconv.Itoa(a.MatrixClasses[i]), strconv.Itoa(a.MatrixClasses[j]), strconv.Itoa(n),
			})
		}
	}
	return []packTable{
		{"lulc_agreement.csv", summary},
		{"lulc_accuracy.csv", perClass},
		{"lulc_confusion.csv", confusion},
	}
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

// zipCreator is what the writers below need: somewhere to create a named file.
type zipCreator interface {
	Create(name string) (io.Writer, error)
}

// packWriter is a zip.Writer that remembers the names it wrote, for the
// manifest's list of files.
type packWriter struct {
	*zip.Writer
	files []string
}

func (w *packWriter) Create(name string) (io.Writer, error) {
	w.files = append(w.files, name)
	return w.Writer.Create(name)
}

func writeZipJSON(zw zipCreator, name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeZipBytes(zw, name, b)
}

func writeZipCSV(zw zipCreator, name string, rows [][]string) error {
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

func writeZipBytes(zw zipCreator, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func writeZipFile(zw zipCreator, name, srcPath string) error {
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
