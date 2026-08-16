package backend

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

/*
The stand crosses the process boundary as glTF, and it has to arrive whole.

Helios writes a progress bar to stdout while it integrates, and stdout is where
the sidecar's single JSON document goes. Left on, the bar is prepended to the
reply and the decoder fails on the "A" of "Advancing" -- an error that names a
byte and says nothing about canopies. helios_grow silences it; this is what
keeps it silenced, because the failure returns the moment anyone adds a second
Helios entry point and forgets.

Skipped without the toolkit, since there is then nothing to grow.
*/
func TestCanopyMeshArrivesAsParsableGLTF(t *testing.T) {
	py := findPython(t)
	root := repoRoot(t)
	t.Setenv("TERRA_APP_DIR", root)
	t.Setenv("TERRA_PYTHON", py)
	t.Setenv("TERRA_ROOT", root+"/..")

	if !hasPyHelios(t, py) {
		t.Skip("pyhelios is not installed in this interpreter; nothing to grow")
	}

	r, err := NewRunner(root, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Second)
	defer cancel()

	interRow, interPlant := 0.8, 0.25
	seed := 7
	mesh, err := r.BuildCanopyMesh(ctx, CanopyMeshRequest{
		Species: "sorghum", Days: 45, Rows: 2, PerRow: 3,
		InterRow: &interRow, InterPlant: &interPlant, Seed: &seed,
	})
	if err != nil {
		t.Fatal(err)
	}

	if mesh.Plants != 6 {
		t.Errorf("asked for 2x3 plants and got %d", mesh.Plants)
	}
	if mesh.LeafArea <= 0 {
		t.Errorf("the stand reports %.6f m2 of leaf, so nothing grew", mesh.LeafArea)
	}
	if n := mesh.Organs["leaf"]; n <= 0 {
		t.Errorf("a canopy with %d leaf triangles is not a canopy", n)
	}
	// Fruit is a third of a grown sorghum's triangles and is not what anyone
	// means by a canopy, so the default selection must leave it out.
	if _, ok := mesh.Organs["fruit"]; ok {
		t.Error("the default organ selection carried fruit")
	}

	// The bytes stay on this side of the bridge -- the app holds them and the
	// front end fetches them -- so what the runner hands back is the mesh
	// itself, not an encoding of it.
	raw := mesh.Data
	if len(raw) != mesh.Bytes {
		t.Errorf("carried %d bytes, payload declares %d", len(raw), mesh.Bytes)
	}

	/*
		The container is GLB, so its JSON is a chunk inside the file rather than
		the whole of it. Unpacked rather than string-matched, for the reason a
		Contains check would miss: stray stdout ahead of the reply shifts every
		offset, and the header is the first thing that stops making sense.

		Layout is a 12-byte header -- magic, version, total length -- then
		chunks of (uint32 length, 4-byte type, payload). The first chunk is JSON.
	*/
	if len(raw) < 20 {
		t.Fatalf("the mesh is %d bytes, too short to be a GLB", len(raw))
	}
	if magic := string(raw[0:4]); magic != "glTF" {
		t.Fatalf("the mesh does not begin with the GLB magic but with %q, "+
			"which is what stray stdout ahead of the reply looks like", magic)
	}
	if v := binary.LittleEndian.Uint32(raw[4:8]); v != 2 {
		t.Errorf("GLB container version is %d, want 2", v)
	}
	if total := binary.LittleEndian.Uint32(raw[8:12]); int(total) != len(raw) {
		t.Errorf("the GLB header declares %d bytes and the file is %d", total, len(raw))
	}
	jsonLen := binary.LittleEndian.Uint32(raw[12:16])
	if kind := string(raw[16:20]); kind != "JSON" {
		t.Fatalf("the first GLB chunk is %q, want JSON", kind)
	}
	if int(20+jsonLen) > len(raw) {
		t.Fatalf("the JSON chunk claims %d bytes, past the end of a %d byte file",
			jsonLen, len(raw))
	}

	var doc struct {
		Asset struct {
			Version string `json:"version"`
		} `json:"asset"`
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
		Buffers []struct {
			URI string `json:"uri"`
		} `json:"buffers"`
	}
	if err := json.Unmarshal(raw[20:20+jsonLen], &doc); err != nil {
		t.Fatalf("the GLB's JSON chunk does not parse: %v", err)
	}
	if doc.Asset.Version != "2.0" {
		t.Errorf("glTF asset version is %q", doc.Asset.Version)
	}
	// The point of GLB here is that the buffer stays binary rather than being a
	// base64 data URI: encoding it twice is what exhausted the webview's stack
	// and surfaced as "Maximum call stack size exceeded". A uri back on the
	// buffer means that regression returned.
	for i, b := range doc.Buffers {
		if b.URI != "" {
			t.Errorf("buffer %d carries a uri, so the payload is base64 inside base64 again", i)
		}
	}
	names := make([]string, 0, len(doc.Nodes))
	for _, n := range doc.Nodes {
		names = append(names, n.Name)
	}
	if !strings.Contains(strings.Join(names, ","), "leaf") {
		t.Errorf("no leaf node in the mesh; nodes are %v", names)
	}
}
