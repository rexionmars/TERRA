package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/store"
)

// Field boundaries: delineating the fields inside an area, and making them
// areas of their own. Kept apart from app_analysis.go because it is the only
// product whose output becomes ground other products then run over.

// The files a field-boundary run keeps in its assets directory. Named in one
// place because persistFieldsRun writes them and LoadAnalysis and AdoptFields
// read them back.
const (
	fieldsGeoJSONFile = "fields.geojson"
	fieldsClassesPNG  = "field_classes.png"
	fieldsClassesTIF  = "field_classes.tif"
	fieldsWindowAPNG  = "window_a.png"
	fieldsWindowBPNG  = "window_b.png"
)

// fieldsWeightsDir is where the field-boundary network is cached, under the
// application's data so it survives an update and is downloaded once.
func (a *App) fieldsWeightsDir() string {
	data := a.dataDir()
	if data == "" {
		return ""
	}
	return filepath.Join(data, "models", "ftw")
}

// AnalyzeFields delineates the fields inside an area over two Sentinel-2 dates.
func (a *App) AnalyzeFields(req analysis.FieldsRequest) (*analysis.FieldsAnalysis, error) {
	runner := a.currentRunner()
	if runner == nil {
		return nil, errors.New("runner not initialized")
	}
	res, err := runner.AnalyzeFields(a.ctx, req, a.fieldsWeightsDir())
	if err != nil {
		return nil, err
	}
	res.RunID = a.persistFieldsRun(req, res)
	return res, nil
}

/*
persistFieldsRun saves a delineation with its polygons, its class map and the
two scenes it was drawn over.

The polygons are a file of the run, not a column of its row. They are what
AdoptFields reads to make fields, and a FeatureCollection of several hundred
fields inside result_json would be read back with every listing of the run.
*/
func (a *App) persistFieldsRun(req analysis.FieldsRequest, res *analysis.FieldsAnalysis) string {
	if res == nil {
		return ""
	}
	label := aoiLabel(req.Label)
	summary := map[string]any{
		"fields_n":          res.NFields,
		"fields_checkpoint": res.Checkpoint.Name,
		"fields_window_a":   res.WindowA.Date,
		"fields_window_b":   res.WindowB.Date,
		"fields_area_ha":    res.AreaHa,
		"aoi_label":         label,
	}
	if res.FieldAreaHa != nil {
		summary["fields_median_ha"] = res.FieldAreaHa.Median
		summary["fields_total_ha"] = res.FieldAreaHa.Total
	}
	return a.saveRun(savedRun{
		kind:        store.RunKindFields,
		modelKind:   res.Checkpoint.Name,
		polygon:     req.PolygonGeoJSON,
		aoiLabel:    label,
		runLabel:    req.RunLabel,
		projectID:   req.ProjectID,
		areaID:      req.AreaID,
		periodStart: req.WindowA.Start,
		periodEnd:   req.WindowB.End,
		nDates:      2,
		summary:     summary,
		result: func(assetsDir, assetsRel string) any {
			_ = os.WriteFile(filepath.Join(assetsDir, fieldsGeoJSONFile), []byte(res.FieldsGeoJSON), 0o600)
			_ = store.WriteDataURIFile(res.ClassesURI, filepath.Join(assetsDir, fieldsClassesPNG))
			_ = store.WriteDataURIFile(res.WindowAURI, filepath.Join(assetsDir, fieldsWindowAPNG))
			_ = store.WriteDataURIFile(res.WindowBURI, filepath.Join(assetsDir, fieldsWindowBPNG))
			stored := *res
			stored.FieldsGeoJSON = ""
			stored.ClassesURI = ""
			stored.WindowAURI = ""
			stored.WindowBURI = ""
			stored.ClassesTIF = ""
			if strings.TrimSpace(res.ClassesTIF) != "" {
				if err := store.WriteDataURIFile(res.ClassesTIF, filepath.Join(assetsDir, fieldsClassesTIF)); err == nil {
					stored.ClassesTIF = filepath.Join(assetsRel, fieldsClassesTIF)
				}
			}
			return stored
		},
		overlayFile: fieldsClassesPNG,
	})
}

// loadFieldsRun reads a saved delineation back: its row's result, its polygons
// and its images, with every path pointing into the run's own folder.
func loadFieldsRun(run *store.InferenceRun, assetsDir string) *analysis.FieldsAnalysis {
	var fields analysis.FieldsAnalysis
	if run.ResultJSON != "" && run.ResultJSON != "{}" {
		_ = json.Unmarshal([]byte(run.ResultJSON), &fields)
	}
	fields.NormalizeNilSlices()
	if b, err := os.ReadFile(filepath.Join(assetsDir, fieldsGeoJSONFile)); err == nil {
		fields.FieldsGeoJSON = string(b)
	}
	for _, img := range []struct {
		file string
		dst  *string
	}{
		{fieldsClassesPNG, &fields.ClassesURI},
		{fieldsWindowAPNG, &fields.WindowAURI},
		{fieldsWindowBPNG, &fields.WindowBURI},
	} {
		if uri, err := store.ReadFileDataURI(filepath.Join(assetsDir, img.file), "image/png"); err == nil {
			*img.dst = uri
		}
	}
	fields.ClassesTIF = ""
	tif := filepath.Join(assetsDir, fieldsClassesTIF)
	if _, err := os.Stat(tif); err == nil {
		fields.ClassesTIF = tif
	}
	fields.RunID = run.ID
	return &fields
}

// fieldFeature is the part of one GeoJSON feature adoption reads.
type fieldFeature struct {
	Properties struct {
		Field  int     `json:"field"`
		AreaHa float64 `json:"area_ha"`
		// Absent when the delineation read no MapBiomas window, null for a
		// polygon that holds no cell; either way nothing to filter on.
		CroplandShare *float64 `json:"cropland_share"`
	} `json:"properties"`
	Geometry struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	} `json:"geometry"`
}

/*
AdoptFields makes the polygons of a field-boundary run the fields of the area
the run was made over.

minAreaHa drops the smaller polygons; zero keeps every one the run drew.
minCroplandShare drops the polygons MapBiomas mostly calls something other than
cropland -- FTW networks are known to segment pasture as fields -- and keeps a
polygon that carries no share, since there is then nothing to judge it by; zero
applies no such filter. With replace, fields adopted from an earlier
delineation of the same area are removed first, with their runs; without it, an
area already holding adopted fields is refused, so the interface can ask before
discarding work.

A FIELD IS ONE POLYGON. Every product reads an area as a GeoJSON Polygon, and
the sidecar writes one Polygon per field, splitting a region the simplification
or the clip broke into parts (sidecar/terra/fields/polygons.py). A MultiPolygon
reaches here only from a file written before that, and is adopted as its
largest part, which loses the others: on one run a 83.8 ha region was 47.3 and
38.8 ha.
*/
func (a *App) AdoptFields(runID string, minAreaHa, minCroplandShare float64, replace bool) ([]store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	run, err := st.GetRun(userID, runID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if run.Kind != store.RunKindFields {
		return nil, fmt.Errorf("run %s is a %s run, not a field delineation", runID, run.Kind)
	}
	if strings.TrimSpace(run.AreaID) == "" {
		return nil, errors.New("this delineation is not of a saved area, so its fields have no area to belong to")
	}
	raw, err := os.ReadFile(filepath.Join(st.RunsDir(run.ID), fieldsGeoJSONFile))
	if err != nil {
		return nil, fmt.Errorf("the delineation's polygons could not be read: %w", err)
	}
	fields, err := fieldsToAreas(raw, minAreaHa, minCroplandShare)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return nil, fmt.Errorf("no field of this delineation passes the filters (%.2f ha or larger, cropland share %.0f%% or more)",
			minAreaHa, 100*minCroplandShare)
	}
	created, err := st.AdoptFields(userID, run.AreaID, run.ID, fields, replace)
	if errors.Is(err, store.ErrFieldsExist) {
		return nil, err
	}
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return created, nil
}

// fieldsToAreas turns a delineation's FeatureCollection into areas to adopt,
// in the delineation's own order and named after its numbering.
func fieldsToAreas(raw []byte, minAreaHa, minCroplandShare float64) ([]store.Area, error) {
	var fc struct {
		Features []fieldFeature `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		return nil, fmt.Errorf("the delineation's polygons are not GeoJSON: %w", err)
	}
	out := []store.Area{}
	for _, f := range fc.Features {
		if f.Properties.AreaHa < minAreaHa {
			continue
		}
		if share := f.Properties.CroplandShare; share != nil && *share < minCroplandShare {
			continue
		}
		rings, err := largestPolygon(f.Geometry.Type, f.Geometry.Coordinates)
		if err != nil {
			return nil, fmt.Errorf("field %d: %w", f.Properties.Field, err)
		}
		poly, err := json.Marshal(analysis.GeoJSONGeometry{Type: "Polygon", Coordinates: rings})
		if err != nil {
			return nil, err
		}
		out = append(out, store.Area{
			Name:           fmt.Sprintf("field %d", f.Properties.Field),
			PolygonGeoJSON: string(poly),
		})
	}
	return out, nil
}

// largestPolygon is a Polygon's rings, or those of a MultiPolygon's largest
// part by the planar area of its outer ring.
func largestPolygon(kind string, coords json.RawMessage) ([][][]float64, error) {
	switch kind {
	case "Polygon":
		var rings [][][]float64
		if err := json.Unmarshal(coords, &rings); err != nil {
			return nil, err
		}
		if len(rings) == 0 {
			return nil, errors.New("empty polygon")
		}
		return rings, nil
	case "MultiPolygon":
		var parts [][][][]float64
		if err := json.Unmarshal(coords, &parts); err != nil {
			return nil, err
		}
		best, bestArea := -1, -1.0
		for i, p := range parts {
			if len(p) == 0 {
				continue
			}
			if area := ringArea(p[0]); area > bestArea {
				best, bestArea = i, area
			}
		}
		if best < 0 {
			return nil, errors.New("empty multipolygon")
		}
		return parts[best], nil
	default:
		return nil, fmt.Errorf("geometry %q is not a polygon", kind)
	}
}

// ringArea is the shoelace area of a lon/lat ring, with longitude scaled by
// the cosine of its latitude. Only compared between parts of one field, so the
// units do not matter and the scaling only has to be the same for each.
func ringArea(ring [][]float64) float64 {
	if len(ring) < 3 {
		return 0
	}
	lat := 0.0
	for _, p := range ring {
		lat += p[1]
	}
	k := math.Cos(lat / float64(len(ring)) * math.Pi / 180)
	sum := 0.0
	for i := range ring {
		j := (i + 1) % len(ring)
		sum += ring[i][0]*k*ring[j][1] - ring[j][0]*k*ring[i][1]
	}
	return math.Abs(sum) / 2
}

/*
CreateField puts one field drawn by hand inside an area.

A field drawn this way names no delineation, so a later delineation of the
same area leaves it where it is.
*/
func (a *App) CreateField(parentID, name, polygonGeoJSON string) (*store.Area, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	userID := a.effectiveUserID()
	parent, err := st.GetArea(userID, parentID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if strings.TrimSpace(name) == "" {
		name = "field"
	}
	created, err := st.CreateArea(userID, store.Area{
		ProjectID:      parent.ProjectID,
		ParentID:       parent.ID,
		Name:           name,
		PolygonGeoJSON: polygonGeoJSON,
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return created, nil
}
