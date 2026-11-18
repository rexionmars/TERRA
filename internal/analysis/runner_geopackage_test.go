package analysis

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// The listing with absent lists read as empty ones, and the file's path and
// name attached, since the sidecar does not echo them.
func TestParseGeoPackageFillsAbsentListsAndNamesTheFile(t *testing.T) {
	raw := `{"geopackage": {"layers": [
		{"name": "talhões", "title": "talhões", "data_type": "features",
		 "geometry_type": "MULTIPOLYGON", "kind": "polygon",
		 "crs": "SIRGAS 2000 / UTM zone 22S (EPSG:31982)", "count": 3, "drawn": 2,
		 "unreadable": 0, "bounds": [-53.47, -24.94, -53.44, -24.93],
		 "columns": ["nome"], "file": "0.geojson", "reason": ""},
		{"name": "ortofoto", "title": "", "data_type": "tiles", "geometry_type": "",
		 "kind": "", "crs": "", "count": 0, "drawn": 0, "unreadable": 0, "bounds": null,
		 "columns": null, "file": "", "reason": "it is a raster layer"}
	]}}`
	gp, err := parseGeoPackage("/tmp/fazenda.gpkg", []byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if gp.Path != "/tmp/fazenda.gpkg" || gp.Name != "fazenda.gpkg" || len(gp.Layers) != 2 {
		t.Fatalf("listing = %+v", gp)
	}
	if l := gp.Layers[0]; l.Kind != "polygon" || l.Drawn != 2 || len(l.Bounds) != 4 {
		t.Errorf("layer = %+v", l)
	}
	if l := gp.Layers[1]; l.Columns == nil || l.Bounds != nil {
		t.Errorf("a raster layer came back as %+v", l)
	}
	if _, err := parseGeoPackage("x", []byte(`{"geopackage": null}`)); err == nil {
		t.Error("an empty listing was accepted")
	}
}

// gpkgPolygon is a little-endian GeoPackageBinary blob (OGC 12-128r18, clause
// 2.1.3.1.1) with no envelope, around the WKB of a one-ring polygon.
func gpkgPolygon(srsID int32, ring [][2]float64) []byte {
	var b bytes.Buffer
	b.Write([]byte{'G', 'P', 0, 1})
	_ = binary.Write(&b, binary.LittleEndian, srsID)
	b.WriteByte(1)
	_ = binary.Write(&b, binary.LittleEndian, uint32(3))
	_ = binary.Write(&b, binary.LittleEndian, uint32(1))
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(ring)))
	for _, p := range ring {
		_ = binary.Write(&b, binary.LittleEndian, p[0])
		_ = binary.Write(&b, binary.LittleEndian, p[1])
	}
	return b.Bytes()
}

// writeGeoPackage writes a file with one layer of two rows in WGS 84: a polygon
// and a row with no geometry.
func writeGeoPackage(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	ring := [][2]float64{{-53.4, -24.9}, {-53.3, -24.9}, {-53.3, -24.8}, {-53.4, -24.8}, {-53.4, -24.9}}
	for _, stmt := range []string{
		`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY,
		  organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL,
		  definition TEXT NOT NULL, description TEXT)`,
		`INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84"]', NULL)`,
		`CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
		  identifier TEXT UNIQUE, srs_id INTEGER)`,
		`INSERT INTO gpkg_contents VALUES ('áreas', 'features', 'áreas', 4326)`,
		`CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL,
		  geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL)`,
		`INSERT INTO gpkg_geometry_columns VALUES ('áreas', 'geom', 'POLYGON', 4326, 0, 0)`,
		`CREATE TABLE "áreas" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POLYGON, nome TEXT)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO "áreas" (geom, nome) VALUES (?, 'sede'), (NULL, 'vazio')`,
		gpkgPolygon(4326, ring)); err != nil {
		t.Fatal(err)
	}
}

// The real sidecar over a file written here: the request Go builds is the one
// Python reads, the listing it writes is the one Go decodes, and the layer's
// GeoJSON is in the directory handed back.
func TestTheSidecarOpensAGeoPackageIntoADirectoryOfItsOwn(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", filepath.Dir(root))
	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	path := filepath.Join(t.TempDir(), "fazenda.gpkg")
	writeGeoPackage(t, path)

	gp, dir, err := r.OpenGeoPackage(ctx, path)
	if err != nil {
		t.Fatalf("OpenGeoPackage: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if !strings.HasPrefix(filepath.Base(dir), geoPackageDirPrefix) {
		t.Errorf("directory %s is not one the sweep knows", dir)
	}
	if len(gp.Layers) != 1 {
		t.Fatalf("layers = %+v", gp.Layers)
	}
	l := gp.Layers[0]
	if l.Name != "áreas" || l.Kind != "polygon" || l.Count != 2 || l.Drawn != 1 || l.File == "" {
		t.Fatalf("layer = %+v", l)
	}
	raw, err := os.ReadFile(filepath.Join(dir, l.File))
	if err != nil {
		t.Fatal(err)
	}
	var fc struct {
		Features []struct {
			ID         int64          `json:"id"`
			Properties map[string]any `json:"properties"`
			Geometry   struct {
				Type string `json:"type"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		t.Fatal(err)
	}
	if len(fc.Features) != 1 || fc.Features[0].ID != 1 || fc.Features[0].Properties["nome"] != "sede" ||
		fc.Features[0].Geometry.Type != "Polygon" {
		t.Errorf("features = %+v", fc.Features)
	}
	if b := l.Bounds; len(b) != 4 || math.Abs(b[0]+53.4) > 1e-9 || math.Abs(b[3]+24.8) > 1e-9 {
		t.Errorf("bounds = %v", b)
	}
}
